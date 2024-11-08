import { DocumentSymbol, DocumentSymbolParams, WorkspaceSymbol } from "vscode-languageserver";
import { globalData } from "../documentManager.js";

export interface HasSymbol {
    get symbol(): DocumentSymbol;
    get workspaceSymbol(): WorkspaceSymbol;
}

export default ({ textDocument }: DocumentSymbolParams) => {
    const doc = globalData.documents.getDocument(textDocument.uri);
    if (!doc) {
        return [];
    }
    return doc.getSymbols();
};
