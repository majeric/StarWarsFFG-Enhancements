import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryGlobals } from "./harness/foundry.mjs";
import { importWithPrivates, readRepoFile } from "./harness/load-module.mjs";

/** The real suggestion data shipped with the module, used as the fixture. */
const DICE_HELPER_JSON = readRepoFile("content/dice_helper.json");

/** Just enough of the system's skill names for load_data's localisation pass. */
const I18N = {
    "SWFFG.Rolling": "Rolling",
    "SWFFG.SkillsNameMelee": "Melee",
    "SWFFG.SkillsNameBrawl": "Brawl",
    "SWFFG.SkillsNameLightsaber": "Lightsaber",
    "SWFFG.SkillsNameRangedLight": "Ranged: Light",
    "SWFFG.SkillsNameRangedHeavy": "Ranged: Heavy",
    "SWFFG.SkillsNameGunnery": "Gunnery",
    "ffg-star-wars-enhancements.dice-helper-button-text": "Help spending results!",
    "ffg-star-wars-enhancements.dice-helper-message-content-3": "for spending results for",
};

const PRIVATES = ["is_roll", "determine_data", "fetch_suggestions", "is_supported_skill", "load_data"];

function journalWith(content, { journalName = "dice_helper", pageName = "dice_helper" } = {}) {
    return [{ name: journalName, pages: [{ name: pageName, text: { content } }] }];
}

function install({ journal = journalWith(DICE_HELPER_JSON), isGM = true, settings = {} } = {}) {
    return installFoundryGlobals({ isGM, i18n: I18N, settings, game: { journal } });
}

async function load() {
    return importWithPrivates("scripts/dice_helper.js", PRIVATES);
}

/** The shape the createChatMessage hook receives for an FFG skill roll. */
function rollMessage({ flavor = "Rolling Melee...", ffg = {}, content = "" } = {}) {
    return {
        flavor,
        content,
        rolls: [
            {
                ffg: {
                    success: 0,
                    failure: 0,
                    advantage: 0,
                    threat: 0,
                    triumph: 0,
                    despair: 0,
                    ...ffg,
                },
            },
        ],
    };
}

/* -------------------------------------------------------------------------- */
/* is_roll: which chat messages the helper reacts to                          */
/* -------------------------------------------------------------------------- */

test("is_roll: a skill roll with flavour text is a roll", async () => {
    install();
    const { is_roll } = await load();
    assert.equal(is_roll(rollMessage()), true);
});

test("is_roll: a message with no dice is not a roll", async () => {
    install();
    const { is_roll } = await load();
    assert.equal(is_roll({ flavor: "hello", rolls: [], content: "hello" }), false);
});

test("is_roll: a roll with no flavour text is not a roll", async () => {
    // Without flavour there is no skill name, so there is nothing to look up.
    install();
    const { is_roll } = await load();
    const message = rollMessage();
    delete message.flavor;
    assert.equal(is_roll(message), false);
});

test("is_roll: players never trigger the helper; only the GM does", async () => {
    install({ isGM: false });
    const { is_roll } = await load();
    assert.equal(is_roll(rollMessage()), false);
});

test("is_roll: an Initiative roll is excluded", async () => {
    // The guard written inside is_roll states the rule: an Initiative roll is
    // not a skill check whose advantage and threat get spent from a menu, so it
    // must not be offered a helper button. (The system's initiative messages
    // look like this: see combat-ffg.js, flavor "<token> Rolling Initiative
    // (Vigilance)" plus the core.initiativeRoll flag.)
    install();
    const { is_roll } = await load();
    const message = rollMessage({
        flavor: "Stormtrooper Rolling Initiative (Vigilance)",
        ffg: { success: 2, advantage: 1 },
    });
    message.flags = { core: { initiativeRoll: true } };
    assert.equal(is_roll(message), false);
});

test("is_roll: the helper's own button message does not earn a second button", async () => {
    // The helper posts a plain message with no dice attached, so it must never
    // feed itself.
    install();
    const { is_roll } = await load();
    const content = '<button class="effg-die-result" data-sk="Melee">Help spending results!</button>';
    assert.equal(is_roll({ flavor: undefined, content, rolls: [] }), false);
});

/* -------------------------------------------------------------------------- */
/* load_data: reading the suggestion journal                                  */
/* -------------------------------------------------------------------------- */

test("load_data: reads the shipped suggestion data and localises the skill keys", async () => {
    install();
    const { load_data } = await load();
    const data = load_data();
    assert.deepEqual(
        Object.keys(data).sort(),
        ["brawl", "gunnery", "lightsaber", "melee", "ranged: heavy", "ranged: light"]
    );
    for (const skill of Object.keys(data)) {
        for (const category of ["su", "fa", "ad", "th", "tr", "de"]) {
            assert.ok(Array.isArray(data[skill][category]), `${skill}.${category} is a list`);
        }
    }
});

