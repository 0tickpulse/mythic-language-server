// RULES
// skillLine = mechanic ( targeter | trigger | condition* );
// targeter = "@" + identifier ( + "{" + mlc + "}" );
// trigger = "~" + identifier ( + ":" + identifier ) ( + "{" + mlc + "}" );
// condition = "?" ( ( + "~" ) + "!" ) + identifier ( + "{" + mlc + "}" );
// mechanic = identifier ( + "{" + mlc + "}" );
// mlc = identifier + "=" + mlcValue ( + ";" + mlc );
// placeholder = "<" + placeholderText + ">";
// placeholderText = identifier ( + "." + placeholderText );
// inline skill = "[" + ( "-" + skillLine )* + "]"

import { Optional, Result } from "tick-ts-utils";
import { CompletionItem } from "vscode-languageserver";
import { GenericError } from "../errors.js";
import { CustomPosition } from "../utils/positionsAndRanges.js";
import { YString } from "../yaml/schemaSystem/schemaTypes.js";
import {
    GenericStringExpr,
    HealthModifierExpr,
    InlineConditionExpr,
    MechanicExpr,
    MlcExpr,
    MlcPlaceholderExpr,
    MlcValueExpr,
    SkillLineExpr,
    TargeterExpr,
    TriggerExpr,
} from "./parserExpressions.js";
import { MythicScannerResult, MythicToken, MythicTokenType } from "./scanner.js";

export class MythicSkillParseResult {
    constructor(public skillLine?: SkillLineExpr, public errors: GenericError[] = [], public completions?: string[]) {}
    static fromSkillLine(skillLine: SkillLineExpr) {
        return new MythicSkillParseResult(skillLine);
    }
    static fromErrors(errors: GenericError[]) {
        return new MythicSkillParseResult(undefined, errors);
    }
    hasErrors() {
        return this.errors?.length ?? 0 > 0;
    }
    getSkillLineOrThrow() {
        if (this.skillLine === undefined) {
            throw new Error("No skill line found");
        }
        return this.skillLine;
    }
}

export class Completion {
    constructor(public completions: CompletionItem[]) {}
}

