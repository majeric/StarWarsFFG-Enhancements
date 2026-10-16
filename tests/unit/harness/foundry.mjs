/**
 * A deliberately small stand-in for the Foundry globals, adapted for this
 * module from the sibling system repo's harness
 * (systems/starwarsffg/tests/unit/harness/foundry.mjs).
 *
 * It is NOT a Foundry emulator. It provides just enough of `game`, `CONFIG`,
 * `CONST`, `ui`, `Hooks`, `foundry.utils`, `DicePoolFFG`, `libWrapper` and a
 * jQuery-shaped `$` for the module's own functions to run in plain Node.
 *
 * Call installFoundryGlobals() BEFORE importing any module file, because the
 * scripts read globals as soon as their functions run:
 *
 *   import { installFoundryGlobals } from "./harness/foundry.mjs";
 *   installFoundryGlobals();
 *   const mod = await importWithPrivates("scripts/rename.js", ["rename_combatant"]);
 */

/* -------------------------------------------------------------------------- */
/* utils                                                                      */
/* -------------------------------------------------------------------------- */

const isPlainObject = (v) =>
    v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

export function deepClone(value) {
    if (Array.isArray(value)) return value.map(deepClone);
    if (isPlainObject(value)) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepClone(v)]));
    }
    return value;
}

export function mergeObject(original, other = {}, { insertKeys = true, overwrite = true } = {}) {
    const result = deepClone(original ?? {});
    for (const [key, value] of Object.entries(other ?? {})) {
        const exists = Object.prototype.hasOwnProperty.call(result, key);
        if (!exists && !insertKeys) continue;
        if (isPlainObject(value) && isPlainObject(result[key])) {
            result[key] = mergeObject(result[key], value, { insertKeys, overwrite });
        } else if (!exists || overwrite) {
            result[key] = deepClone(value);
        }
    }
    return result;
}

export function getProperty(object, key) {
    if (!key || !object) return undefined;
    return key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), object);
}

export function setProperty(object, key, value) {
    const parts = key.split(".");
    const last = parts.pop();
    const target = parts.reduce((o, k) => (o[k] ??= {}), object);
    const changed = target[last] !== value;
    target[last] = value;
    return changed;
}

let idCounter = 0;
export function randomID(length = 16) {
    idCounter += 1;
    return `id${String(idCounter).padStart(length - 2, "0")}`;
}

/* -------------------------------------------------------------------------- */
/* CONST                                                                      */
/* -------------------------------------------------------------------------- */

export const CONST = Object.freeze({
    CHAT_MESSAGE_STYLES: { OTHER: 0, OOC: 1, IC: 2, EMOTE: 3 },
    TOKEN_DISPOSITIONS: { SECRET: -2, HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 },
    DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 },
    JOURNAL_ENTRY_PAGE_FORMATS: { HTML: 1, MARKDOWN: 2 },
    USER_ROLES: { NONE: 0, PLAYER: 1, TRUSTED: 2, ASSISTANT: 3, GAMEMASTER: 4 },
});

/* -------------------------------------------------------------------------- */
/* DicePoolFFG                                                                */
/*                                                                            */
/* A faithful copy of the parts of the system's DicePoolFFG that the module    */
/* uses (systems/starwarsffg/modules/dice/pool.js): the constructor defaults,  */
/* upgrade(), upgradeDifficulty() and renderDiceExpression().                  */
/* -------------------------------------------------------------------------- */

export class DicePoolFFG {
    constructor(obj = {}) {
        if (typeof obj === "string") obj = JSON.parse(obj);
        this.proficiency = obj.proficiency || 0;
        this.ability = obj.ability || 0;
        this.challenge = obj.challenge || 0;
        this.difficulty = obj.difficulty || 0;
        this.boost = obj.boost || 0;
        this.setback = obj.setback || 0;
        this.remsetback = obj.remsetback || 0;
        this.force = obj.force || 0;
        this.advantage = obj.advantage || 0;
        this.success = obj.success || 0;
        this.threat = obj.threat || 0;
        this.failure = obj.failure || 0;
        this.light = obj.light || 0;
        this.dark = obj.dark || 0;
        this.triumph = obj.triumph || 0;
        this.despair = obj.despair || 0;
        this.upgrades = obj.upgrades || 0;
        this.source = {};
    }

