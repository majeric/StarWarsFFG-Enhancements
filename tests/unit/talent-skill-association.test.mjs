import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryGlobals, makeChatHtml } from "./harness/foundry.mjs";
import { importWithPrivates } from "./harness/load-module.mjs";

const MODULE_ID = "ffg-star-wars-enhancements";
const I18N = { "SWFFG.Rolling": "Rolling" };

const PRIVATES = ["get_associated_skills", "flag_matches_skill", "build_associated_skill_map"];

async function load() {
    return importWithPrivates("scripts/talentsAutomation/talent_skill_association.js", PRIVATES);
}

/* -------------------------------------------------------------------------- */
/* fixtures                                                                   */
/* -------------------------------------------------------------------------- */

function makeTalentItem(name, associatedSkill, { ranked = false, ranks = 1, description = "" } = {}) {
    const flags = associatedSkill === undefined ? {} : { [MODULE_ID]: { associatedSkill } };
    return {
        id: name.toLowerCase().replace(/\s+/g, "-"),
        name,
        type: "talent",
        flags,
        system: { description, ranks: { ranked, current: ranks } },
        getFlag(scope, key) {
            return this.flags?.[scope]?.[key];
        },
    };
}

function makeSpecialization(name, talents) {
    return {
        id: name.toLowerCase().replace(/\s+/g, "-"),
        name,
        type: "specialization",
        system: { talents },
        getFlag() {
            return undefined;
        },
    };
}

/** The shape the system's Actor#talentList entries have. */
function talentListEntry(name, { isRanked = false, rank = "N/A", description = "" } = {}) {
    return { name, isRanked, rank, description };
}

function makeActor({
    id = "actor1",
    items = [],
    talentList = [],
    hasPlayerOwner = true,
    skills = null,
} = {}) {
    return {
        id,
        name: "Test Actor",
        hasPlayerOwner,
        talentList,
        items,
        system: skills ? { skills } : {},
    };
}

function install({ actors = [], isGM = true, settings = {}, config = {} } = {}) {
    const ctx = installFoundryGlobals({ isGM, i18n: I18N, settings });
    const list = [...actors];
    game.actors = Object.assign(list, {
        get: (id) => list.find((a) => a.id === id),
        contents: list,
        tokens: {},
    });
    game.ffg.config = config;
    return ctx;
}

/* -------------------------------------------------------------------------- */
/* The skill list offered on a talent sheet                                   */
/* -------------------------------------------------------------------------- */

test("skill list: the options come from a real actor's skills, alphabetically", async () => {
    install({
        actors: [
            makeActor({ id: "ship", skills: null }),
            makeActor({
                id: "pc",
                skills: { Vigilance: {}, Brawl: {}, "Ranged: Light": {} },
            }),
        ],
    });
    const { get_skill_options } = await load();
    assert.deepEqual(
        get_skill_options().map((o) => o.value),
        ["Brawl", "Ranged: Light", "Vigilance"]
    );
});

test("skill list: with no actors, the system's default list for the chosen theme is used", async () => {
    install({
        settings: { "starwarsffg.skilltheme": "genesys" },
        config: {
            defined_skill_list: [
                { id: "starwars", skills: { Astrogation: {} } },
                { id: "genesys", skills: { Mechanics: {}, Alchemy: {} } },
            ],
        },
    });
    const { get_skill_options } = await load();
    assert.deepEqual(
        get_skill_options().map((o) => o.value),
        ["Alchemy", "Mechanics"]
    );
});

test("skill list: with nothing to read, no options are offered", async () => {
    install();
    const { get_skill_options } = await load();
    assert.deepEqual(get_skill_options(), []);
});

test("skill groups: skills are bucketed by type and sorted within each bucket", async () => {
    install({
        actors: [
            makeActor({
                skills: {
                    Vigilance: { type: "General" },
                    Brawl: { type: "Combat" },
                    Athletics: { type: "General" },
                    Lightsaber: { type: "Combat" },
                },
            }),
        ],
    });
    const { get_skill_groups } = await load();
    assert.deepEqual(get_skill_groups(), {
        Combat: ["Brawl", "Lightsaber"],
        General: ["Athletics", "Vigilance"],
    });
});

test("skill groups: a skill with no declared type lands in Other", async () => {
    install({ actors: [makeActor({ skills: { Improvised: {} } })] });
    const { get_skill_groups } = await load();
    assert.deepEqual(get_skill_groups(), { Other: ["Improvised"] });
});

/* -------------------------------------------------------------------------- */
/* Reading the association off an item                                        */
/* -------------------------------------------------------------------------- */

test("association: a talent with no association reads as a single empty row", async () => {
    install();
    const { get_associated_skills } = await load();
    assert.deepEqual(get_associated_skills(makeTalentItem("Grit", undefined)), [""]);
});

test("association: an association saved in the old single-string format still reads", async () => {
    install();
    const { get_associated_skills } = await load();
    assert.deepEqual(get_associated_skills(makeTalentItem("Lethal Blows", "Brawl")), ["Brawl"]);
});

