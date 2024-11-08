import { SemanticTokenTypes } from "vscode-languageserver";
import { Highlight } from "../../colors.js";
import { Parser } from "../../mythicParser/parser.js";
import { Expr, InlineSkillExpr, MlcValueExpr, SkillLineExpr } from "../../mythicParser/parserExpressions.js";
import { MythicScanner, MythicToken } from "../../mythicParser/scanner.js";
import { DocumentInfo, RangeLink } from "../../yaml/parser/documentInfo.js";
import { generateHover, getHolderFromName } from "../services.js";
import { InvalidFieldValueError, MythicFieldType } from "../types.js";
import { GenericError } from "../../errors.js";
import { Resolver } from "../../mythicParser/resolver.js";
import { Result } from "tick-ts-utils";
import { p, r } from "../../utils/positionsAndRanges.js";
import { dbg } from "../../utils/logging.js";

export class MFMythicSkillParser extends Parser {
    mythicSkill(doc?: DocumentInfo): MythicToken | InlineSkillExpr | undefined {
        if (this.match("Identifier")) {
            return this.previous();
        }
        const lsb = this.consume("LeftSquareBracket", "Expected '[' before inline skill!");
        if (lsb.isError()) {
            doc?.addError(lsb.getError());
            return undefined;
        }
        const leftSquareBracket = this.previous();
        const dashesAndSkills: [MythicToken, SkillLineExpr][] = [];
        while (!this.check("RightSquareBracket") && !this.isAtEnd()) {
            // this.#completionGeneric(["- ", "]"]);
            // optional whitespace
            this.consumeWhitespace();
            // this.#completionGeneric(["- ", "]"]);
            // dash
            const dash = this.consume("Dash", "Expected '-' after '['!");
            if (dash.isError()) {
                continue;
            }

            // optional whitespace
            this.consumeWhitespace();
            // skill
            const skill = this.skillLine("RightSquareBracket", "Dash");

            // optional whitespace
            this.consumeWhitespace();
            dashesAndSkills.push([dash.get(), skill]);
        }
        const rightSquareBracket = this.consume("RightSquareBracket", "Expected ']' after inline skill!").getOrElse(undefined);
        return new InlineSkillExpr(this, this.currentPosition(), leftSquareBracket, dashesAndSkills, rightSquareBracket);
    }
}

export class MFMythicSkill extends MythicFieldType {
    constructor() {
        super();
        this.setName("mythicSkill");
    }
    static validateSkillName(doc: DocumentInfo, value: MlcValueExpr, identifier: MythicToken) {
        const mechanicName = identifier.lexeme;
        const holder = getHolderFromName("mechanic", "skill:" + mechanicName);
        if (holder.isPresent()) {
            const h = holder.get();
            if (h.definition) {
                doc.addHover({
                    ...generateHover("mechanic", mechanicName, h),
                    range: identifier.range,
                });
                doc.addGotoDefinitionAndReverseReference(new RangeLink(identifier.range, h.definition.range, h.definition.doc));
                doc.addHighlight(new Highlight(identifier.range, SemanticTokenTypes.function));
                return [];
            }
        }

        doc.addError(new InvalidFieldValueError(`Unknown metaskill '${mechanicName}'`, value, identifier.range));
    }
    static validateInlineSkill(doc: DocumentInfo, _value: MlcValueExpr, inlineSkill: InlineSkillExpr) {
        for (const comment of inlineSkill.comments) {
            doc.addHighlight(new Highlight(comment.range, SemanticTokenTypes.comment));
        }
    }

    override validate(doc: DocumentInfo, value: MlcValueExpr, _: Resolver): Expr[] {
        const str = value.getSource();
        const scanner = new MythicScanner(doc, value.range.start.toOffset(doc.lineLengths), str, true);
        const tokens = scanner.scanTokens();
        const expr = new MFMythicSkillParser(tokens).mythicSkill(doc);

        if (expr instanceof InlineSkillExpr) {
            MFMythicSkill.validateInlineSkill(doc, value, expr);
            return [expr];
        }

        expr && MFMythicSkill.validateSkillName(doc, value, expr);

        return [];
    }
}
