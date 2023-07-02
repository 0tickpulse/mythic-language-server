import { Hover, HoverParams, ServerRequestHandler } from "vscode-languageserver";
import { globalData } from "../documentManager.js";
import { p } from "../utils/positionsAndRanges.js";
import { server } from "../index.js";
import { logEvent } from "../utils/logging.js";

export default ({ textDocument, position }: HoverParams) => {
    logEvent("hoverSerivce", textDocument)
    const doc = globalData.documents.getDocument(textDocument.uri);
    if (!doc) {
        return null;
    }
    const hovers = doc.getHoversAt(p(position));
    if (hovers.length === 0) {
        return null;
    }
    return hovers[0];
};
