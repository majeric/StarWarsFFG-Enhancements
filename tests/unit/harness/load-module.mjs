/**
 * Loads a script from this module so that its *module-private* functions can be
 * unit tested without touching production code.
 *
 * Most of the interesting logic in scripts/ lives in functions that are never
 * exported (Shop, is_roll, load_data, _summarizeQualities, ...). Rather than
 * edit those files to add exports, this reads the source, rewrites its relative
 * imports to absolute file: URLs, appends an export statement for the names the
 * test asks for, and imports a copy written to the OS temp directory. The file
 * on disk in scripts/ is never modified.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MODULE_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../..");

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "ffg-enh-unit-"));
process.on("exit", () => {
    try {
        fs.rmSync(SCRATCH, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
});

let serial = 0;

const RELATIVE_IMPORT = /(\bfrom\s*["'])(\.{1,2}\/[^"']+)(["'])/g;

/**
 * @param {string}   relPath Path to the script, relative to the module root.
 * @param {string[]} names   Module-private binding names to expose.
 * @returns {Promise<object>} The module namespace, including `names`.
 */
export async function importWithPrivates(relPath, names = []) {
    const abs = path.resolve(MODULE_ROOT, relPath);
    const dir = path.dirname(abs);
    let source = fs.readFileSync(abs, "utf8");

    source = source.replace(
        RELATIVE_IMPORT,
        (_m, head, spec, tail) => head + pathToFileURL(path.resolve(dir, spec)).href + tail
    );

    if (names.length) source += `\nexport { ${names.join(", ")} };\n`;

    // A fresh file per call keeps Node from serving a cached copy, so each test
    // re-evaluates the script against the globals it just installed.
    serial += 1;
    const copy = path.join(SCRATCH, `${path.basename(abs, ".js")}.${serial}.mjs`);
    fs.writeFileSync(copy, source, "utf8");
    return import(pathToFileURL(copy).href);
}

/** Read a repo data file (used as a test fixture). */
export function readRepoFile(relPath) {
    return fs.readFileSync(path.resolve(MODULE_ROOT, relPath), "utf8");
}
