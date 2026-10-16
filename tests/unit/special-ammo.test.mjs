import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryGlobals, makeChatHtml } from "./harness/foundry.mjs";
import { importWithPrivates } from "./harness/load-module.mjs";

const MODULE_ID = "ffg-star-wars-enhancements";
const FLAG_SPECIAL_AMMO = "special-ammo";
const FLAG_AMMO_DATA = "ammo-data";

const PRIVATES = ["_summarizeQualities", "_getValidAmmoItems"];

async function load() {
    return importWithPrivates("scripts/specialAmmo/special_ammo.js", PRIVATES);
}

/* -------------------------------------------------------------------------- */
/* fixtures                                                                   */
/* -------------------------------------------------------------------------- */

function makeItem({ id, name, type, system = {}, flags = {} }) {
    return {
        id,
        name,
        type,
        img: `icons/${id}.webp`,
        system,
        flags,
        getFlag(scope, key) {
            return this.flags?.[scope]?.[key];
        },
        async setFlag(scope, key, value) {
            this.flags[scope] ??= {};
            this.flags[scope][key] = value;
            return this;
        },
        async update(data) {
            for (const [path, value] of Object.entries(data)) {
                const parts = path.split(".");
                const last = parts.pop();
                let target = this;
                for (const part of parts) target = target[part] ??= {};
                target[last] = value;
            }
            return this;
        },
    };
}

function makeWeapon({ hasSpecialAmmo = true, selectedAmmo = "ammo1", ammoFilter = "" } = {}) {
    return makeItem({
        id: "weapon1",
        name: "Blaster Rifle",
        type: "weapon",
        flags: { [MODULE_ID]: { [FLAG_SPECIAL_AMMO]: { hasSpecialAmmo, selectedAmmo, ammoFilter } } },
    });
}

function makeAmmo({
    id = "ammo1",
    name = "Ion Charge Pack",
    canBeUsedAsAmmo = true,
    ammoMax = 10,
    ammoCurrent = 10,
    quantity = 3,
    itemmodifier = [],
    description = "Ionises the target.",
} = {}) {
    return makeItem({
        id,
        name,
        type: "gear",
        system: { quantity: { value: quantity }, itemmodifier, description },
        flags: { [MODULE_ID]: { [FLAG_AMMO_DATA]: { canBeUsedAsAmmo, ammoMax, ammoCurrent } } },
    });
}

function makeActor(items) {
    const list = [...items];
    const actor = {
        id: "actor1",
        name: "Trooper",
        items: Object.assign(list, { get: (id) => list.find((i) => i.id === id) }),
    };
    for (const item of list) item.actor = actor;
    return actor;
}

function install({ actor, settings = {} } = {}) {
    const ctx = installFoundryGlobals({
        settings: {
            "ffg-star-wars-enhancements.special-ammo-enable": true,
            ...settings,
        },
    });
    const actors = actor ? [actor] : [];
    game.actors = Object.assign(actors, {
        get: (id) => actors.find((a) => a.id === id),
        contents: actors,
        tokens: {},
    });
    return ctx;
}

function attackMessage({ weaponId = "weapon1", authorId = "user1" } = {}) {
    // A real ChatMessage carries flags, and special_ammo marks the message once its
    // shot has been paid for so a redraw cannot spend another round.
    const flags = {};
    return {
        rolls: [{ data: { _id: weaponId } }],
        speaker: { actor: "actor1" },
        author: { id: authorId },
        flags,
        getFlag: (scope, key) => flags[scope]?.[key],
        setFlag: async (scope, key, value) => {
            flags[scope] ??= {};
            flags[scope][key] = value;
        },
    };
}

/**
 * Fire the renderChatMessage hook and return the data the chat card was given.
 * The harness's renderTemplate echoes its context, so the card's contents can
 * be read back without a template engine.
 */
async function renderCard(ctx, mod, message, html = makeChatHtml()) {
    if (ctx.hooksFor("renderChatMessage").length === 0) mod.hooks();
    for (const handler of ctx.hooksFor("renderChatMessage")) await handler(message, html, {});
    const appended = html.appended.join("");
    const match = appended.match(/data-template="[^"]*">(.*)<\/div>$/s);
    return match ? JSON.parse(match[1]) : null;
}

