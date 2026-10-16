import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryGlobals } from "./harness/foundry.mjs";
import { importWithPrivates } from "./harness/load-module.mjs";

const ACTOR_ID = "vendor-customer";

/* -------------------------------------------------------------------------- */
/* fixtures                                                                   */
/* -------------------------------------------------------------------------- */

function makeSkill(overrides = {}) {
    return {
        rank: 0,
        characteristic: "Presence",
        boost: 0,
        setback: 0,
        force: 0,
        advantage: 0,
        dark: 0,
        light: 0,
        failure: 0,
        threat: 0,
        success: 0,
        triumph: 0,
        despair: 0,
        ...overrides,
    };
}

function makeShopper({ negotiation = {}, streetwise = {}, characteristics = {} } = {}) {
    return {
        id: ACTOR_ID,
        name: "Shopper",
        type: "character",
        hasPlayerOwner: true,
        system: {
            characteristics: {
                Presence: { value: 2 },
                Cunning: { value: 2 },
                ...characteristics,
            },
            skills: {
                Negotiation: makeSkill({ characteristic: "Presence", ...negotiation }),
                Streetwise: makeSkill({ characteristic: "Cunning", ...streetwise }),
            },
        },
    };
}

let itemSerial = 0;
function makeItem({
    name = `Item ${++itemSerial}`,
    type = "gear",
    price = 100,
    rarity = 0,
    restricted = false,
    tags = null,
    img = "icons/svg/mystery-man.svg",
} = {}) {
    return {
        id: name.toLowerCase().replace(/\s+/g, "-"),
        name,
        type,
        img,
        system: {
            price: { value: price },
            rarity: { adjusted: rarity, isrestricted: restricted },
            ...(tags ? { metadata: { tags } } : {}),
        },
    };
}

function makePack(items) {
    return {
        async getDocuments() {
            return items;
        },
        async getDocument(id) {
            return items.find((i) => i.id === id);
        },
    };
}

/**
 * @param {object} opts
 * @param {object[]} opts.items  Compendium contents for "test.general".
 * @param {object}   opts.actor  The shopper making the availability check.
 * @param {object}   opts.roll   The ffg result every availability check returns.
 */
function install({ items = [], actor = makeShopper(), roll = { success: 1 } } = {}) {
    const ctx = installFoundryGlobals();
    const actors = [actor];
    game.actors = Object.assign(actors, {
        get: (id) => actors.find((a) => a.id === id),
        contents: actors,
        tokens: {},
    });
    game.packs = new Map([["test.general", makePack(items)]]);
    game.ffg.RollFFG = class {
        constructor(formula) {
            this.formula = formula;
            this.ffg = {
                success: 0,
                failure: 0,
                advantage: 0,
                threat: 0,
                triumph: 0,
                despair: 0,
                ...roll,
            };
        }
        async roll() {
            return this;
        }
    };
    return ctx;
}

async function loadShop() {
    const mod = await importWithPrivates("scripts/shop.js", ["Shop", "get_player_actors"]);
    return mod;
}

/** Build a Shop with sensible defaults; override positionally-named fields. */
function newShop(Shop, overrides = {}) {
    const o = {
        shady: false,
        specialization: "general",
        min_items: 1,
        max_items: 1,
        location: "no_change",
        actor: ACTOR_ID,
        base_price: 100,
        min_price: 0,
        max_price: 100000,
        tags_must_contain: "",
        tags_must_not_contain: "",
        ...overrides,
    };
    return new Shop(
        o.shady,
        o.specialization,
        o.min_items,
        o.max_items,
        o.location,
        o.actor,
        o.base_price,
        o.min_price,
        o.max_price,
        o.tags_must_contain,
        o.tags_must_not_contain
    );
}

/** Run `fn` with Math.random pinned to a fixed value. */
async function withRandom(value, fn) {
    const original = Math.random;
    Math.random = () => value;
    try {
        return await fn();
    } finally {
        Math.random = original;
    }
}

/* -------------------------------------------------------------------------- */
/* Rarity -> difficulty                                                       */
/*                                                                            */
/* The published rarity table: a check to find an item is Easy at rarity 2-3, */
/* Average at 4-5, Hard at 6-7, Daunting at 8-9 and Formidable at 10, i.e.    */
/* half the rarity rounded down. Above 10 the check is upgraded instead of    */
/* growing, so the pool stays five dice and difficulty dice become challenge  */
/* dice.                                                                      */
/* -------------------------------------------------------------------------- */