test("load_data: every suggestion carries text and a required count", async () => {
    install();
    const { load_data } = await load();
    const data = load_data();
    for (const [skill, categories] of Object.entries(data)) {
        for (const [category, suggestions] of Object.entries(categories)) {
            for (const suggestion of suggestions) {
                assert.equal(typeof suggestion.text, "string", `${skill}.${category} text`);
                assert.equal(typeof suggestion.required, "number", `${skill}.${category} required`);
                assert.ok(suggestion.required >= 1, `${skill}.${category} required >= 1`);
            }
        }
    }
});

test("load_data: a missing journal warns and yields no suggestions", async () => {
    const ctx = install({ journal: [] });
    const { load_data } = await load();
    assert.deepEqual(load_data(), {});
    assert.equal(ctx.notifications.filter((n) => n.type === "warn").length, 1);
});

test("load_data: a journal without a dice_helper page warns and yields no suggestions", async () => {
    const ctx = install({ journal: journalWith(DICE_HELPER_JSON, { pageName: "something else" }) });
    const { load_data } = await load();
    assert.deepEqual(load_data(), {});
    assert.equal(ctx.notifications.filter((n) => n.type === "warn").length, 1);
});

test("load_data: unparseable journal content warns and yields no suggestions", async () => {
    const ctx = install({ journal: journalWith("not json at all") });
    const { load_data } = await load();
    assert.deepEqual(load_data(), {});
    assert.equal(ctx.notifications.filter((n) => n.type === "warn").length, 1);
});