const ammoFlagOf = (ammo) => ammo.getFlag(MODULE_ID, FLAG_AMMO_DATA);

/* -------------------------------------------------------------------------- */
/* Spending a round                                                           */
/* -------------------------------------------------------------------------- */

test("ammo: firing the weapon spends one round from the loaded magazine", async () => {
    const ammo = makeAmmo({ ammoCurrent: 10, ammoMax: 10 });
    const ctx = install({ actor: makeActor([makeWeapon(), ammo]) });
    const card = await renderCard(ctx, await load(), attackMessage());
    assert.equal(ammoFlagOf(ammo).ammoCurrent, 9, "nine rounds left in the magazine");
    assert.equal(card.ammoCurrent, 9, "and the card says so");
    assert.equal(card.ammoMax, 10);
    assert.equal(card.outOfAmmo, false);
});

test("ammo: the round spent on one shot is still gone on the next", async () => {
    const ammo = makeAmmo({ ammoCurrent: 10 });
    const ctx = install({ actor: makeActor([makeWeapon(), ammo]) });
    const mod = await load();
    await renderCard(ctx, mod, attackMessage());
    const second = await renderCard(ctx, mod, attackMessage());
    assert.equal(ammoFlagOf(ammo).ammoCurrent, 8);
    assert.equal(second.ammoCurrent, 8);
});

test("ammo: redrawing a message does not spend another round", async () => {
    // The hook's own comment says "Prevent processing the same message twice".
    // Foundry redraws chat messages whenever the log is rebuilt -- on reload,
    // on scroll-back, on an edit -- so a shot already paid for must not be
    // charged again.
    const ammo = makeAmmo({ ammoCurrent: 10 });
    const ctx = install({ actor: makeActor([makeWeapon(), ammo]) });
    const mod = await load();
    const message = attackMessage();
    await renderCard(ctx, mod, message);
    await renderCard(ctx, mod, message);
    assert.equal(ammoFlagOf(ammo).ammoCurrent, 9);
});

test("ammo: an empty magazine spends nothing and says so", async () => {
    const ammo = makeAmmo({ ammoCurrent: 0 });
    const ctx = install({ actor: makeActor([makeWeapon(), ammo]) });
    const card = await renderCard(ctx, await load(), attackMessage());
    assert.equal(card.outOfAmmo, true);
    assert.equal(card.ammoCurrent, 0);
    assert.equal(ammoFlagOf(ammo).ammoCurrent, 0, "the count never goes negative");
});

test("ammo: only the player who rolled pays for the shot", async () => {
    // Every client runs this hook; without the author check the magazine would
    // empty once per player at the table.
    const ammo = makeAmmo({ ammoCurrent: 10 });
    const ctx = install({ actor: makeActor([makeWeapon(), ammo]) });
    const card = await renderCard(ctx, await load(), attackMessage({ authorId: "someone-else" }));
    assert.equal(ammoFlagOf(ammo).ammoCurrent, 10);
    assert.equal(card.ammoCurrent, 10, "the card still shows the real count");
});

/* -------------------------------------------------------------------------- */
/* Running out                                                                */
/* -------------------------------------------------------------------------- */

test("depletion: emptying a magazine consumes one from the pile and loads a fresh one", async () => {
    const ammo = makeAmmo({ ammoCurrent: 1, ammoMax: 10, quantity: 3 });
    const ctx = install({
        actor: makeActor([makeWeapon(), ammo]),
        settings: { "ffg-star-wars-enhancements.special-ammo-auto-deplete": true },
    });
    await renderCard(ctx, await load(), attackMessage());
    assert.equal(ammo.system.quantity.value, 2, "one magazine used up");
    assert.equal(ammoFlagOf(ammo).ammoCurrent, 10, "the next magazine is full");
});

test("depletion: emptying the last magazine leaves nothing behind", async () => {
    const ammo = makeAmmo({ ammoCurrent: 1, ammoMax: 10, quantity: 1 });
    const ctx = install({
        actor: makeActor([makeWeapon(), ammo]),
        settings: { "ffg-star-wars-enhancements.special-ammo-auto-deplete": true },
    });
    await renderCard(ctx, await load(), attackMessage());
    assert.equal(ammo.system.quantity.value, 0, "the pile is empty");
    assert.equal(ammoFlagOf(ammo).ammoCurrent, 0, "and so is the magazine");
});