test("rarity: the published table, rarity 0 through 10", async () => {
    install();
    const { Shop } = await loadShop();
    const shop = newShop(Shop);
    const expected = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5];
    for (let rarity = 0; rarity <= 10; rarity++) {
        assert.deepEqual(
            shop.rarity_to_difficulty(rarity),
            { difficulty: expected[rarity], challenge: 0 },
            `rarity ${rarity}`
        );
    }
});

test("rarity: 11 is Formidable upgraded once", async () => {
    install();
    const { Shop } = await loadShop();
    const shop = newShop(Shop);
    assert.deepEqual(shop.rarity_to_difficulty(11), { difficulty: 4, challenge: 1 });
});

test("rarity: the check never asks for a negative number of dice", async () => {
    // A location modifier of -2 can push the effective rarity below zero, and
    // very rare items push it past 15; neither may produce a pool you cannot
    // roll.
    install();
    const { Shop } = await loadShop();
    const shop = newShop(Shop);
    for (let rarity = -2; rarity <= 30; rarity++) {
        const { difficulty, challenge } = shop.rarity_to_difficulty(rarity);
        assert.ok(difficulty >= 0, `rarity ${rarity} asked for ${difficulty} difficulty dice`);
        assert.ok(challenge >= 0, `rarity ${rarity} asked for ${challenge} challenge dice`);
    }
});

test("rarity: a rarer item is never easier to find than a commoner one", async () => {
    install();
    const { Shop } = await loadShop();
    const shop = newShop(Shop);
    // A challenge die is strictly harder than a difficulty die, so this scores
    // the check in a way that must not go down as rarity goes up.
    const hardness = (r) => {
        const { difficulty, challenge } = shop.rarity_to_difficulty(r);
        return difficulty + 2 * challenge;
    };
    for (let rarity = 1; rarity <= 30; rarity++) {
        assert.ok(
            hardness(rarity) >= hardness(rarity - 1),
            `rarity ${rarity} (${hardness(rarity)}) is easier than rarity ${rarity - 1} (${hardness(
                rarity - 1
            )})`
        );
    }
});

/* -------------------------------------------------------------------------- */
/* Shop configuration                                                         */
/* -------------------------------------------------------------------------- */

test("setup: the item count bounds are sanitised", async () => {
    install();
    const { Shop } = await loadShop();
    const shop = newShop(Shop, { min_items: "0", max_items: "-5" });
    assert.equal(shop.min_items, 1, "a shop always stocks at least one item");
    assert.equal(shop.max_items, 1, "the upper bound is never below the lower bound");
});

test("setup: a remote location makes items rarer and dearer", async () => {
    install();
    const { Shop } = await loadShop();
    const shop = newShop(Shop, { location: "plus_two" });
    assert.equal(shop.location_modifier, 2, "rarity is modified by the location");
    assert.equal(shop.price_modifier, 2, "prices are modified by the location");
});

test("setup: a core-worlds location makes items commoner without discounting them", async () => {
    install();
    const { Shop } = await loadShop();
    const shop = newShop(Shop, { location: "minus_two" });
    assert.equal(shop.location_modifier, -2);
    assert.equal(shop.price_modifier, 1);
});

test("setup: tag filters are split, trimmed and lower cased", async () => {
    install();
    const { Shop } = await loadShop();
    const shop = newShop(Shop, {
        tags_must_contain: " Imperial , MILITARY ,",
        tags_must_not_contain: "Droid",
    });
    assert.deepEqual(shop.tags_must_contain, ["imperial", "military"]);
    assert.deepEqual(shop.tags_must_not_contain, ["droid"]);
});

/* -------------------------------------------------------------------------- */
/* The availability check's dice pool                                         */
/*                                                                            */
/* An availability check is an ordinary skill check: the pool holds as many    */
/* dice as the greater of characteristic and skill rank, of which the lesser   */
/* of the two are upgraded to proficiency dice. That is what the system does   */
/* in modules/helpers/dice-helpers.js, and what this duplicates.               */
/* -------------------------------------------------------------------------- */

test("pool: three Presence and two Negotiation rolls three dice, two upgraded", async () => {
    install({ actor: makeShopper({ negotiation: { rank: 2 }, characteristics: { Presence: { value: 3 } } }) });
    const { Shop } = await loadShop();
    const pool = await newShop(Shop).build_dice_pool(ACTOR_ID, 2, 0, "negotiation");
    assert.equal(pool.proficiency, 2, "two upgrades");
    assert.equal(pool.ability, 1, "one plain ability die");
});