test("association: an empty saved list reads as a single empty row", async () => {
    install();
    const { get_associated_skills } = await load();
    assert.deepEqual(get_associated_skills(makeTalentItem("Grit", [])), [""]);
});

test("association: matching a skill ignores case", async () => {
    install();
    const { flag_matches_skill } = await load();
    assert.equal(flag_matches_skill(["ranged: light"], "Ranged: Light"), true);
    assert.equal(flag_matches_skill("Brawl", "brawl"), true);
    assert.equal(flag_matches_skill(["Brawl"], "Melee"), false);
    assert.equal(flag_matches_skill(undefined, "Melee"), false);
});

/* -------------------------------------------------------------------------- */
/* Finding the talents that apply to a check                                  */
/* -------------------------------------------------------------------------- */

test("lookup: a talent associated with the rolled skill is found", async () => {
    install();
    const { find_associated_talents } = await load();
    const actor = makeActor({
        items: [makeTalentItem("Lethal Blows", ["Brawl"], { description: "add damage" })],
        talentList: [talentListEntry("Lethal Blows", { description: "add damage" })],
    });
    assert.deepEqual(find_associated_talents(actor, "Brawl"), [
        { name: "Lethal Blows", rank: null, description: "add damage" },
    ]);
});

test("lookup: a talent associated with another skill is not offered", async () => {
    install();
    const { find_associated_talents } = await load();
    const actor = makeActor({
        items: [makeTalentItem("Lethal Blows", ["Brawl"])],
        talentList: [talentListEntry("Lethal Blows")],
    });
    assert.deepEqual(find_associated_talents(actor, "Charm"), []);
});

test("lookup: a talent associated with several skills matches any of them", async () => {
    install();
    const { find_associated_talents } = await load();
    const actor = makeActor({
        items: [makeTalentItem("Quick Strike", ["Brawl", "Ranged: Light"])],
        talentList: [talentListEntry("Quick Strike")],
    });
    assert.equal(find_associated_talents(actor, "Ranged: Light").length, 1);
    assert.equal(find_associated_talents(actor, "Brawl").length, 1);
});

test("lookup: the accumulated rank of a ranked talent is reported", async () => {
    install();
    const { find_associated_talents } = await load();
    const actor = makeActor({
        items: [makeTalentItem("Lethal Blows", ["Brawl"], { ranked: true, ranks: 2 })],
        talentList: [talentListEntry("Lethal Blows", { isRanked: true, rank: 3 })],
    });
    assert.equal(find_associated_talents(actor, "Brawl")[0].rank, 3);
});

test("lookup: an unranked talent reports no rank", async () => {
    install();
    const { find_associated_talents } = await load();
    const actor = makeActor({
        items: [makeTalentItem("Grit", ["Brawl"])],
        talentList: [talentListEntry("Grit", { isRanked: false, rank: "N/A" })],
    });
    assert.equal(find_associated_talents(actor, "Brawl")[0].rank, null);
});

test("lookup: a talent inside a specialisation tree counts once it is learned", async () => {
    install();
    const { find_associated_talents } = await load();
    const spec = makeSpecialization("Marauder", {
        talent1: {
            name: "Frenzied Attack",
            islearned: true,
            flags: { [MODULE_ID]: { associatedSkill: ["Melee"] } },
        },
    });
    const actor = makeActor({ items: [spec], talentList: [talentListEntry("Frenzied Attack")] });
    assert.deepEqual(
        find_associated_talents(actor, "Melee").map((t) => t.name),
        ["Frenzied Attack"]
    );
});

test("lookup: an unlearned specialisation talent is ignored", async () => {
    install();
    const { find_associated_talents } = await load();
    const spec = makeSpecialization("Marauder", {
        talent1: {
            name: "Frenzied Attack",
            islearned: false,
            flags: { [MODULE_ID]: { associatedSkill: ["Melee"] } },
        },
    });
    const actor = makeActor({ items: [spec], talentList: [talentListEntry("Frenzied Attack")] });
    assert.deepEqual(find_associated_talents(actor, "Melee"), []);
});

test("lookup: nothing is returned without an actor or without a skill", async () => {
    install();
    const { find_associated_talents } = await load();
    assert.deepEqual(find_associated_talents(null, "Brawl"), []);
    assert.deepEqual(find_associated_talents(makeActor(), ""), []);
});

/* -------------------------------------------------------------------------- */
/* Rendering the pills                                                        */
/* -------------------------------------------------------------------------- */

test("pills: no talents means no markup at all", async () => {
    install();
    const { build_talent_pills_html } = await load();
    assert.equal(build_talent_pills_html([]), "");
    assert.equal(build_talent_pills_html(undefined), "");
});

test("pills: the talent name and its rank are shown", async () => {
    install();
    const { build_talent_pills_html } = await load();
    const html = build_talent_pills_html([{ name: "Lethal Blows", rank: 2, description: "x" }]);
    assert.match(html, /Lethal Blows/);
    assert.match(html, /2/);
});

