import { Optional } from "tick-ts-utils";
import { Diagnostic, SemanticTokenTypes } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { globalData } from "../../documentManager.js";
import { server } from "../../index.js";
import { dbg, info, warn } from "../../utils/logging.js";
import { CustomPosition, CustomRange } from "../../utils/positionsAndRanges.js";
import { PATH_MAP } from "../schemaSystem/data.js";
import { YamlSchema } from "../schemaSystem/schemaTypes.js";
import { DocumentInfo } from "./documentInfo.js";
import { visit, visitor } from "yaml";
import { Highlight } from "../../colors.js";

class DocumentQueue {
    #items: TextDocument[] = [];
    get items() {
        return this.#items;
    }
    add(doc: TextDocument) {
        for (const item of this.#items) {
            if (item.uri === doc.uri) {
                return;
            }
        }
        this.#items.push(doc);
    }
    get size() {
        return this.#items.length;
    }
    clear() {
        this.#items = [];
    }
    forEach(callback: (doc: TextDocument) => void) {
        this.#items.forEach(callback);
    }
    remove(doc: TextDocument) {
        this.#items = this.#items.filter((item) => item.uri !== doc.uri);
    }
}

export const PARTIAL_PARSE_QUEUE = new DocumentQueue();
export const FULL_PARSE_QUEUE = new DocumentQueue();
let scheduledParse: Optional<NodeJS.Timeout> = Optional.empty();
export function queuePartial(doc: TextDocument) {
    PARTIAL_PARSE_QUEUE.add(doc);
    info("Parser", `Queued ${doc.uri} for partial parsing`);
    scheduleParse();
}
/**
 * Queues a document for full parsing.
 * This will also add document to the partial parse queue.
 *
 * @param doc The document to queue for full parsing.
 */
export function queueFull(doc: TextDocument) {
    FULL_PARSE_QUEUE.add(doc);
    info("Parser", `Queued ${doc.uri} for full parsing`);
    scheduleParse();
}
/**
 * Procedures that run before beginning to parse all documents.
 */
const flushProcedures: (() => void)[] = [];
/**
 * Document-specific procedures that run before parsing a document.
 */
const flushDocProcedures: ((doc: TextDocument) => void)[] = [
    ({ uri }) => globalData.flush(uri),
    ({ uri }) => server.connection?.sendDiagnostics({ uri, diagnostics: [] }),
];
export function onFlush(procedure: () => void) {
    flushProcedures.push(procedure);
}
export function onFlushDoc(procedure: (doc: TextDocument) => void) {
    flushDocProcedures.push(procedure);
}
export function scheduleParse() {
    scheduledParse.ifPresent(clearTimeout);
    scheduledParse = Optional.of(
        setTimeout(() => {
            if (PARTIAL_PARSE_QUEUE.size === 0 && FULL_PARSE_QUEUE.size === 0) {
                warn("Parser", "No documents to parse - skipping...");
                return;
            }
            info("Parser", `Parsing ${PARTIAL_PARSE_QUEUE.size} documents partially and ${FULL_PARSE_QUEUE.size} documents fully.`);
            const diagnostics = new Map<string, Diagnostic[]>();
            flushProcedures.forEach((procedure) => procedure());
            const flushDoc = (doc: TextDocument) => {
                info("Parser", `Flushing data for ${doc.uri}`);
                flushDocProcedures.forEach((procedure) => procedure(doc));
            };
            const pre = (doc: TextDocument) => {
                const documentInfo = preParse(doc);
                globalData.documents.set(documentInfo);
                diagnostics.set(doc.uri, documentInfo.errors);
            };
            const postAndClear = (doc: TextDocument) => {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- we just set it in the previous closure
                const documentInfo = postParse(globalData.documents.getDocument(doc.uri)!);
                globalData.documents.set(documentInfo);
                addDependents(doc);
                diagnostics.set(doc.uri, documentInfo.errors);
                dbg("Parser", documentInfo.printStats());
                FULL_PARSE_QUEUE.remove(doc);
            };
            const addDependents = (doc: TextDocument) => {
                const documentInfo = globalData.documents.getDocument(doc.uri);
                if (documentInfo === undefined) {
                    warn("Parser", `Document ${doc.uri} was not parsed!`);
                    return;
                }
                documentInfo.traverseDependents(({ doc }) => {
                    FULL_PARSE_QUEUE.add(doc.base);
                });
                documentInfo.traverseDependencies(({ doc }) => {
                    FULL_PARSE_QUEUE.add(doc.base);
                });
            };
            // TODO: perhaps reduce the amount of loops here
            PARTIAL_PARSE_QUEUE.forEach(flushDoc);
            PARTIAL_PARSE_QUEUE.forEach(pre);
            FULL_PARSE_QUEUE.forEach(addDependents);
            while (FULL_PARSE_QUEUE.size > 0) {
                FULL_PARSE_QUEUE.forEach(flushDoc);
                FULL_PARSE_QUEUE.forEach(pre);
                FULL_PARSE_QUEUE.forEach(postAndClear);
            }
            // clear diagnostics
            diagnostics.forEach((diagnostics, uri) => {
                if (diagnostics.length === 0) {
                    warn("Parser", `No diagnostics for ${uri} - skipping...`);
                    return;
                }
                server.connection?.sendDiagnostics({ uri, diagnostics });
                info("Parser", `Sent ${diagnostics.length} diagnostics for ${uri}`);
            });
            PARTIAL_PARSE_QUEUE.clear();
            FULL_PARSE_QUEUE.clear();
            info("Parser", `Finished parsing! Requesting semantic token refresh...`);
            // server.connection.languages.semanticTokens.refresh();
        }, FULL_PARSE_QUEUE.size * 10),
    );
}