test("pool: the pool is always the greater of characteristic and rank, upgraded by the lesser", async () => {
    for (let characteristic = 0; characteristic <= 5; characteristic++) {
        for (let rank = 0; rank <= 5; rank++) {
            install({
                actor: makeShopper({
                    negotiation: { rank },
                    characteristics: { Presence: { value: characteristic } },
                }),
            });
            const { Shop } = await loadShop();
            const pool = await newShop(Shop).build_dice_pool(ACTOR_ID, 2, 0, "negotiation");
            assert.equal(
                pool.ability + pool.proficiency,
                Math.max(characteristic, rank),
                `characteristic ${characteristic}, rank ${rank}: total dice`
            );
            assert.equal(
                pool.proficiency,
                Math.min(characteristic, rank),
                `characteristic ${characteristic}, rank ${rank}: upgrades`
            );
        }
    }
});

test("pool: setback dice on the skill are carried into the pool", async () => {
    install({ actor: makeShopper({ negotiation: { rank: 2, setback: 1 } }) });
    const { Shop } = await loadShop();
    const pool = await newShop(Shop).build_dice_pool(ACTOR_ID, 2, 0, "negotiation");
    assert.equal(pool.setback, 1);
});

test("pool: boost, force and the static result modifiers are carried into the pool", async () => {
    install({
        actor: makeShopper({
            negotiation: { rank: 2, boost: 2, force: 1, advantage: 1, success: 1, threat: 1 },
        }),
    });
    const { Shop } = await loadShop();
    const pool = await newShop(Shop).build_dice_pool(ACTOR_ID, 2, 0, "negotiation");
    assert.equal(pool.boost, 2);
    assert.equal(pool.force, 1);
    assert.equal(pool.advantage, 1);
    assert.equal(pool.success, 1);
    assert.equal(pool.threat, 1);
});

test("pool: the difficulty is the requested one, with upgrades turned into challenge dice", async () => {
    install({ actor: makeShopper({ negotiation: { rank: 2 } }) });
    const { Shop } = await loadShop();
    const pool = await newShop(Shop).build_dice_pool(ACTOR_ID, 5, 2, "negotiation");
    assert.equal(
        pool.difficulty + pool.challenge,
        5,
        "upgrading swaps dice out, it does not add any"
    );
    assert.equal(pool.challenge, 2, "two upgrades");
});

test("pool: each shop skill uses its own rank and characteristic", async () => {
    install({
        actor: makeShopper({
            negotiation: { rank: 1 },
            streetwise: { rank: 4, characteristic: "Cunning" },
            characteristics: { Presence: { value: 1 }, Cunning: { value: 4 } },
        }),
    });
    const { Shop } = await loadShop();
    const shop = newShop(Shop);
    const negotiation = await shop.build_dice_pool(ACTOR_ID, 2, 0, "negotiation");
    const streetwise = await shop.build_dice_pool(ACTOR_ID, 2, 0, "streetwise");
    assert.equal(negotiation.ability + negotiation.proficiency, 1, "Presence 1 / Negotiation 1");
    assert.equal(streetwise.ability + streetwise.proficiency, 4, "Cunning 4 / Streetwise 4");
});

/* -------------------------------------------------------------------------- */
/* Which skill looks for which item                                           */
/* -------------------------------------------------------------------------- */

test("check: restricted goods are hunted down with Streetwise, legal goods with Negotiation", async () => {
    const legal = makeItem({ name: "Comlink" });
    const restricted = makeItem({ name: "Thermal Detonator", restricted: true });
    install({ items: [legal, restricted] });
    const { Shop } = await loadShop();
    const shop = newShop(Shop, { shady: true });

    const used = [];
    const real = shop.build_dice_pool.bind(shop);
    shop.build_dice_pool = async (...args) => {
        used.push(args[3]);
        return real(...args);
    };

    await shop.roll_for_item(legal, [{ compendium: "test.general", item: legal }], 0);
    await shop.roll_for_item(restricted, [{ compendium: "test.general", item: restricted }], 0);
    assert.deepEqual(used, ["negotiation", "streetwise"]);
});

