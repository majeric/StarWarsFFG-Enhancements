import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryGlobals, CONST } from "./harness/foundry.mjs";
import { importWithPrivates } from "./harness/load-module.mjs";

const FRIENDLY_IMG = "friendly.png";
const ENEMY_IMG = "enemy.png";
const NEUTRAL_IMG = "neutral.png";

function install(extraSettings = {}) {
    return installFoundryGlobals({
        settings: {
            "ffg-star-wars-enhancements.auto-rename-actors": true,
            "ffg-star-wars-enhancements.auto-rename-actors_friendly": FRIENDLY_IMG,
            "ffg-star-wars-enhancements.auto-rename-actors_enemy": ENEMY_IMG,
            "ffg-star-wars-enhancements.auto-rename-actors_neutral": NEUTRAL_IMG,
            ...extraSettings,
        },
    });
}

/**
 * A combatant stand-in that records what rename_combatant asked it to change.
 */
function makeCombatant({ disposition, actorDisposition, isNPC = true, hasToken = true, actor } = {}) {
    const updates = [];
    return {
        token: hasToken ? { disposition } : undefined,
        actor:
            actor === undefined
                ? actorDisposition === undefined
                    ? undefined
                    : { token: { disposition: actorDisposition } }
                : actor,
        isNPC,
        updates,
        updateSource(data) {
            updates.push(data);
        },
    };
}

async function load() {
    return importWithPrivates("scripts/rename.js", []);
}

/* -------------------------------------------------------------------------- */
/* Disposition decides the icon                                               */
/*                                                                            */
/* A combatant joining the encounter is re-skinned with the icon the GM        */
/* configured for its side, so the tracker does not leak NPC names.           */
/* -------------------------------------------------------------------------- */

test("friendly tokens take the configured friendly icon", async () => {
    install();
    const { rename_combatant } = await load();
    const combatant = makeCombatant({ disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY });
    rename_combatant(combatant);
    assert.equal(combatant.updates.at(-1).img, FRIENDLY_IMG);
});

test("hostile tokens take the configured enemy icon", async () => {
    install();
    const { rename_combatant } = await load();
    const combatant = makeCombatant({ disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE });
    rename_combatant(combatant);
    assert.equal(combatant.updates.at(-1).img, ENEMY_IMG);
});

test("neutral tokens take the configured neutral icon", async () => {
    install();
    const { rename_combatant } = await load();
    const combatant = makeCombatant({ disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL });
    rename_combatant(combatant);
    assert.equal(combatant.updates.at(-1).img, NEUTRAL_IMG);
});

test("secret tokens are treated as neutral rather than as allies", async () => {
    // SECRET (-2) is not FRIENDLY and not HOSTILE, so it must land on neutral.
    install();
    const { rename_combatant } = await load();
    const combatant = makeCombatant({ disposition: CONST.TOKEN_DISPOSITIONS.SECRET });
    rename_combatant(combatant);
    assert.equal(combatant.updates.at(-1).img, NEUTRAL_IMG);
});

/* -------------------------------------------------------------------------- */
/* Falling back when the token has no disposition                             */
/*                                                                            */
/* The function's own comment states the rule: "Fetch the disposition for the  */
/* combatant based on token and fall back on actor, fall back to neutral if    */
/* both are undefined."                                                       */
/* -------------------------------------------------------------------------- */

test("a combatant with no token falls back to the actor's prototype token", async () => {
    install();
    const { rename_combatant } = await load();
    const combatant = makeCombatant({
        hasToken: false,
        actorDisposition: CONST.TOKEN_DISPOSITIONS.HOSTILE,
    });
    rename_combatant(combatant);
    assert.equal(combatant.updates.at(-1).img, ENEMY_IMG);
});

test("a combatant whose actor has no token falls back to neutral", async () => {
    // Rule from the comment above the lookup: when neither the token nor the
    // actor supplies a disposition, treat the combatant as neutral.
    install();
    const { rename_combatant } = await load();
    const combatant = makeCombatant({ hasToken: false, actor: { name: "Nameless", token: null } });
    rename_combatant(combatant);
    assert.equal(combatant.updates.at(-1).img, NEUTRAL_IMG);
});

test("a token with disposition 0 is neutral, not treated as missing", async () => {
    // 0 is a real disposition; it must not fall through to the actor.
    install();
    const { rename_combatant } = await load();
    const combatant = makeCombatant({
        disposition: 0,
        actorDisposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
    });
    rename_combatant(combatant);
    assert.equal(combatant.updates.at(-1).img, NEUTRAL_IMG);
});

/* -------------------------------------------------------------------------- */
/* Naming and the feature switch                                              */
/* -------------------------------------------------------------------------- */

test("NPCs are renamed to NPC and player characters to PC", async () => {
    install();
    const { rename_combatant } = await load();

    const npc = makeCombatant({ disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE, isNPC: true });
    rename_combatant(npc);
    assert.equal(npc.updates.at(-1).name, "NPC");

    const pc = makeCombatant({ disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY, isNPC: false });
    rename_combatant(pc);
    assert.equal(pc.updates.at(-1).name, "PC");
});

test("nothing is renamed while the feature is switched off", async () => {
    install({ "ffg-star-wars-enhancements.auto-rename-actors": false });
    const { rename_combatant } = await load();
    const combatant = makeCombatant({ disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE });
    rename_combatant(combatant);
    assert.equal(combatant.updates.length, 0);
});

test("a combatant with neither token nor actor is left alone", async () => {
    install();
    const { rename_combatant } = await load();
    const combatant = makeCombatant({ hasToken: false });
    rename_combatant(combatant);
    assert.equal(combatant.updates.length, 0);
});