test("pills: a description is escaped so it cannot break out of the attribute", async () => {
    install();
    const { build_talent_pills_html } = await load();
    const html = build_talent_pills_html([
        { name: "Dodge", rank: null, description: '<b>"Dodge" & weave</b>' },
    ]);
    const attribute = html.match(/data-desc="([^"]*)"/)[1];
    assert.equal(attribute, "&lt;b&gt;&quot;Dodge&quot; &amp; weave&lt;/b&gt;");
});

test("pills: a talent with no description still renders", async () => {
    // Actor#talentList copies system.description straight through, so a talent
    // saved without one arrives here as undefined. Rendering must not throw:
    // this runs while the chat message is being drawn.
    install();
    const { build_talent_pills_html } = await load();
    const html = build_talent_pills_html([{ name: "Grit", rank: null, description: undefined }]);
    assert.match(html, /Grit/);
});

/* -------------------------------------------------------------------------- */
/* Reading the skill off a roll message                                       */
/* -------------------------------------------------------------------------- */

function rollMessage(flavor, { actorId = "actor1", tokenId = null } = {}) {
    return { rolls: [{}], flavor, speaker: { actor: actorId, token: tokenId } };
}

async function renderChatMessage(ctx, mod, message, html = makeChatHtml()) {
    if (ctx.hooksFor("renderChatMessage").length === 0) mod.talent_skill_association_hooks();
    const handlers = ctx.hooksFor("renderChatMessage");
    for (const handler of handlers) await handler(message, html, {});
    return html.appended.join("");
}

test("flavour: the skill name is taken from the roll's flavour text", async () => {
    const actor = makeActor({
        items: [makeTalentItem("Quick Strike", ["Ranged: Light"])],
        talentList: [talentListEntry("Quick Strike")],
    });
    const ctx = install({ actors: [actor] });
    const mod = await load();
    const html = await renderChatMessage(ctx, mod, rollMessage("Rolling Ranged: Light..."));
    assert.match(html, /Quick Strike/);
});

test("flavour: a message that is not a skill roll gets no pills", async () => {
    const actor = makeActor({
        items: [makeTalentItem("Quick Strike", ["Ranged: Light"])],
        talentList: [talentListEntry("Quick Strike")],
    });
    const ctx = install({ actors: [actor] });
    const mod = await load();
    const html = await renderChatMessage(ctx, mod, rollMessage("Ranged: Light"));
    assert.equal(html, "");
});

test("flavour: a roll by an actor with no matching talent gets no pills", async () => {
    const actor = makeActor({
        items: [makeTalentItem("Quick Strike", ["Brawl"])],
        talentList: [talentListEntry("Quick Strike")],
    });
    const ctx = install({ actors: [actor] });
    const mod = await load();
    const html = await renderChatMessage(ctx, mod, rollMessage("Rolling Ranged: Light..."));
    assert.equal(html, "");
});

test("flavour: players are not shown the talents of a GM-owned actor", async () => {
    const actor = makeActor({
        hasPlayerOwner: false,
        items: [makeTalentItem("Quick Strike", ["Ranged: Light"])],
        talentList: [talentListEntry("Quick Strike")],
    });
    const ctx = install({ actors: [actor], isGM: false });
    const mod = await load();
    const html = await renderChatMessage(ctx, mod, rollMessage("Rolling Ranged: Light..."));
    assert.equal(html, "");
});

test("flavour: the GM is shown the talents of a GM-owned actor", async () => {
    const actor = makeActor({
        hasPlayerOwner: false,
        items: [makeTalentItem("Quick Strike", ["Ranged: Light"])],
        talentList: [talentListEntry("Quick Strike")],
    });
    const ctx = install({ actors: [actor], isGM: true });
    const mod = await load();
    const html = await renderChatMessage(ctx, mod, rollMessage("Rolling Ranged: Light..."));
    assert.match(html, /Quick Strike/);
});

test("flavour: an unlinked token's own actor is used in preference to the prototype", async () => {
    const prototype = makeActor({
        id: "actor1",
        items: [makeTalentItem("Prototype Talent", ["Brawl"])],
        talentList: [talentListEntry("Prototype Talent")],
    });
    const synthetic = makeActor({
        id: "actor1",
        items: [makeTalentItem("Token Talent", ["Brawl"])],
        talentList: [talentListEntry("Token Talent")],
    });
    const ctx = install({ actors: [prototype] });
    game.actors.tokens = { token1: synthetic };
    const mod = await load();
    const html = await renderChatMessage(
        ctx,
        mod,
        rollMessage("Rolling Brawl...", { tokenId: "token1" })
    );
    assert.match(html, /Token Talent/);
    assert.doesNotMatch(html, /Prototype Talent/);
});

test("flavour: the feature switch silences the pills", async () => {
    const actor = makeActor({
        items: [makeTalentItem("Quick Strike", ["Brawl"])],
        talentList: [talentListEntry("Quick Strike")],
    });
    const ctx = install({
        actors: [actor],
        settings: { "ffg-star-wars-enhancements.talent-skill-association": false },
    });
    const mod = await load();
    const html = await renderChatMessage(ctx, mod, rollMessage("Rolling Brawl..."));
    assert.equal(html, "");
});
