import { Node, isMap, isScalar } from "yaml";
import { mdSeeAlso } from "../../../utils/utils.js";
import { DocumentInfo } from "../../parser/documentInfo.js";
import mobTypes from "../bigData/mobTypes.js";
import { YMap, YObj, YUnion, YString, YNum, YBool, YArr, YMythicSkill, YamlSchema, SchemaValidationError } from "../schemaTypes.js";
import { DAMAGE_TYPES } from "../bigData/damageTypes.js";
import { getNodeValueRange } from "../schemaUtils.js";
import { SemanticTokenTypes } from "vscode-languageserver";
import { Highlight } from "../../../colors.js";
import { dbg } from "../../../utils/logging.js";
import { CustomPosition, CustomRange } from "../../../utils/positionsAndRanges.js";
import { globalData } from "../../../documentManager.js";
import { Optional, stripIndentation } from "tick-ts-utils";
import { CachedMythicMob } from "../../../mythicModels.js";
import { YMythicSkillArr } from "./mythicSkill.js";
import { Resolver } from "../../../mythicParser/resolver.js";
class YDamageModifier extends YString {
    override preValidate(doc: DocumentInfo, value: Node): SchemaValidationError[] {
        const errors = super.preValidate(doc, value);
        if (!isScalar(value)) {
            return []; // unreachable but isScalar is a type guard
        }
        if (errors.length > 0) {
            return errors;
        }

        // format: "MODIFIER VALUE"
        // modifier is one of DAMAGE_TYPES, but can be anything.
        // if its one of DAMAGE_TYPES, it will be highlighted as a damage type
        // value is a number
        const [modifier, ...rest] = value.toString().split(" ");
        const { yamlRange, range } = getNodeValueRange(doc, value);
        dbg("YDamageModifier", `Modifier: ${modifier}, rest: ${rest}`);
        const upper = modifier.toUpperCase();
        if (Object.keys(DAMAGE_TYPES).includes(upper)) {
            const newRange = CustomRange.fromYamlRange(doc.lineLengths, [
                yamlRange[0],
                yamlRange[0] + modifier.length,
                yamlRange[0] + modifier.length,
            ]);
            dbg("YDamageModifier", `Adding highlight for ${modifier}: ${newRange}`);
            doc.addHighlight(new Highlight(newRange, SemanticTokenTypes.enumMember));
            doc.addHover({
                range: newRange,
                contents: {
                    kind: "markdown",
                    value: `# Damage type: \`${upper}\`\n\n${(DAMAGE_TYPES as Record<string, string>)[upper]}`,
                },
            });
        }
        // check if there's nothing after the modifier
        if (rest.length === 0) {
            dbg("YDamageModifier", `Adding error for ${modifier}: ${yamlRange}`);
            errors.push(new SchemaValidationError(this, "Missing a value for the damage modifier!", doc, value, range));
            return errors;
        }
        const num = Number(rest.join(" "));
        const numRange = CustomRange.fromYamlRange(doc.lineLengths, [yamlRange[0] + modifier.length + 1, yamlRange[1], yamlRange[2]]);
        dbg("YDamageModifier", `Num: ${num}, range: ${numRange}`);
        if (isNaN(num)) {
            dbg("YDamageModifier", `Adding error for ${num}: ${numRange}`);
            errors.push(new SchemaValidationError(this, "Invalid value. Must be a number.", doc, value, numRange));
        } else {
            doc.addHighlight(new Highlight(numRange, SemanticTokenTypes.number));
        }

        return errors;
    }
    override autoComplete(doc: DocumentInfo, value: Node, cursor: CustomPosition): void {
        Object.keys(DAMAGE_TYPES).forEach((key) => {
            const item = new YString(key);
            item.completionItem = Optional.of({
                label: key,
                documentation: {
                    kind: "markdown",
                    value: `# Damage type: \`${key}\`\n\n${(DAMAGE_TYPES as Record<string, string>)[key]}`,
                },
            });
            item.autoComplete(doc, value, cursor);
        });
    }
}