test("depletion: with the setting off, the magazine simply runs to zero", async () => {
    const ammo = makeAmmo({ ammoCurrent: 1, ammoMax: 10, quantity: 3 });
    const ctx = install({ actor: makeActor([makeWeapon(), ammo]) });
    await renderCard(ctx, await load(), attackMessage());
    assert.equal(ammo.system.quantity.value, 3, "the pile is untouched");
    assert.equal(ammoFlagOf(ammo).ammoCurrent, 0);
});

test("depletion: the card reports how many magazines are left", async () => {
    const ammo = makeAmmo({ ammoCurrent: 5, quantity: 4 });
    const ctx = install({ actor: makeActor([makeWeapon(), ammo]) });
    const card = await renderCard(ctx, await load(), attackMessage());
    assert.equal(card.magazinesLeft, 4);
});

/* -------------------------------------------------------------------------- */
/* When no card is due                                                        */
/* -------------------------------------------------------------------------- */

test("card: a weapon without special ammo produces no card", async () => {
    const ammo = makeAmmo();
    const ctx = install({ actor: makeActor([makeWeapon({ hasSpecialAmmo: false }), ammo]) });
    assert.equal(await renderCard(ctx, await load(), attackMessage()), null);
    assert.equal(ammoFlagOf(ammo).ammoCurrent, 10);
});

test("card: ammo that has left the inventory produces no card and costs nothing", async () => {
    const ctx = install({ actor: makeActor([makeWeapon({ selectedAmmo: "gone" })]) });
    assert.equal(await renderCard(ctx, await load(), attackMessage()), null);
});

test("card: gear not marked as usable ammunition produces no card", async () => {
    const ammo = makeAmmo({ canBeUsedAsAmmo: false });
    const ctx = install({ actor: makeActor([makeWeapon(), ammo]) });
    assert.equal(await renderCard(ctx, await load(), attackMessage()), null);
    assert.equal(ammoFlagOf(ammo).ammoCurrent, 10);
});

test("card: the feature switch silences everything", async () => {
    const ammo = makeAmmo();
    const ctx = install({
        actor: makeActor([makeWeapon(), ammo]),
        settings: { "ffg-star-wars-enhancements.special-ammo-enable": false },
    });
    assert.equal(await renderCard(ctx, await load(), attackMessage()), null);
    assert.equal(ammoFlagOf(ammo).ammoCurrent, 10);
});

test("card: a roll that is not tied to an item produces no card", async () => {
    const ammo = makeAmmo();
    const ctx = install({ actor: makeActor([makeWeapon(), ammo]) });
    const message = attackMessage();
    message.rolls = [{ data: {} }];
    assert.equal(await renderCard(ctx, await load(), message), null);
    assert.equal(ammoFlagOf(ammo).ammoCurrent, 10);
});

/* -------------------------------------------------------------------------- */
/* The qualities the ammunition grants                                        */
/* -------------------------------------------------------------------------- */

const modifier = (name, rank, { id = `mod-${name}`, description = "" } = {}) => ({
    _id: id,
    name,
    system: { rank, description },
});

test("qualities: a ranked quality is labelled with its rank", async () => {
    const ammo = makeAmmo({ itemmodifier: [modifier("Pierce", "2")] });
    const ctx = install({ actor: makeActor([makeWeapon(), ammo]) });
    const card = await renderCard(ctx, await load(), attackMessage());
    assert.deepEqual(card.qualities, [{ label: "Pierce 2", qualityId: "mod-Pierce" }]);
});

test("qualities: an unranked quality is labelled with its name alone", async () => {
    const ammo = makeAmmo({ itemmodifier: [modifier("Disorient", undefined)] });
    const ctx = install({ actor: makeActor([makeWeapon(), ammo]) });
    const card = await renderCard(ctx, await load(), attackMessage());
    assert.deepEqual(card.qualities, [{ label: "Disorient", qualityId: "mod-Disorient" }]);
});