export class Parser {
    protected current = 0;
    protected tokens: MythicToken[];
    #isCompleting = false;
    #completions: CompletionItem[] = [];
    #errors: GenericError[] = [];
    constructor(public result: MythicScannerResult) {
        this.tokens = result.tokens ?? [];
    }
    completeMythicSkill(): CompletionItem[] {
        this.#isCompleting = true;
        if (this.result.errors?.length ?? 0 > 0) {
            return [];
        }
        try {
            this.skillLine();
            return [];
        } catch (e) {
            if (e instanceof Completion) {
                return e.completions;
            }
            throw e;
        } finally {
            this.#isCompleting = false;
        }
    }
    /**
     * Should only be used by {@link YString}
     */
    parseMlcValue(): Optional<MlcValueExpr> {
        this.current = 0;
        if (this.result.errors?.length ?? 0 > 0) {
            return Optional.empty();
        }
        try {
            const mlc = this.mlcValue();
            if (mlc instanceof MlcValueExpr) {
                return Optional.of(mlc);
            }
            return Optional.empty();
        } catch (e) {
            return Optional.empty();
        }
    }
    parseMythicSkill(): MythicSkillParseResult {
        this.current = 0;
        if (this.result.errors?.length ?? 0 > 0) {
            return MythicSkillParseResult.fromErrors(this.result.errors ?? []);
        }
        // try {
        //     return MythicSkillParseResult.fromSkillLine(this.skillLine());
        // } catch (e) {
        //     if (e instanceof GenericError) {
        //         return MythicSkillParseResult.fromErrors([e]);
        //     }
        //     throw e;
        // }
        const skillLine = this.skillLine();
        return new MythicSkillParseResult(
            skillLine,
            this.#errors,
            this.#completions.map((c) => c.label),
        );
    }
    protected skillLine(...exitTypes: MythicTokenType[]) {
        // this.#completion(
        //     getAllMechanicsAndAliases().map((m): CompletionItem => {
        //         const item: CompletionItem = { label: m, kind: CompletionItemKind.Function };
        //         item.detail = getHover("mechanic", m).map(h => h.contents.toString()).otherwise(undefined);
        //         return item;
        //     })
        // );
        const mechanic = this.mechanic();
        let targeter: TargeterExpr | undefined = undefined;
        let trigger: TriggerExpr | undefined = undefined;
        const conditions: InlineConditionExpr[] = [];
        let chance: MythicToken | undefined = undefined;
        let healthModifier: HealthModifierExpr | undefined = undefined;

        while (!this.isAtEnd()) {
            this.consumeWhitespace();
            // this.#completionGeneric(["At", "Tilde", "Question", "Number", "Equal", "GreaterThan", "LessThan", ...exitTypes]);
            if (this.isAtEnd()) {
                break;
            }
            if (this.checkAny(...exitTypes)) {
                break;
            } else if (this.matchAll("At")) {
                if (targeter === undefined) {
                    targeter = this.targeter();
                } else {
                    this.targeter(); // consume the targeter
                    this.#errors.push(this.error(this.peek(), "Duplicate targeter!"));
                }
            } else if (this.matchAll("Tilde")) {
                if (trigger === undefined) {
                    trigger = this.trigger();
                } else {
                    this.trigger(); // consume the trigger
                    this.#errors.push(this.error(this.peek(), "Duplicate trigger!"));
                }
            } else if (this.matchAll("Question")) {
                const condition = this.inlineCondition();
                if (condition !== undefined) {
                    conditions.push(condition);
                }
            } else if (this.matchAll("Number")) {
                chance = this.previous();
            } else if (this.checkAny("Equal", "GreaterThan", "LessThan")) {
                healthModifier = this.healthModifier();
            } else {
                this.#errors.push(
                    this.error(
                        this.peek(),
                        `Expected targeter, trigger or condition, but found ${this.peek().lexeme}! \n(For debugging) Exit types: ${exitTypes.join(
                            ", ",
                        )}`,
                    ),
                );
                this.advance();
            }
        }