export function preParse(doc: TextDocument, schemaOverride?: YamlSchema) {
    dbg("Parser", `Preparsing ${doc.uri}`);
    const now = Date.now();
    const { uri } = doc;
    const source = doc.getText();
    const documentInfo = new DocumentInfo(doc);
    const { yamlAst } = documentInfo;
    const { contents } = yamlAst;
    const lineLengths = source.split("\n").map((line) => line.length);
    
    if (contents === null) {
        return documentInfo;
    }

    if (server.highlightYaml) {
        const visitor: visitor = {
            Scalar(key, node) {
                const range = CustomRange.fromYamlRange(lineLengths, node.range!);
                const highlightType = (() => {
                    if (key === "key") {
                        return SemanticTokenTypes.property;
                    }
                    if (key === "value") {
                        return typeof node.value === "string" ? SemanticTokenTypes.string : SemanticTokenTypes.number;
                    }
                    return SemanticTokenTypes.string;
                })();
                documentInfo.highlights.push(new Highlight(range, highlightType));
            },
        };
        visit(yamlAst, visitor);
    }

    if (schemaOverride === undefined) {
        PATH_MAP.forEach(({ schema, picoMatch }, pathMatcher) => {
            if (picoMatch(uri)) {
                documentInfo.setSchema(schema);
            }
        });
    } else {
        documentInfo.setSchema(schemaOverride);
    }

    const { schema } = documentInfo;
    documentInfo.yamlAst.errors.forEach((error) =>
        documentInfo.addError({
            message: error.message,
            range: new CustomRange(CustomPosition.fromOffset(lineLengths, error.pos[0]), CustomPosition.fromOffset(lineLengths, error.pos[1])),
            severity: 1,
            source: "Mythic Language Server",
        }),
    );
    schema.ifPresent((schema) => {
        const errors = schema.runPreValidation(documentInfo, yamlAst.contents!);
        errors.forEach((error) => {
            error.range !== null &&
                documentInfo.addError({
                    message: error.message,
                    range: error.range,
                    severity: 1,
                    source: "Mythic Language Server",
                });
        });
    });

    const time = Date.now() - now;
    dbg("Parser", `Completed preparsing ${doc.uri} in ${time}ms`);

    return documentInfo;
}

export function postParse(doc: DocumentInfo) {
    dbg("Parser", `Postparsing ${doc.uri} with schema ${doc.schema.map((schema) => schema.name).otherwise("none")}`);
    const now = Date.now();
    doc.schema.ifPresent((schema) => {
        const errors = schema.runPostValidation(doc, doc.yamlAst.contents!);
        errors.forEach((error) => {
            error.range !== null &&
                doc.addError({
                    message: error.message,
                    range: error.range,
                    severity: 1,
                    source: "Mythic Language Server",
                });
        });
    });
    const time = Date.now() - now;
    dbg("Parser", `Completed postparsing ${doc.uri} in ${time}ms`);
    return doc;
}

export function autoComplete(doc: DocumentInfo, cursor: CustomPosition) {
    doc.autoCompletions = []; // clear completions
    doc.schema.ifPresent((schema) => {
        schema.autoComplete(doc, doc.yamlAst.contents!, cursor);
    });
}