    upgrade(times) {
        if (times === undefined) times = 1;
        let downgrade = false;
        if (times < 0) {
            downgrade = true;
            times = Math.abs(times);
        }
        for (let i = 0; i < times; i++) {
            if (downgrade) {
                if (this.proficiency > 0) {
                    this.proficiency--;
                    this.ability++;
                }
            } else if (this.ability > 0) {
                this.ability--;
                this.proficiency++;
            } else {
                this.ability++;
            }
        }
    }

    upgradeDifficulty(times) {
        if (times === undefined) times = 1;
        let downgrade = false;
        if (times < 0) {
            downgrade = true;
            times = Math.abs(times);
        }
        for (let i = 0; i < times; i++) {
            if (downgrade) {
                if (this.challenge > 0) {
                    this.challenge--;
                    this.difficulty++;
                }
            } else if (this.difficulty > 0) {
                this.difficulty--;
                this.challenge++;
            } else {
                this.difficulty++;
            }
        }
    }

    renderDiceExpression() {
        const setbackDice = game.settings.get("starwarsffg", "ApplyRemoveSetbackMods")
            ? Math.max(0, this.setback - this.remsetback)
            : this.setback;
        const dicePool = [
            this.proficiency + "dp",
            this.ability + "da",
            this.challenge + "dc",
            this.difficulty + "di",
            this.boost + "db",
            setbackDice + "ds",
            this.force + "df",
        ];
        return dicePool.filter((d) => d.split(/([0-9]+)/)[1] > 0).join("+");
    }
}

/* -------------------------------------------------------------------------- */
/* jQuery shim                                                                */
/*                                                                            */
/* The module reaches for jQuery in three ways: `$(htmlString).data(key)` to   */
/* read the dice-helper button's metadata, `$(document).on(...)` to register   */
/* delegated handlers, and `jQuery.isEmptyObject`. Only the first carries any  */
/* logic worth testing, so only that is modelled properly -- including         */
/* jQuery's coercion of numeric data attributes to numbers.                    */
/* -------------------------------------------------------------------------- */

function coerceDataValue(raw) {
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "null") return null;
    if (raw !== "" && String(Number(raw)) === raw) return Number(raw);
    return raw;
}

class FakeNode {
    constructor(html) {
        this.__fakeNode = true;
        this.html = html;
        this.length = 1;
        this.handlers = [];
        this.appended = [];
        this.attrs = {};
    }
    data(key) {
        if (key === undefined) return {};
        const match = this.html.match(new RegExp(`data-${key}="([^"]*)"`));
        if (!match) return undefined;
        return coerceDataValue(match[1]);
    }
    attr(name, value) {
        if (value === undefined) return this.attrs[name];
        this.attrs[name] = value;
        return this;
    }
    find() {
        return new FakeEmpty();
    }
    append(content) {
        this.appended.push(content);
        return this;
    }
    on(...args) {
        this.handlers.push(args);
        return this;
    }
    off() {
        return this;
    }
    is() {
        return false;
    }
    closest() {
        return new FakeEmpty();
    }
    last() {
        return this;
    }
    after() {
        return this;
    }
}

class FakeEmpty {
    constructor() {
        this.__fakeNode = true;
        this.length = 0;
        this.appended = [];
    }
    on() {
        return this;
    }
    off() {
        return this;
    }
    find() {
        return this;
    }
    append(c) {
        this.appended.push(c);
        return this;
    }
    data() {
        return undefined;
    }
    attr() {
        return undefined;
    }
    last() {
        return this;
    }
    after() {
        return this;
    }
    prepend() {
        return this;
    }
    is() {
        return false;
    }
}

/**
 * A chat-message element stand-in: records what the module appended to it and
 * reports zero matches for every selector, the way a freshly rendered message
 * does.
 */
export function makeChatHtml() {
    const node = new FakeNode("<div class='message'></div>");
    node.appended = [];
    return node;
}

function makeJQuery() {
    const $ = (arg) => {
        if (typeof arg === "string") return new FakeNode(arg);
        if (arg && arg.__fakeNode) return arg;
        return new FakeNode("<document/>");
    };
    $.isEmptyObject = (o) => o == null || Object.keys(o).length === 0;
    $.getJSON = async () => ({});
    return $;
}