export class YMythicMobMap extends YamlSchema {
    static generateKeyHover(name: string) {
        return stripIndentation`# MythicMob: \`${name}\`

        MythicMobs is based all around customized entities/mobs and there are
        plenty of options, attributes that you can utilize.

        ## See Also

        * [🔗 Wiki: Mobs](https://git.lumine.io/mythiccraft/MythicMobs/-/wikis/Mobs/Mobs)
        `;
    }
    constructor(public valueFn: (cached: CachedMythicMob) => YObj) {
        super();
    }
    override getDescription() {
        return "a map in which values are each a mob";
    }
    override preValidate(doc: DocumentInfo, value: Node): SchemaValidationError[] {
        if (!isMap(value)) {
            return [new SchemaValidationError(this, `Expected type ${this.typeText}!`, doc, value)];
        }

        const errors: SchemaValidationError[] = [];

        const { items } = value;
        const keys: Set<string> = new Set();
        for (const item of items) {
            let cachedMob: CachedMythicMob | undefined = undefined;
            if (item.key !== null) {
                const keyNode = item.key as Node;
                const key = keyNode.toString();
                if (keys.has(key)) {
                    errors.push(new SchemaValidationError(this, `Duplicate key ${key}!`, doc, keyNode));
                } else {
                    const declarationRange = CustomRange.fromYamlRange(doc.lineLengths, keyNode.range!);
                    cachedMob = new CachedMythicMob(doc, [keyNode, item.value as Node], declarationRange, key);
                    globalData.mythic.mobs.add(cachedMob);
                    doc.addHover({
                        range: declarationRange,
                        contents: YMythicMobMap.generateKeyHover(key),
                    });
                    doc.addHighlight(new Highlight(declarationRange, SemanticTokenTypes.class, ["declaration"]));
                }
            }
            if (cachedMob) {
                const values = this.valueFn(cachedMob);
                const error = values.runPreValidation(doc, item.value as Node);
                errors.push(...error);
            }
        }
        return errors;
    }
    override postValidate(doc: DocumentInfo, value: Node): SchemaValidationError[] {
        if (!isMap(value)) {
            return [];
        }
        const errors: SchemaValidationError[] = [];
        const { items } = value;
        for (const item of items) {
            const key = item.key as Node;
            const cachedMob = doc.cachedMythicMobs.find((s) => s.name === key.toString());
            if (cachedMob) {
                const values = this.valueFn(cachedMob);
                const error = values.runPostValidation(doc, item.value as Node);
                errors.push(...error);
            }
        }
        return errors;
    }
    override autoComplete(doc: DocumentInfo, value: Node, cursor: CustomPosition): void {
        isMap(value) &&
            value.items.forEach((item) => {
                const key = item.key as Node;
                const cachedMob = doc.cachedMythicMobs.find((s) => s.name === key.toString());
                if (cachedMob) {
                    const values = this.valueFn(cachedMob);
                    values.autoComplete(doc, item.value as Node, cursor);
                }
            });
    }
    get rawTypeText() {
        return `mythic_mob_map`;
    }
}

