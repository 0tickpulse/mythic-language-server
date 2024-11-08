#!/usr/bin/env node

import { Connection, ProposedFeatures, createConnection } from "vscode-languageserver/node.js";
import { globalData } from "./documentManager.js";
import colorPresentationService from "./services/colorPresentationService.js";
import completionResolveService from "./services/completionResolveService.js";
import completionService from "./services/completionService.js";
import definitionService from "./services/definitionService.js";
import didChangeContentService from "./services/didChangeContentService.js";
import documentColorService from "./services/documentColorService.js";
import hover from "./services/hoverService.js";
import initializeService from "./services/initializeService.js";
import referenceService from "./services/referenceService.js";
import semanticTokensService from "./services/semanticTokensService.js";
import { dbg, info } from "./utils/logging.js";
import { appendFile } from "fs";
import { TextDocument } from "vscode-languageserver-textdocument";
import { queueFull, scheduleParse } from "./yaml/parser/parseSync.js";
import documentSymbolService from "./services/documentSymbolService.js";
import workspaceSymbolService from "./services/workspaceSymbolService.js";

const connectionType = process.argv.includes("--stdio") ? "stdio" : "ipc";

export const server = {
    connection: undefined as Connection | undefined,
    connectionType,
    data: globalData,
    initialized: false,
    /**
     * Whether or not to highlight YAML syntax along with the custom syntax.
     * In case the client doesn't highlight basic YAML syntax.
     */
    highlightYaml: false,
};

function main() {
    const {
        data: {
            documents: { manager },
        },
    } = server;
    server.connection = createConnection(ProposedFeatures.all);
    const connection = server.connection;
    info(undefined, "Starting server...");
    info(undefined, `Node Version: ${process.version}`);
    info(undefined, `Command: ${process.argv.join(" ")}`);
    info(undefined, `Connection type: ${connectionType}`);
    connection?.onRequest((method, params) => {
        dbg(undefined, `Received unknown request ${method}!`);
    });
    connection?.onInitialize(initializeService);
    connection?.onHover(hover);
    connection?.languages.semanticTokens.on(semanticTokensService);
    connection?.onDefinition(definitionService);
    connection?.onReferences(referenceService);
    connection?.onCompletion(completionService);
    connection?.onCompletionResolve(completionResolveService);
    connection?.onDocumentColor(documentColorService);
    connection?.onColorPresentation(colorPresentationService);
    connection?.onDocumentSymbol(documentSymbolService);
    connection?.onWorkspaceSymbol(workspaceSymbolService);
    connection?.onShutdown(() => {
        info(undefined, "Shutting down server...");
    });
    connection?.onRequest("debug/printDependencies", ({ uri }: { uri: string }) => {
        dbg(undefined, `Requested dependencies for doc ${uri}`);
        const dependencies: string[] = [];
        const dependents: string[] = [];
        const docInfo = globalData.documents.getDocument(uri);
        docInfo?.traverseDependencies((dep) => {
            dependencies.push(dep.id);
        });
        docInfo?.traverseDependents((dep) => {
            dependents.push(dep.id);
        });
        return {
            dependencies,
            dependents,
        };
    });
    connection?.onRequest("debug/printDocumentInfo", ({ uri }: { uri: string }) => {
        const docInfo = globalData.documents.getDocument(uri);
        if (!docInfo) {
            return "Document not found!";
        }
        return docInfo.printStats();
    });
    connection?.onRequest("document/forceFullParseDoc", ({ uri }: { uri: string }) => {
        const docInfo = globalData.documents.getDocument(uri);
        if (!docInfo) {
            return "Document not found!";
        }
        queueFull(docInfo.base);
        return "Done!";
    });
    connection?.onRequest("document/resendSemanticTokens", () => {
        connection.languages.semanticTokens.refresh();
        return "Done!";
    });

    manager.onDidChangeContent(didChangeContentService);
    manager.listen(server.connection);
    connection?.listen();
    process.on("exit", (c) => {
        info(undefined, `Server exiting with code ${c}`);
    });
    process.stdin.on("data", (data) => {
        appendFile("server.stdin.log", data.toString(), () => {
            /* empty */
        });
    });
    process.stdout.on("data", (data) => {
        appendFile("server.stdout.log", data.toString(), () => {
            /* empty */
        });
    });
    server.initialized = true;
}

if (require.main === module) {
    main();
}