test("qualities: every quality on the ammunition reaches the card", async () => {
    const ammo = makeAmmo({
        itemmodifier: [modifier("Pierce", "2"), modifier("Burn", "1"), modifier("Vicious", "3")],
    });
    const ctx = install({ actor: makeActor([makeWeapon(), ammo]) });
    const card = await renderCard(ctx, await load(), attackMessage());
    assert.deepEqual(
        card.qualities.map((q) => q.label),
        ["Pierce 2", "Burn 1", "Vicious 3"]
    );
});

test("qualities: repeated ranks of the same quality are summarised into one entry", async () => {
    install();
    const { _summarizeQualities } = await load();
    const gear = makeAmmo({
        itemmodifier: [
            modifier("Pierce", "1", { id: "a" }),
            modifier("Pierce", "2", { id: "b" }),
            modifier("Burn", "1", { id: "c" }),
        ],
    });
    const summary = _summarizeQualities(gear);
    assert.deepEqual(
        summary.map((q) => [q.name, q.totalRanks]),
        [
            ["Pierce", 3],
            ["Burn", 1],
        ]
    );
});

test("qualities: a quality with no id falls back to its position", async () => {
    install();
    const { _summarizeQualities } = await load();
    const gear = makeAmmo({ itemmodifier: [{ name: "Pierce", system: { rank: "1" } }] });
    assert.equal(_summarizeQualities(gear)[0].modId, "0");
});

test("qualities: gear with no modifiers summarises to nothing", async () => {
    install();
    const { _summarizeQualities } = await load();
    assert.deepEqual(_summarizeQualities(makeAmmo({ itemmodifier: [] })), []);
});

/* -------------------------------------------------------------------------- */
/* Choosing which gear a weapon may load                                      */
/* -------------------------------------------------------------------------- */

test("selection: only gear named in the filter and marked as ammunition is offered", async () => {
    install();
    const { _getValidAmmoItems } = await load();
    const ion = makeAmmo({ id: "ion", name: "Ion Charge Pack" });
    const stun = makeAmmo({ id: "stun", name: "Stun Pack" });
    const notAmmo = makeAmmo({ id: "rations", name: "Ion Charge Pack", canBeUsedAsAmmo: false });
    const weapon = makeWeapon({ ammoFilter: "Ion Charge Pack" });
    makeActor([weapon, ion, stun, notAmmo]);
    assert.deepEqual(
        _getValidAmmoItems(weapon).map((i) => i.id),
        ["ion"]
    );
});

test("selection: the filter ignores case and stray whitespace", async () => {
    install();
    const { _getValidAmmoItems } = await load();
    const ion = makeAmmo({ id: "ion", name: "Ion Charge Pack" });
    const stun = makeAmmo({ id: "stun", name: "Stun Pack" });
    const weapon = makeWeapon({ ammoFilter: " ion charge pack , STUN PACK ," });
    makeActor([weapon, ion, stun]);
    assert.deepEqual(
        _getValidAmmoItems(weapon).map((i) => i.id),
        ["ion", "stun"]
    );
});

test("selection: an empty filter offers nothing", async () => {
    install();
    const { _getValidAmmoItems } = await load();
    const ion = makeAmmo({ id: "ion", name: "Ion Charge Pack" });
    const weapon = makeWeapon({ ammoFilter: "" });
    makeActor([weapon, ion]);
    assert.deepEqual(_getValidAmmoItems(weapon), []);
});

test("selection: a weapon not set up for special ammo offers nothing", async () => {
    install();
    const { _getValidAmmoItems } = await load();
    const ion = makeAmmo({ id: "ion", name: "Ion Charge Pack" });
    const weapon = makeWeapon({ hasSpecialAmmo: false, ammoFilter: "Ion Charge Pack" });
    makeActor([weapon, ion]);
    assert.deepEqual(_getValidAmmoItems(weapon), []);
});

test("selection: a weapon with no owner offers nothing", async () => {
    install();
    const { _getValidAmmoItems } = await load();
    const weapon = makeWeapon({ ammoFilter: "Ion Charge Pack" });
    assert.deepEqual(_getValidAmmoItems(weapon), []);
});
