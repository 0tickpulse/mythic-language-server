import { Node } from "yaml";
import { Dependency, DocumentInfo } from "./yaml/parser/documentInfo.js";
import { CustomRange } from "./utils/positionsAndRanges.js";
import { HasSymbol } from "./services/documentSymbolService.js";
import { DocumentSymbol, SymbolKind, WorkspaceSymbol } from "vscode-languageserver";

/**
 * Represents a cached Mythic Skill.
 */
export class CachedMythicSkill extends Dependency implements HasSymbol {
    readonly description: string;
    dependencies: Dependency[] = [];
    constructor(
        /**
         * The path to the file containing the skill.
         */
        public readonly doc: DocumentInfo,
        /**
         * The YAML AST of the skill, as a tuple of the key and the value.
         */
        public readonly node: [Node, Node],
        public readonly declarationRange: CustomRange,
        /**
         * The name of the skill. This is the key of the skill in the node.
         */
        public readonly name: string,
    ) {
        super(doc, declarationRange);
        const key = node[0];
        const comment = key.commentBefore ?? undefined;
        // FORMAT
        // Documentation format must be yaml comment, but with two ## instead of one.
        // If there are any lines that don't start with ##, it clears the description.
        // e.g.
        // ## This is a description
        // #
        // ## asdf
        // the final description will be "asdf"
        // e.g. 2
        // ## This is a description
        // ## This is a description
        // the final description will be "This is a description\nThis is a description"
        const lines = comment?.split("\n") ?? [];
        let descriptionLines: string[] = [];
        for (const line of lines) {
            if (line.startsWith("#")) {
                descriptionLines.push(line.slice(1));
            } else {
                descriptionLines = [];
            }
        }
        this.description = descriptionLines.join("\n");
    }
    toString() {
        return `CachedMythicSkill(${this.name})`;
    }
    getSource(): string {
        return this.doc.source.substring(this.node[0].range![0], this.node[1].range![1]);
    }
    get symbol(): DocumentSymbol {
        return {
            name: this.name,
            kind: SymbolKind.Function,
            range: this.declarationRange,
            selectionRange: this.declarationRange,
        };
    }
    get workspaceSymbol(): WorkspaceSymbol {
        return {
            name: this.name,
            kind: SymbolKind.Function,
            location: {
                uri: this.doc.base.uri,
                range: this.declarationRange,
            },
        };
    }
}


/**
 * Represents a cached Mythic Mob.
 */
export class CachedMythicMob extends Dependency implements HasSymbol {
    readonly description: string;
    dependencies: Dependency[] = [];
    constructor(
        /**
         * The path to the file containing the mob.
         */
        public readonly doc: DocumentInfo,
        /**
         * The YAML AST of the mob, as a tuple of the key and the value.
         */
        public readonly node: [Node, Node],
        public readonly declarationRange: CustomRange,
        /**
         * The name of the mob. This is the key of the mob in the node.
         */
        public readonly name: string,
    ) {
        super(doc, declarationRange);
        const key = node[0];
        const comment = key.commentBefore ?? undefined;
        // FORMAT
        // Documentation format must be yaml comment, but with two ## instead of one.
        // If there are any lines that don't start with ##, it clears the description.
        // e.g.
        // ## This is a description
        // #
        // ## asdf
        // the final description will be "asdf"
        // e.g. 2
        // ## This is a description
        // ## This is a description
        // the final description will be "This is a description\nThis is a description"
        const lines = comment?.split("\n") ?? [];
        let descriptionLines: string[] = [];
        for (const line of lines) {
            if (line.startsWith("#")) {
                descriptionLines.push(line.slice(1));
            } else {
                descriptionLines = [];
            }
        }
        this.description = descriptionLines.join("\n");
    }
    toString() {
        return `CachedMythicMob(${this.name})`;
    }
    getSource(): string {
        return this.doc.source.substring(this.node[0].range![0], this.node[1].range![1]);
    }
    get symbol(): DocumentSymbol {
        return {
            name: this.name,
            kind: SymbolKind.Function,
            range: this.declarationRange,
            selectionRange: this.declarationRange,
        };
    }
    get workspaceSymbol(): WorkspaceSymbol {
        return {
            name: this.name,
            kind: SymbolKind.Function,
            location: {
                uri: this.doc.base.uri,
                range: this.declarationRange,
            },
        };
    }
}
