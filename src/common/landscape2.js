/**
 * Shared landscape2 helpers — used by the build-kg reconstruction validator, the
 * use-case roundtrip validator, and the use-case server. Wraps the landscape2 CLI
 * (build + the logo staging it needs) and the structural full.json comparison, so
 * all three round-trips share one implementation and differ only in their inputs.
 *
 * Requires the landscape2 CLI (no npm package): brew install cncf/landscape2/landscape2
 */

import { execFileSync } from "child_process"
import { isDeepStrictEqual } from "util"
import path from "path"
import fs from "fs"

// --- internals -------------------------------------------------------------

// Abort with the install hint rather than a raw ENOENT if the CLI is missing.
function ensureLandscape2() {
    try {
        execFileSync("landscape2", ["--version"], { stdio: "ignore" })
    } catch {
        console.error("landscape2 not found. Install it with:\n    brew install cncf/landscape2/landscape2")
        process.exit(1)
    }
}

// Logos live in the repo as a zip; restore the loose copies into <scratch>/logos
// if absent, so a fresh checkout builds without re-fetching (and the rebuilt logo
// hashes get checked). Returns the logos path to hand to `landscape2 build`.
function stageLogos(scratch, logosZip) {
    const logosPath = path.join(scratch, "logos")
    const haveLogos = fs.existsSync(logosPath) && fs.readdirSync(logosPath).some(f => f.endsWith(".png"))
    if (!haveLogos) {
        if (!fs.existsSync(logosZip)) throw new Error(`missing ${logosZip} — run npm run 1-fetch`)
        execFileSync("unzip", ["-q", "-o", logosZip, "-d", scratch])
    }
    return logosPath
}

// landscape2 writes the recompiled dataset under <buildDir>/data/full.json.
const fullJson = buildDir => path.join(buildDir, "data", "full.json")
const loadItems = file => JSON.parse(fs.readFileSync(file, "utf8")).items

// Structural, key-by-name comparison of two item lists over a set of field
// extractors (`{ name: item => value }`), using Node's deep, key-order-insensitive
// isDeepStrictEqual. Returns human-readable difference strings (empty = match).
const show = v => { const s = JSON.stringify(v) ?? "undefined"; return s.length > 60 ? s.slice(0, 60) + "…" : s }
// names that appear more than once in an item list
const duplicateNames = items => {
    const seen = new Set(), dup = new Set()
    for (const it of items) (seen.has(it.name) ? dup : seen).add(it.name)
    return [...dup]
}
function diffItems(original, rebuilt, fields) {
    // The comparison keys items by name, so a duplicate name would silently shadow
    // an entry and compare the wrong pair. Surface that first and stop — the
    // field diffs below would be meaningless until names are unique.
    const diffs = []
    for (const [label, items] of [["original", original], ["rebuilt", rebuilt]])
        for (const name of duplicateNames(items)) diffs.push(`duplicate name in ${label}: ${name}`)
    if (diffs.length) return diffs

    const rebuiltByName = new Map(rebuilt.map(it => [it.name, it]))
    const originalNames = new Set(original.map(it => it.name))
    if (original.length !== rebuilt.length) diffs.push(`item count: original ${original.length} vs rebuilt ${rebuilt.length}`)
    for (const o of original) {
        const r = rebuiltByName.get(o.name)
        if (!r) { diffs.push(`missing in rebuilt: ${o.name}`); continue }
        for (const [name, get] of Object.entries(fields)) {
            if (!isDeepStrictEqual(get(o), get(r))) diffs.push(`${o.name} :: ${name}: ${show(get(o))} != ${show(get(r))}`)
        }
    }
    // and the other direction: items the rebuild invented that upstream never had
    for (const r of rebuilt) if (!originalNames.has(r.name)) diffs.push(`only in rebuilt: ${r.name}`)
    return diffs
}

// --- public API ------------------------------------------------------------

// Guard input paths up front with a helpful hint instead of a downstream ENOENT.
export function requireFiles(files, root, hint) {
    for (const f of files) {
        if (!fs.existsSync(f)) throw new Error(`missing ${path.relative(root, f)} — ${hint}`)
    }
}

// Make the site: ensure the CLI, stage the logos, and `landscape2 build` the given
// sources into buildDir (wiped first). The verbose build log only surfaces on
// failure. Returns buildDir. This is the whole render step the server reuses.
export function renderSite({ dataFile, settingsFile, scratch, logosZip, buildDir, cacheDir }) {
    ensureLandscape2()
    const logosPath = stageLogos(scratch, logosZip)
    fs.rmSync(buildDir, { recursive: true, force: true })
    try {
        execFileSync("landscape2", [
            "build",
            "--data-file", dataFile,
            "--settings-file", settingsFile,
            "--logos-path", logosPath,
            "--cache-dir", cacheDir,
            "--output-dir", buildDir,
        ], { stdio: ["ignore", "pipe", "pipe"] })
    } catch (e) {
        console.error("landscape2 build failed:\n" + (e.stderr?.toString() || e.message))
        process.exit(1)
    }
    return buildDir
}

// The whole round-trip check: render the sources, then structurally compare the
// recompiled full.json against `reference` over `fields`. Prints the diffs and
// exits non-zero on any mismatch; returns the item count on success so the caller
// can print its own OK line. The two validators differ only in what they pass here.
export function validateRoundtrip({ dataFile, settingsFile, reference, scratch, logosZip, buildDir, cacheDir, fields, failLabel }) {
    renderSite({ dataFile, settingsFile, scratch, logosZip, buildDir, cacheDir })
    const original = loadItems(reference)
    const rebuilt = loadItems(fullJson(buildDir))
    const diffs = diffItems(original, rebuilt, fields)
    if (diffs.length) {
        console.error(`FAIL: ${diffs.length} ${failLabel}`)
        for (const d of diffs.slice(0, 40)) console.error(`  - ${d}`)
        if (diffs.length > 40) console.error(`  ... and ${diffs.length - 40} more`)
        process.exit(1)
    }
    return original.length
}