        return new SkillLineExpr(this, this.currentPosition(), mechanic, targeter, trigger, conditions, chance, healthModifier);
    }
    protected mechanic() {
        const nameResult = this.genericString(["LeftBrace", "Space"], "Expected mechanic name!");
        if (nameResult.isError()) {
            return void this.#errors.push(nameResult.getError());
        }
        const name = nameResult.get();
        if (name.values.length === 0) {
            throw this.error(this.peek(), "Expected mechanic name!");
        }
        if (this.match("LeftBrace")) {
            const leftBrace = this.previous();
            const mlc = this.mlc();
            const rightBrace = this.consume("RightBrace", "Expected '}' after mechanic mlc!").getOrElse(undefined);
            return new MechanicExpr(this, this.currentPosition(), name, leftBrace, mlc, rightBrace);
        }
        return new MechanicExpr(this, this.currentPosition(), name, undefined, [], undefined);
    }
    protected targeter() {
        const at = this.previous();
        // this.#completion(
        //     getAllTargetersAndAliases().map((t): CompletionItem => {
        //         const item: CompletionItem = { label: t, kind: CompletionItemKind.Function };
        //         item.detail = getHover("targeter", t).map(h => h.contents.toString()).otherwise(undefined);
        //         return item;
        //     })
        // );
        const nameResult = this.consume("Identifier", "Expected targeter name!");
        if (nameResult.isError()) {
            return void this.#errors.push(nameResult.getError());
        }
        const name = nameResult.get();
        // this.#completionGeneric(["{"]);
        if (this.match("LeftBrace")) {
            const leftBrace = this.previous();
            const mlc = this.mlc();
            const rightBrace = this.consume("RightBrace", "Expected '}' after targeter mlc!").getOrElse(undefined);
            return new TargeterExpr(this, this.currentPosition(), at, name, leftBrace, mlc, rightBrace);
        }
        return new TargeterExpr(this, this.currentPosition(), at, name, undefined, [], undefined);
    }
    protected trigger() {
        const caret = this.previous();
        const nameResult = this.genericString(["LeftBrace", "Space"], "Expected trigger name!");
        if (nameResult.isError()) {
            return void this.#errors.push(nameResult.getError());
        }
        const name = nameResult.get();
        let arg: GenericStringExpr | undefined = undefined;
        let colon: MythicToken | undefined = undefined;
        if (this.match("Colon")) {
            colon = this.previous();
            arg = this.genericString(["LeftBrace", "Space"], "Expected trigger argument after ':'!").getOrElse(undefined);
        }
        return new TriggerExpr(this, this.currentPosition(), caret, name, colon, arg);
    }
    protected inlineCondition() {
        const question = this.previous();
        let not = false;
        let trigger = false;
        // this.#completionGeneric(["!", "~"]);
        if (this.match("Exclamation")) {
            not = true;
        }
        // this.#completionGeneric(not ? ["~"] : ["!", "~"]);
        if (this.match("Tilde")) {
            trigger = true;
        }
        // this.#completion(
        //     getAllConditionsAndAliases().map((c): CompletionItem => {
        //         const item: CompletionItem = { label: c, kind: CompletionItemKind.Function };
        //         item.detail = getHover("condition", c).map(h => h.contents.toString()).otherwise(undefined);
        //         return item;
        //     })
        // );
        const nameResult = this.consume("Identifier", "Expected inline condition name!");
        if (nameResult.isError()) {
            return undefined;
        }
        const name = nameResult.get();
        // this.#completionGeneric(["{"]);
        if (this.match("LeftBrace")) {
            const leftBrace = this.previous();
            const mlc = this.mlc();
            const rightBrace = this.consume("RightBrace", "Expected '}' after inline condition mlc!").getOrElse(undefined);
            return new InlineConditionExpr(this, this.currentPosition(), question, name, leftBrace, mlc, rightBrace, not, trigger);
        }
        return new InlineConditionExpr(this, this.currentPosition(), question, name, undefined, [], undefined, not, trigger);
    }

    protected healthModifier() {
        // healthModifier = ( ( "<" | ">" ) + number ( + percent )? ) | ( "=" + number ( + percent )? ( + "-" + number ( + percent )? )? )\
        const operatorResult = this.consumeAny(["Equal", "GreaterThan", "LessThan"], "Expected health modifier operator!");
        if (operatorResult.isError()) {
            return void this.#errors.push(operatorResult.getError());
        }
        const operator = operatorResult.get();

        const numberResult = this.consume("Number", "Expected health modifier value!");
        if (numberResult.isError()) {
            return void this.#errors.push(numberResult.getError());
        }
        const number = numberResult.get();
        const min: [MythicToken, MythicToken?] = [number];
        if (this.check("Percent")) {
            min.push(this.advance());
        }
        if (operator.type === "Equal" && this.match("Dash")) {
            const numberResult = this.consume("Number", "Expected second health modifier value!");
            if (numberResult.isOk()) {
                const max: [MythicToken, MythicToken?] = [numberResult.get()];
                if (this.check("Percent")) {
                    max.push(this.advance());
                }
                return new HealthModifierExpr(this, this.currentPosition(), operator, [min, max]);
            }
        }
        return new HealthModifierExpr(this, this.currentPosition(), operator, min);
    }

    protected mlc() {
        const mlcs: MlcExpr[] = [];
        do {
            let semicolon: MythicToken | undefined = undefined;
            if ((this.previous().lexeme ?? "") === ";") {
                semicolon = this.previous();
            }
            // if no mlc is found, break
            if (this.check("RightBrace")) {
                break;
            }
            this.consumeWhitespace();
            const key = this.consume("Identifier", "Expected mlc key!");
            key.ifOk((k) => {
                const equals = this.consume("Equal", "Expected '=' after mlc key!").getOrElse(undefined);
                const value = this.mlcValue();
                mlcs.push(new MlcExpr(this, this.currentPosition(), k, equals, value, semicolon));
            });
            // this.#completionGeneric(["="]);
            // this.#completionGeneric([";", "}"]);
            this.consumeWhitespace();
            // this.#completionGeneric([";", "}"]);
            this.consumeWhitespace();
        } while (this.match("Semicolon"));
        return mlcs;
    }
    protected mlcValue() {
        const parts: (MythicToken[] | MlcPlaceholderExpr)[] = [];
        let start = this.current;
        const startPos = this.currentPosition();
        while (!this.check("Semicolon") && !this.check("RightBrace") && !this.isAtEnd()) {
            if (this.match("LessThan")) {
                // remove leading <
                parts.push(this.tokens.slice(start, this.current - 1));
                const placeholder = this.placeholder();
                if (placeholder !== undefined) {
                    parts.push(placeholder);
                }
                start = this.current;
            } else {
                this.advanceWithBrace();
            }
        }
        parts.push(this.tokens.slice(start, this.current));
        return new MlcValueExpr(this, startPos, parts);
    }
    /**
     * Like advance, but if it finds an opening brace/squarebracket, it will advance until it finds the matching closing brace.
     * It does it recursively, so it will also skip braces/squarebrackets inside braces/squarebrackets.
     */
    protected advanceWithBrace() {
        const type = this.peek().type;
        if (type === "LeftBrace" || type === "LeftSquareBracket") {
            let depth = 0;
            while (true) {
                const token = this.advance();
                if (token.type === "LeftBrace" || token.type === "LeftSquareBracket") {
                    depth++;
                } else if (token.type === "RightBrace" || token.type === "RightSquareBracket") {
                    depth--;
                    if (depth === 0) {
                        return;
                    }
                }
            }
        }
        this.advance();
    }
    protected placeholder() {
        // genericString ( + "." + genericString )*
        const leftSquareBracket = this.previous();
        const parts: [GenericStringExpr, MythicToken?, MlcExpr[]?, MythicToken?][] = [];
        const dots: MythicToken[] = [];

        const part1Result = this.genericString(["GreaterThan", "Dot", "LeftBrace"]);
        if (part1Result.isError()) {
            return void this.#errors.push(part1Result.getError());
        }
        const part1 = part1Result.get();
        const part: [GenericStringExpr, MythicToken?, MlcExpr[]?, MythicToken?] = [part1];
        if (this.match("LeftBrace")) {
            part.push(this.previous());
            part.push(this.mlc());
            const rb = this.consume("RightBrace", "Expected '}' after placeholder mlc!");
            rb.ifOkOrElse(
                (rb) => part.push(rb),
                (e) => this.#errors.push(e),
            );
        }
        parts.push(part);
        // this.#completionGeneric([".", ">"]);
        while (this.match("Dot") && !this.isAtEnd()) {
            dots.push(this.previous());
            const part1Result = this.genericString(["GreaterThan", "Dot", "LeftBrace"]);
            if (part1Result.isError()) {
                return void this.#errors.push(part1Result.getError());
            }
            const part1 = part1Result.get();
            const part: [GenericStringExpr, MythicToken?, MlcExpr[]?, MythicToken?] = [part1];
            if (this.match("LeftBrace")) {
                part.push(this.previous());
                part.push(this.mlc());
                const rb = this.consume("RightBrace", "Expected '}' after placeholder mlc!");
                rb.ifOkOrElse(
                    (rb) => part.push(rb),
                    (e) => this.#errors.push(e),
                );
            }
            parts.push(part);
            // this.#completionGeneric([".", ">"]);
        }
        const rightSquareBracket = this.consume("GreaterThan", "Expected '>' after placeholder!").getOrElse(undefined);
        return new MlcPlaceholderExpr(this, this.currentPosition(), leftSquareBracket, parts, dots, rightSquareBracket);
    }

    protected genericString(end: MythicTokenType[], error = "Expected a string!"): Result<GenericStringExpr, GenericError> {
        const start = this.current;
        while (!this.checkAny(...end) && !this.isAtEnd()) {
            if (this.check("LeftBrace")) {
                while (!this.check("RightBrace")) {
                    this.advance();
                }
            }
            if (this.check("LeftSquareBracket")) {
                while (!this.check("RightSquareBracket")) {
                    this.advance();
                }
            }
            this.advance();
        }
        const string = this.tokens.slice(start, this.current);
        if (string.length === 0) {
            return Result.error(
                this.error(
                    this.peek(),
                    `${error} (End: ${end.join(", ")}, start: ${start}, current: ${this.current}, checkAny: ${this.checkAny(...end)}, currentType ${
                        this.peek()?.type ?? ""
                    })`,
                ),
            );
            // throw this.#error(this.#peek(), error);
        }
        return Result.ok(new GenericStringExpr(this, this.currentPosition(), string));
    }

    protected consume(type: MythicTokenType, message: string): Result<MythicToken, GenericError> {
        if (this.check(type)) {
            return Result.ok(this.advance());
        }
        return Result.error(this.error(this.peek(), `${message} (Got ${this.peek()?.type ?? ""} '${this.peek()?.lexeme}')`));
    }

    protected consumeAny(types: MythicTokenType[], message: string): Result<MythicToken, GenericError> {
        if (this.checkAny(...types)) {
            return Result.ok(this.advance());
        }
        return Result.error(this.error(this.peek(), `${message} (Got ${this.peek()?.type ?? ""} '${this.peek()?.lexeme}')`));
    }

    protected consumeWhitespace() {
        while (this.match("Space") && !this.isAtEnd()) {
            // do nothing
        }
    }
    protected match(...types: MythicTokenType[]): boolean {
        for (const type of types) {
            if (this.check(type)) {
                this.advance();
                return true;
            }
        }
        return false;
    }
    protected matchAll(...types: MythicTokenType[]): boolean {
        for (const type of types) {
            if (!this.check(type)) {
                return false;
            }
            this.advance();
        }
        return true;
    }
    protected matchAny(...types: MythicTokenType[]): boolean {
        for (const type of types) {
            if (this.check(type)) {
                this.advance();
                return true;
            }
        }
        return false;
    }
    protected check(type: MythicTokenType): boolean {
        if (this.isAtEnd()) {
            return false;
        }
        return this.peek().type === type;
    }
    protected checkAny(...types: MythicTokenType[]): boolean {
        if (this.isAtEnd()) {
            return false;
        }
        return types.includes(this.peek().type);
    }
    protected advance(): MythicToken {
        if (!this.isAtEnd()) {
            this.current++;
        }
        return this.previous();
    }
    protected isAtEnd(): boolean {
        return this.peek().type === "Eof";
    }
    protected peek(): MythicToken {
        return this.tokens[this.current];
    }
    protected peekNext(): MythicToken {
        return this.tokens[this.current + 1];
    }
    /**
     * Please don't use this method too much due to performance reasons.
     */
    protected peekNextNext(): MythicToken {
        return this.tokens[this.current + 2];
    }
    protected previous(): MythicToken {
        return this.tokens[this.current - 1];
    }
    protected error(token: MythicToken, message: string): GenericError {
        return new GenericError(token.range, this.result.source ?? "", message, token);
    }
    protected completion(completions: CompletionItem[]): void {
        if (!this.#isCompleting) {
            return;
        }
        const offset = this.peek().range.end;
        // this.#completions = completions;
    }
    protected completionGeneric(completions: string[]): void {
        if (!this.#isCompleting) {
            return;
        }
        const offset = this.peek().range.end;
        // this.#completions = completions.map((c) => ({
        //     label: c,
        //     kind: CompletionItemKind.Text
        // }));
    }

    protected currentPosition(): CustomPosition {
        return this.peek().range.start;
    }
}