/* -------------------------------------------------------------------------- */
/* installation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * @param {object}  [options]
 * @param {object}  [options.settings] Pre-seeded settings keyed "namespace.key";
 *                                     merged over the module's own defaults.
 * @param {object}  [options.i18n]     Translation table for game.i18n.localize.
 * @param {object}  [options.game]     Extra game entries (merged over the defaults).
 * @param {boolean} [options.isGM]     Whether the acting user is a GM. Defaults to true.
 * @returns {{notifications: object[], hooks: Map, chatMessages: object[], settings: Map, reset: Function}}
 */
export function installFoundryGlobals(options = {}) {
    const notifications = [];
    const chatMessages = [];
    const hooks = new Map();
    const socketEmits = [];

    const DEFAULT_SETTINGS = {
        // the system settings the module reads
        "starwarsffg.enableDebug": false,
        "starwarsffg.ApplyRemoveSetbackMods": false,
        "starwarsffg.skilltheme": "starwars",
        // module defaults, copied from each script's init()
        "ffg-star-wars-enhancements.dice-helper": true,
        "ffg-star-wars-enhancements.dice-helper-data": "dice_helper",
        "ffg-star-wars-enhancements.auto-rename-actors": false,
        "ffg-star-wars-enhancements.auto-rename-actors_friendly":
            "systems/starwarsffg/images/dice/starwars/lightside.png",
        "ffg-star-wars-enhancements.auto-rename-actors_enemy":
            "systems/starwarsffg/images/dice/starwars/darkside.png",
        "ffg-star-wars-enhancements.auto-rename-actors_neutral":
            "systems/starwarsffg/images/dice/starwars/lightside.png",
        "ffg-star-wars-enhancements.talent-skill-association": true,
        "ffg-star-wars-enhancements.special-ammo-enable": false,
        "ffg-star-wars-enhancements.special-ammo-auto-deplete": false,
        "ffg-star-wars-enhancements.strain-reminder": false,
        "ffg-star-wars-enhancements.general_shop_compendiums": "test.general",
        "ffg-star-wars-enhancements.armor_shop_compendiums": "test.armor",
        "ffg-star-wars-enhancements.gear_shop_compendiums": "test.gear",
        "ffg-star-wars-enhancements.weapon_shop_compendiums": "test.weapon",
    };

    const settings = new Map(
        Object.entries({ ...DEFAULT_SETTINGS, ...(options.settings ?? {}) })
    );
    const i18nTable = options.i18n ?? {};

    class StubDocument {
        constructor(data = {}) {
            Object.assign(this, data);
            this.flags ??= {};
            this.system ??= {};
        }
        static create(data) {
            return Promise.resolve(new this(data));
        }
        /** Expands dotted keys the way a real Document#update does. */
        update(data) {
            for (const [key, value] of Object.entries(data ?? {})) {
                if (key.includes(".")) setProperty(this, key, value);
                else this[key] = value;
            }
            return Promise.resolve(this);
        }
        getFlag(scope, key) {
            return getProperty(this.flags?.[scope] ?? {}, key);
        }
        setFlag(scope, key, value) {
            this.flags[scope] ??= {};
            this.flags[scope][key] = value;
            return Promise.resolve(this);
        }
        unsetFlag(scope, key) {
            delete this.flags?.[scope]?.[key];
            return Promise.resolve(this);
        }
        toObject() {
            return deepClone({ ...this });
        }
    }

    class StubApplication {
        constructor(object = {}, opts = {}) {
            this.object = object;
            this.options = opts;
        }
        static get defaultOptions() {
            return {};
        }
        render() {
            return this;
        }
    }

    for (const name of ["Application", "FormApplication", "Dialog", "ItemSheet", "ActorSheet"]) {
        globalThis[name] = class extends StubApplication {};
    }
    for (const name of ["Actor", "Item", "Combatant", "JournalEntry", "Scene", "TokenDocument"]) {
        globalThis[name] = class extends StubDocument {};
    }
    globalThis.ChatMessage = class extends StubDocument {
        static create(data) {
            chatMessages.push(data);
            return Promise.resolve(new this(data));
        }
    };
    globalThis.InteractionLayer = class {
        static get layerOptions() {
            return {};
        }
    };
    globalThis.CanvasLayer = globalThis.InteractionLayer;

    globalThis.DicePoolFFG = DicePoolFFG;
    globalThis.CONST = CONST;
    globalThis.$ = makeJQuery();
    globalThis.jQuery = globalThis.$;
    globalThis.document = { createElement: () => ({ set innerHTML(v) { this.textContent = v; } }) };
    // Browsers define window.status as an empty string. scripts/shop.js refers to
    // a bare `status` identifier, so this mirrors what it really resolves to in
    // Foundry rather than throwing a ReferenceError that Node alone would raise.
    globalThis.status = "";

    globalThis.renderTemplate = async (path, data) =>
        `<div class="rendered" data-template="${path}">${JSON.stringify(data)}</div>`;
    globalThis.getTemplate = async (path) => (ctx) =>
        `<div class="rendered" data-template="${path}">${JSON.stringify(ctx)}</div>`;
    globalThis.TextEditor = { enrichHTML: async (html) => html };
    globalThis.fromUuid = async () => null;
    globalThis.Handlebars = { registerHelper: () => {} };
    globalThis.libWrapper = { register: () => {}, unregister: () => {} };

    globalThis.foundry = {
        utils: { mergeObject, deepClone, duplicate: deepClone, randomID, getProperty, setProperty },
        applications: { ux: { TextEditor: { enrichHTML: async (html) => html } } },
    };

    const record = (type) => (message) => {
        notifications.push({ type, message });
        return message;
    };
    globalThis.ui = {
        notifications: { error: record("error"), warn: record("warn"), info: record("info") },
    };

    globalThis.Hooks = {
        on: (event, fn) => {
            if (!hooks.has(event)) hooks.set(event, []);
            hooks.get(event).push(fn);
            return fn;
        },
        once: (event, fn) => globalThis.Hooks.on(event, fn),
        call: () => true,
        callAll: () => true,
    };

    globalThis.CONFIG = { FFG: {}, Canvas: { layers: {} } };

    globalThis.game = mergeObject(
        {
            system: { version: "2.0.4", id: "starwarsffg" },
            user: { id: "user1", isGM: options.isGM ?? true, name: "Tester" },
            actors: Object.assign([], { get: () => undefined, contents: [], tokens: {} }),
            items: new Map(),
            packs: new Map(),
            journal: [],
            messages: new Map(),
            socket: { on: () => {}, emit: (...args) => socketEmits.push(args) },
            i18n: {
                localize: (key) => i18nTable[key] ?? key,
                format: (key, data = {}) =>
                    `${key}:${Object.entries(data)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(",")}`,
                has: (key) => key in i18nTable,
                lang: "en",
            },
            settings: {
                get: (namespace, key) => settings.get(`${namespace}.${key}`),
                set: async (namespace, key, value) => settings.set(`${namespace}.${key}`, value),
                register: (namespace, key, cfg) => {
                    if (!settings.has(`${namespace}.${key}`)) {
                        settings.set(`${namespace}.${key}`, cfg?.default);
                    }
                },
                registerMenu: () => {},
            },
            // the system's own namespace
            ffg: {
                RollFFG: class {
                    constructor(formula) {
                        this.formula = formula;
                        this.ffg = {
                            success: 0,
                            failure: 0,
                            advantage: 0,
                            threat: 0,
                            triumph: 0,
                            despair: 0,
                        };
                    }
                    async roll() {
                        return this;
                    }
                },
                ActorFFG: globalThis.Actor,
                config: {},
            },
        },
        options.game ?? {}
    );

    globalThis.canvas = { scene: null, tokens: { placeables: [] }, ready: true };

    return {
        notifications,
        chatMessages,
        socketEmits,
        hooks,
        settings,
        /** Return the callbacks registered for a hook, in registration order. */
        hooksFor: (event) => hooks.get(event) ?? [],
        reset() {
            notifications.length = 0;
            chatMessages.length = 0;
            socketEmits.length = 0;
            hooks.clear();
        },
    };
}