test("load_data: data edited through the journal editor is still readable", async () => {
    // Foundry's text editor wraps the page in <p> and escapes the quotes, which
    // is exactly what a GM gets after opening and saving the generated journal.
    // The helper has to cope with that, otherwise editing a suggestion silently
    // disables the feature.
    const edited =
        "<p>" +
        JSON.stringify({ "SWFFG.SkillsNameMelee": { su: [{ text: "hit it", required: 1 }] } })
            .replace(/"/g, "&quot;") +
        "</p>";
    install({ journal: journalWith(edited) });
    const { load_data } = await load();
    assert.deepEqual(load_data(), { melee: { su: [{ text: "hit it", required: 1 }] } });
});

/* -------------------------------------------------------------------------- */
/* is_supported_skill                                                         */
/* -------------------------------------------------------------------------- */

test("is_supported_skill: a skill present in the data is supported", async () => {
    install();
    const { is_supported_skill, load_data } = await load();
    assert.equal(is_supported_skill("melee", load_data()), true);
});

test("is_supported_skill: an unknown skill is not supported", async () => {
    install();
    const { is_supported_skill, load_data } = await load();
    assert.equal(is_supported_skill("astrogation", load_data()), false);
});

test("is_supported_skill: the lookup ignores case", async () => {
    // The chat flavour is title cased ("Ranged: Light") while the journal keys
    // are lower cased, so the lookup has to be case insensitive.
    install();
    const { is_supported_skill, load_data } = await load();
    assert.equal(is_supported_skill("Ranged: Light", load_data()), true);
});

/* -------------------------------------------------------------------------- */
/* determine_data: reading the results back off the button                    */
/* -------------------------------------------------------------------------- */

test("determine_data: reads every result off the button's data attributes", async () => {
    install();
    const { determine_data } = await load();
    const button =
        '<button class="effg-die-result" data-ad="2" data-tr="1" data-th="0" ' +
        'data-de="0" data-su="3" data-fa="0" data-sk="Melee">Help spending results!</button>';
    assert.deepEqual(determine_data(button), {
        ad: 2,
        tr: 1,
        th: 0,
        de: 0,
        su: 3,
        fa: 0,
        skill: "Melee",
    });
});

/* -------------------------------------------------------------------------- */
/* The round trip: roll -> button -> suggestions                              */
/* -------------------------------------------------------------------------- */

async function runCreateChatMessage(ctx, mod, message) {
    mod.dice_helper();
    const [handler] = ctx.hooksFor("createChatMessage");
    await handler(message, {}, "msg1");
    return ctx.chatMessages;
}

test("round trip: an advantageous Melee roll produces a button the helper can read back", async () => {
    const ctx = install();
    const mod = await load();
    const created = await runCreateChatMessage(
        ctx,
        mod,
        rollMessage({ flavor: "Rolling Melee...", ffg: { success: 3, advantage: 2 } })
    );
    assert.equal(created.length, 1, "one helper message is posted");

    const parsed = mod.determine_data(created[0].content);
    assert.equal(parsed.skill, "Melee");
    assert.equal(parsed.ad, 2);
    assert.equal(parsed.su, 3);
});

test("round trip: a roll with nothing to spend posts no helper button", async () => {
    // Successes and failures alone offer no choices; only advantage, threat,
    // triumph and despair need spending.
    const ctx = install();
    const mod = await load();
    const created = await runCreateChatMessage(
        ctx,
        mod,
        rollMessage({ flavor: "Rolling Melee...", ffg: { success: 3 } })
    );
    assert.equal(created.length, 0);
});

test("round trip: a skill with no suggestions posts no helper button", async () => {
    const ctx = install();
    const mod = await load();
    const created = await runCreateChatMessage(
        ctx,
        mod,
        rollMessage({ flavor: "Rolling Astrogation...", ffg: { advantage: 2 } })
    );
    assert.equal(created.length, 0);
});

/* -------------------------------------------------------------------------- */
/* fetch_suggestions: which advice is offered                                 */
/* -------------------------------------------------------------------------- */

const SUGGESTION_FIXTURE = JSON.stringify({
    "SWFFG.SkillsNameMelee": {
        su: [{ text: "one success", required: 1 }],
        fa: [{ text: "one failure", required: 1 }],
        ad: [
            { text: "one advantage", required: 1 },
            { text: "two advantage", required: 2 },
            { text: "three advantage", required: 3 },
        ],
        th: [
            { text: "one threat", required: 1 },
            { text: "three threat", required: 3 },
        ],
        tr: [{ text: "one triumph", required: 1 }],
        de: [{ text: "one despair", required: 1 }],
    },
});

function fixtureInstall() {
    return install({ journal: journalWith(SUGGESTION_FIXTURE) });
}

const noResults = { ad: 0, tr: 0, th: 0, de: 0, su: 0, fa: 0, skill: "Melee" };

function byCategory(suggestions) {
    return Object.fromEntries(
        suggestions.map((group) => [group.category, group.suggestions.map((s) => s.text)])
    );
}

test("suggestions: only options the result can actually pay for are offered", async () => {
    fixtureInstall();
    const { fetch_suggestions } = await load();
    const result = byCategory(await fetch_suggestions({ ...noResults, ad: 2 }));
    assert.deepEqual(result.ad, ["one advantage", "two advantage"]);
});

test("suggestions: a category with nothing affordable is left out entirely", async () => {
    fixtureInstall();
    const { fetch_suggestions } = await load();
    const result = byCategory(await fetch_suggestions({ ...noResults, ad: 1 }));
    assert.deepEqual(Object.keys(result), ["ad"]);
});

test("suggestions: an unsupported skill offers nothing", async () => {
    fixtureInstall();
    const { fetch_suggestions } = await load();
    assert.deepEqual(await fetch_suggestions({ ...noResults, ad: 3, skill: "Astrogation" }), []);
});

test("suggestions: categories are offered in the order success, failure, advantage, threat, triumph, despair", async () => {
    fixtureInstall();
    const { fetch_suggestions } = await load();
    const suggestions = await fetch_suggestions({
        ...noResults,
        su: 1,
        fa: 1,
        ad: 1,
        th: 1,
        tr: 1,
        de: 1,
    });
    assert.deepEqual(
        suggestions.map((group) => group.category),
        ["su", "fa", "ad", "th", "tr", "de"]
    );
});

test("suggestions: a Triumph may also be spent as an Advantage", async () => {
    // Core rule: a Triumph can buy anything an Advantage can buy. One Triumph
    // and no Advantage therefore pays for a one-advantage option.
    fixtureInstall();
    const { fetch_suggestions } = await load();
    const result = byCategory(await fetch_suggestions({ ...noResults, tr: 1 }));
    assert.ok(result.ad?.includes("one advantage"), "the one-advantage option is offered");
});

test("suggestions: a Triumph buys one Advantage, not an unlimited number", { todo: "Pending a call: RAW a Triumph buys one Advantage, so affordability should count ad+tr. dice_helper.js:333 instead shows every option when any Triumph is present, which may be a deliberate show-the-GM-everything choice." }, async () => {
    // One Triumph plus one Advantage is worth two Advantage, so the option that
    // costs three Advantage is still out of reach.
    fixtureInstall();
    const { fetch_suggestions } = await load();
    const result = byCategory(await fetch_suggestions({ ...noResults, tr: 1, ad: 1 }));
    assert.deepEqual(result.ad, ["one advantage", "two advantage"]);
});

test("suggestions: a Despair may also be spent as a Threat, one for one", { todo: "Pending a call: RAW a Triumph buys one Advantage, so affordability should count ad+tr. dice_helper.js:333 instead shows every option when any Triumph is present, which may be a deliberate show-the-GM-everything choice." }, async () => {
    // The mirror of the Triumph rule: a Despair buys anything a Threat can buy.
    fixtureInstall();
    const { fetch_suggestions } = await load();
    const result = byCategory(await fetch_suggestions({ ...noResults, de: 1 }));
    assert.deepEqual(result.th, ["one threat"]);
});