test("check: the item's rarity sets the difficulty of the check", async () => {
    // Rarity 6 is a Hard (three difficulty dice) check.
    const item = makeItem({ name: "Mandalorian Armour", rarity: 6 });
    install({ items: [item] });
    const { Shop } = await loadShop();
    const shop = newShop(Shop);
    const result = await shop.roll_for_item(item, [{ compendium: "test.general", item }], 0);
    assert.match(result.item.dice_string, /\b3di\b/);
});

test("check: a remote location makes the check harder", async () => {
    // Rarity 6 at plus_two is effectively rarity 8: a Daunting (four die) check.
    const item = makeItem({ name: "Mandalorian Armour", rarity: 6 });
    install({ items: [item] });
    const { Shop } = await loadShop();
    const shop = newShop(Shop, { location: "plus_two" });
    const result = await shop.roll_for_item(item, [{ compendium: "test.general", item }], 0);
    assert.match(result.item.dice_string, /\b4di\b/);
});

test("check: a failed check keeps the item out of the shop", async () => {
    const item = makeItem({ name: "Comlink" });
    install({ items: [item], roll: { success: 0, failure: 2 } });
    const { Shop } = await loadShop();
    const result = await newShop(Shop).roll_for_item(
        item,
        [{ compendium: "test.general", item }],
        0
    );
    assert.equal(result.accepted, false);
});

/* -------------------------------------------------------------------------- */
/* Pricing                                                                    */
/* -------------------------------------------------------------------------- */

async function priceOf(overrides, itemOptions = {}) {
    const item = makeItem({ name: "Comlink", ...itemOptions });
    install({ items: [item] });
    const { Shop } = await loadShop();
    const result = await newShop(Shop, overrides).roll_for_item(
        item,
        [{ compendium: "test.general", item }],
        0
    );
    return result.item;
}

test("price: an ordinary vendor in an ordinary place charges the catalogue price", async () => {
    const sold = await priceOf({}, { price: 250 });
    assert.equal(sold.price, 250);
    assert.equal(sold.msrp, 250, "the catalogue price is recorded alongside");
});

test("price: the vendor percentage scales the price", async () => {
    assert.equal((await priceOf({ base_price: 50 }, { price: 250 })).price, 125);
    assert.equal((await priceOf({ base_price: 200 }, { price: 250 })).price, 500);
});

test("price: a remote location multiplies the price on top of the vendor percentage", async () => {
    // plus_two doubles, and the vendor sells at half: 250 * 2 * 0.5
    assert.equal((await priceOf({ location: "plus_two", base_price: 50 }, { price: 250 })).price, 250);
});

test("price: an item with no artwork gets the module's stand-in icon for its type", async () => {
    const sold = await priceOf({}, { type: "gear", img: "icons/svg/mystery-man.svg" });
    assert.equal(sold.item.image, "modules/ffg-star-wars-enhancements/icons/gym-bag.svg");
});

test("price: an item with its own artwork keeps it", async () => {
    const sold = await priceOf({}, { type: "gear", img: "icons/gear/comlink.webp" });
    assert.equal(sold.item.image, "icons/gear/comlink.webp");
});

/* -------------------------------------------------------------------------- */
/* Stocking the shop                                                          */
/* -------------------------------------------------------------------------- */

/** Pick the first remaining candidate each time so the run is deterministic. */
const stock = (shop) => withRandom(0, () => shop.shop());

test("stock: a legitimate shop refuses restricted goods", async () => {
    const restricted = makeItem({ name: "Thermal Detonator", restricted: true });
    const legal = makeItem({ name: "Comlink" });
    install({ items: [restricted, legal] });
    const { Shop } = await loadShop();
    const inventory = await stock(newShop(Shop, { shady: false }));
    assert.deepEqual(
        inventory.map((i) => i.item.name),
        ["Comlink"]
    );
});

test("stock: a shady shop is happy to carry restricted goods", async () => {
    const restricted = makeItem({ name: "Thermal Detonator", restricted: true });
    install({ items: [restricted] });
    const { Shop } = await loadShop();
    const inventory = await stock(newShop(Shop, { shady: true }));
    assert.deepEqual(
        inventory.map((i) => i.item.name),
        ["Thermal Detonator"]
    );
});