export const mythicMobSchema: YamlSchema = new YMythicMobMap(
    (cached: CachedMythicMob) =>
        new YObj({
            Type: {
                schema: YUnion.nonCaseSensitiveLiterals(...mobTypes).setName("mob_type"),
                required: false,
                description: "The entity type of the mob." + mdSeeAlso("Mobs/Mobs#type"),
            },
            Display: {
                schema: new YString(),
                required: false,
                description: "The display name of the mob. Supports MiniMessage." + mdSeeAlso("Mobs/Mobs#display"),
            },
            Health: {
                schema: new YNum(0, undefined, true),
                required: false,
                description:
                    "The base health of the mob. Note that it caps at `2048` unless set otherwise in your server's `spigot.yml`." +
                    mdSeeAlso("Mobs/Mobs#health"),
            },
            Damage: {
                schema: new YNum(0, undefined, true),
                required: false,
                description: "The base damage of the mob. 1 damage = 0.5 hearts." + mdSeeAlso("Mobs/Mobs#damage"),
            },
            Armor: {
                schema: new YNum(0, 30, true, true),
                required: false,
                description: "The base armor of the mob. Note that it caps at `30`." + mdSeeAlso("Mobs/Mobs#armor"),
            },
            HealthBar: {
                schema: new YObj({
                    Enabled: {
                        schema: new YBool(),
                        required: true,
                        description: "Whether the health bar is enabled.",
                    },
                    Offset: {
                        schema: new YNum(),
                        required: false,
                        description: "The offset of the health bar from the mob's head.",
                    },
                }),
                required: false,
                description:
                    "Creates a basic healthbar hologram for the mob. Requires plugin [🔗 Holograms](https://www.spigotmc.org/resources/holograms.4924/) or [🔗 HolographicDisplays](https://dev.bukkit.org/projects/holographic-displays)." +
                    mdSeeAlso("Mobs/Mobs#healthbar"),
            },
            BossBar: {
                schema: new YObj({
                    Enabled: {
                        schema: new YBool(),
                        required: true,
                        description: "Whether the bossbar is enabled.",
                    },
                    Title: {
                        schema: new YString(),
                        required: false,
                        description: "The title of the bossbar.",
                    },
                    Range: {
                        schema: new YNum(),
                        required: false,
                        description: "The range that players can see the bossbar from.",
                    },
                    Color: {
                        schema: YUnion.literals("PINK", "BLUE", "RED", "GREEN", "YELLOW", "PURPLE", "WHITE"),
                        required: false,
                        description: "The color of the bossbar. Case-sensitive.",
                    },
                    Style: {
                        schema: YUnion.literals("SOLID", "SEGMENTED_6", "SEGMENTED_10", "SEGMENTED_12", "SEGMENTED_20"),
                        required: false,
                        description: "The style of the bossbar. Case-sensitive",
                    },
                    CreateFog: {
                        schema: new YBool(),
                        required: false,
                        description: "Whether to create fog on the player's vision in the radius of the bossbar.",
                    },
                    DarkenSky: {
                        schema: new YBool(),
                        required: false,
                        description: "Whether to darken the sky in the radius of the bossbar, similar to when the Wither is spawned.",
                    },
                    PlayMusic: {
                        schema: new YBool(),
                        required: false,
                        description: "Whether to play music in the radius of the bossbar.",
                    },
                }),
                required: false,
                description: "Optionally configure a bossbar for the mob." + mdSeeAlso("Mobs/Mobs#bossbar", "Mobs/Bossbar"),
            },
            Faction: {
                schema: new YString(), // TODO: Have the list of factions be dynamically generated from the workspace
                required: false,
                description:
                    "The faction of the mob, alphanumeric and case-sensitive. This can be used for some advanced [🔗 custom AI configurations](https://git.lumine.io/mythiccraft/MythicMobs/-/wikis/Mobs/Custom-AI) or [🔗 target filtering](https://git.lumine.io/mythiccraft/MythicMobs/-/wikis/Skills/Targeters#targeter-options)." +
                    mdSeeAlso("Mobs/Mobs#faction"),
            },
            Options: {
                schema: new YamlSchema(), // TODO: Add options
                required: false,
                description: "A special field for some sub-options." + mdSeeAlso("Mobs/Mobs#options", "Mobs/Options"),
            },
            Modules: {
                schema: new YObj({
                    ThreatTables: {
                        schema: new YBool(),
                        required: false,
                        description: "Whether to use threat tables for this mob." + mdSeeAlso("Mobs/ThreatTables"),
                    },
                    ImmunityTables: {
                        schema: new YBool(),
                        required: false,
                        description: "Whether to use immunity tables for this mob." + mdSeeAlso("Mobs/ImmunityTables"),
                    },
                }),
                required: false,
                description:
                    "A field to enable or disable certain modules like [🔗 threat tables](https://git.lumine.io/mythiccraft/MythicMobs/-/wikis/Mobs/ThreatTables) or [🔗 immunity tables](https://git.lumine.io/mythiccraft/MythicMobs/-/wikis/Mobs/ImmunityTables)." +
                    mdSeeAlso("Mobs/Mobs#modules"),
            },
            AIGoalSelectors: {
                schema: new YArr(new YString()), // TODO: Add AI goal selectors
                required: false,
                description: "Modifies the AI Goals of the mob." + mdSeeAlso("Mobs/Mobs#aigoalselectors", "Mobs/Custom-AI#ai-goal-selectors"),
            },
            AITargetSelectors: {
                schema: new YArr(new YString()), // TODO: Add AI target selectors
                required: false,
                description: "Modifies the AI Targets of the mob." + mdSeeAlso("Mobs/Mobs#aitargetselectors", "Mobs/Custom-AI#ai-target-selectors"),
            },
            Drops: {
                schema: new YArr(new YString()), // TODO: Add drops
                required: false,
                description: "Modifies the drops of the mob." + mdSeeAlso("Mobs/Mobs#drops", "drops/Drops"),
            },
            Skills: {
                schema: new YMythicSkillArr(new YMythicSkill(true), new Resolver(cached.doc, cached)),
                required: false,
                description: "Modifies the skills of the mob." + mdSeeAlso("Mobs/Mobs#skills", "Skills/Skills"),
            },
            Disguise: {
                schema: new YString(), // TODO: Add disguises
                required: false,
                description:
                    "Modifies the disguise of the mob. Requires the plugin [🔗 LibsDisguises](https://www.spigotmc.org/resources/libs-disguises-free.81/)." +
                    mdSeeAlso("Mobs/Mobs#disguise", "Mobs/Disguises"),
            },
            DamageModifiers: {
                schema: new YArr(new YDamageModifier()),
                required: false,
                description: "Modifies the damage modifiers of the mob." + mdSeeAlso("Mobs/Mobs#damagemodifiers", "Mobs/DamageModifiers"),
            },
        }),
);
