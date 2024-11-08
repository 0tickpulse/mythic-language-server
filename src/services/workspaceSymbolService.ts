import { WorkspaceSymbol } from "vscode-languageserver";
import { globalData } from "../documentManager.js";
import { server } from "../index.js";

export default () => {
    const symbols: WorkspaceSymbol[] = [];
    for (const skill of globalData.mythic.skills.all()) {
        symbols.push(skill.workspaceSymbol);
    }
    for (const mob of globalData.mythic.mobs.all()) {
        symbols.push(mob.workspaceSymbol);
    }
    server.connection?.window.showInformationMessage(`Found ${symbols.length} symbols`);
    return symbols;
}