test("stock: items outside the price range are not stocked", async () => {
    const cheap = makeItem({ name: "Ration Pack", price: 5 });
    const dear = makeItem({ name: "Starfighter", price: 50000 });
    const right = makeItem({ name: "Blaster Pistol", price: 400 });
    install({ items: [cheap, dear, right] });
    const { Shop } = await loadShop();
    const inventory = await stock(newShop(Shop, { min_price: 100, max_price: 1000 }));
    assert.deepEqual(
        inventory.map((i) => i.item.name),
        ["Blaster Pistol"]
    );
});

test("stock: a required tag keeps everything else out", async () => {
    const wrong = makeItem({ name: "Comlink", tags: ["civilian"] });
    const right = makeItem({ name: "Imperial Rifle", tags: ["Imperial", "weapon"] });
    install({ items: [wrong, right] });
    const { Shop } = await loadShop();
    const inventory = await stock(newShop(Shop, { tags_must_contain: "imperial" }));
    assert.deepEqual(
        inventory.map((i) => i.item.name),
        ["Imperial Rifle"]
    );
});

test("stock: an excluded tag keeps that item out", async () => {
    const banned = makeItem({ name: "Assassin Droid", tags: ["droid"] });
    const fine = makeItem({ name: "Comlink", tags: ["civilian"] });
    install({ items: [banned, fine] });
    const { Shop } = await loadShop();
    const inventory = await stock(newShop(Shop, { tags_must_not_contain: "Droid" }));
    assert.deepEqual(
        inventory.map((i) => i.item.name),
        ["Comlink"]
    );
});

test("stock: an item type the shop does not deal in is skipped", async () => {
    const talent = makeItem({ name: "Grit", type: "talent" });
    const gear = makeItem({ name: "Comlink", type: "gear" });
    install({ items: [talent, gear] });
    const { Shop } = await loadShop();
    const inventory = await stock(newShop(Shop, { specialization: "general" }));
    assert.deepEqual(
        inventory.map((i) => i.item.name),
        ["Comlink"]
    );
});

test("stock: no item is stocked twice", async () => {
    const items = Array.from({ length: 5 }, (_, i) => makeItem({ name: `Gadget ${i}` }));
    install({ items });
    const { Shop } = await loadShop();
    const inventory = await stock(newShop(Shop, { min_items: 4, max_items: 4 }));
    const names = inventory.map((i) => i.item.name);
    assert.equal(new Set(names).size, names.length);
});

test("stock: running out of candidates stops the shop rather than breaking it", async () => {
    // Asking for five items from a compendium holding two has to end with two
    // items, not with a crash or a spin.
    install({ items: [makeItem({ name: "Comlink" }), makeItem({ name: "Glow Rod" })] });
    const { Shop } = await loadShop();
    const inventory = await stock(newShop(Shop, { min_items: 5, max_items: 5 }));
    assert.equal(inventory.length, 2);
});

test("stock: the shop can hold as many items as the configured maximum", async () => {
    // min 1 / max 5 must be able to produce five items; an upper bound that can
    // never be reached is not an upper bound.
    const items = Array.from({ length: 20 }, (_, i) => makeItem({ name: `Gadget ${i}` }));
    install({ items });
    const { Shop } = await loadShop();
    const shop = newShop(Shop, { min_items: 1, max_items: 5 });
    const inventory = await withRandom(0.9999999, () => shop.shop());
    assert.equal(inventory.length, 5);
});

test("stock: the shop never holds fewer than the configured minimum when stock allows", async () => {
    const items = Array.from({ length: 20 }, (_, i) => makeItem({ name: `Gadget ${i}` }));
    install({ items });
    const { Shop } = await loadShop();
    const inventory = await stock(newShop(Shop, { min_items: 3, max_items: 7 }));
    assert.ok(inventory.length >= 3, `expected at least 3 items, got ${inventory.length}`);
});

/* -------------------------------------------------------------------------- */
/* Choosing the customer                                                      */
/* -------------------------------------------------------------------------- */

test("customers: only player-owned, non-vehicle actors can make the availability check", async () => {
    install();
    const player = makeShopper();
    const gmActor = { ...makeShopper(), id: "gm-npc", name: "Moff", hasPlayerOwner: false };
    const ship = { ...makeShopper(), id: "ship", name: "Ghost", type: "vehicle" };
    const actors = [player, gmActor, ship];
    game.actors = Object.assign(actors, { get: (id) => actors.find((a) => a.id === id) });

    const { get_player_actors } = await loadShop();
    assert.deepEqual((await get_player_actors()).map((a) => a.name), ["Shopper"]);
});
