import test from "node:test";
import assert from "node:assert/strict";
import { installFoundryGlobals } from "./harness/foundry.mjs";
import { importWithPrivates } from "./harness/load-module.mjs";

async function load() {
    return importWithPrivates("scripts/util.js", []);
}

/** Collect everything the code under test writes to the console. */
function captureConsole(fn) {
    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.join(" "));
    try {
        fn();
    } finally {
        console.log = original;
    }
    return lines;
}

/* -------------------------------------------------------------------------- */
/* Debug logging                                                              */
/*                                                                            */
/* The module piggybacks on the system's own debug switch, so turning debug    */
/* off in the system silences the module too.                                 */
/* -------------------------------------------------------------------------- */

test("logging: nothing is written while the system's debug setting is off", async () => {
    installFoundryGlobals({ settings: { "starwarsffg.enableDebug": false } });
    const { log_msg } = await load();
    assert.deepEqual(captureConsole(() => log_msg("shop_generator", "hello")), []);
});

test("logging: a line names the module and the feature that wrote it", async () => {
    installFoundryGlobals({ settings: { "starwarsffg.enableDebug": true } });
    const { log_msg } = await load();
    const lines = captureConsole(() => log_msg("shop_generator", "hello"));
    assert.deepEqual(lines, ["ffg-star-wars-enhancements | shop_generator | hello"]);
});

/* -------------------------------------------------------------------------- */
/* The canvas layer                                                           */
/* -------------------------------------------------------------------------- */

test("layer: the module's canvas layer registers under its own name, above the token layer", async () => {
    installFoundryGlobals();
    const { FfgEnhancementsLayer } = await load();
    const options = FfgEnhancementsLayer.layerOptions;
    assert.equal(options.name, "ffgenhancements");
    assert.ok(options.zIndex > 0, "the layer draws above the default layers");
});
