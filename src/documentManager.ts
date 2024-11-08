import { TextDocuments } from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Dependency, DocumentInfo } from "./yaml/parser/documentInfo.js";
import { CachedMythicMob, CachedMythicSkill } from "./mythicModels.js";
import { warn } from "./utils/logging.js";
import { Graph } from "./utils/graph.js";

export const FILE_EXTENSIONS = [".yml", ".yaml", ".mythic"];

export const globalData = {
    documents: {
        manager: new TextDocuments(TextDocument),
        list: new Map<string, DocumentInfo>(),
        getDocument(uri: string) {
            return this.list.get(uri);
        },
        set(doc: DocumentInfo) {
            this.list.set(doc.base.uri, doc);
        },
        delete(uri: string) {
            warn("documentManager", "Unregistering document", uri)
            this.list.delete(uri);
        },
        all() {
            return Array.from(this.list.values());
        }
    },
    mythic: {
        /**
         * A cached registry of Mythic skills as a map of document URI to skill.
         */
        skills: {
            add(skill: CachedMythicSkill) {
                const doc = skill.doc;
                doc.cachedMythicSkills.push(skill);
            },
            all() {
                return globalData.documents.all().flatMap((doc) => doc.cachedMythicSkills);
            },
        },
        /**
         * A cached registry of Mythic mobs as a map of document URI to mob.
         */
        mobs: {
            add(mob: CachedMythicMob) {
                const doc = mob.doc;
                doc.cachedMythicMobs.push(mob);
            },
            all() {
                return globalData.documents.all().flatMap((doc) => doc.cachedMythicMobs);
            },
        }
    },
    flush(uri: string) {
        this.documents.delete(uri);
    },
    reset() {
        this.documents.list.clear();
    }
};
