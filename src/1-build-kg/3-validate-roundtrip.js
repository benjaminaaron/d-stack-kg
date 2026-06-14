/**
 * Step 3: validate the reconstruction by round-tripping it through
 * landscape2 and structurally comparing the result to the upstream original.
 *
 * landscape2 build is the inverse of step 2's reconstruction: fed the
 * reconstructed landscape.yml + settings.yml and the logos, it recompiles a
 * full.json. If that matches the authoritative data/upstream/full.json on every
 * content field, the reconstruction is faithful. The built site is kept under
 * data/scratch/build/ (gitignored) so it can be eyeballed with `landscape2 serve`,
 * but it is not the deployment path — rendering comes later, from the .ttl
 * pipeline in src/use-cases.
 *
 * The one expected difference is the category/subcategory whitespace that step 2
 * normalizes (upstream mixes U+0020 and U+2000); the comparison trims those, so
 * any other drift fails the check.
 *
 * Requires the landscape2 CLI (no npm package): brew install cncf/landscape2/landscape2
 */

import { ROOT, UPSTREAM, RECONSTRUCTED, SCRATCH } from "./utils.js"
import { execFileSync } from "child_process"
import { isDeepStrictEqual } from "util"
import path from "path"
import fs from "fs"

const DATA_FILE = path.join(RECONSTRUCTED, "landscape.yml")
const SETTINGS_FILE = path.join(RECONSTRUCTED, "settings.yml")
const LOGOS_PATH = path.join(SCRATCH, "logos")
const LOGOS_ZIP = path.join(UPSTREAM, "logos.zip")
const ORIGINAL = path.join(UPSTREAM, "full.json")
const BUILD_DIR = path.join(SCRATCH, "build")
const CACHE_DIR = path.join(SCRATCH, "landscape2-cache")
const REBUILT = path.join(BUILD_DIR, "data", "full.json")  // landscape2's recompiled dataset

// Fail with the install hint rather than a raw ENOENT.
try {
    execFileSync("landscape2", ["--version"], { stdio: "ignore" })
} catch {
    console.error("landscape2 not found. Install it with:\n    brew install cncf/landscape2/landscape2")
    process.exit(1)
}

for (const f of [DATA_FILE, SETTINGS_FILE, ORIGINAL]) {
    if (!fs.existsSync(f)) throw new Error(`missing ${path.relative(ROOT, f)} — run steps 1 and 2 first`)
}

// Logos live in the repo as a zip; restore the loose copies if absent so a fresh
// checkout builds without re-fetching (and the rebuilt logo hashes get checked).
const haveLogos = fs.existsSync(LOGOS_PATH) && fs.readdirSync(LOGOS_PATH).some(f => f.endsWith(".png"))
if (!haveLogos) {
    if (!fs.existsSync(LOGOS_ZIP)) throw new Error("missing data/upstream/logos.zip — run npm run 1-fetch")
    execFileSync("unzip", ["-q", "-o", LOGOS_ZIP, "-d", SCRATCH])
}

// Recompile. Capture output so the verbose build log only surfaces on failure.
fs.rmSync(BUILD_DIR, { recursive: true, force: true })
try {
    execFileSync("landscape2", [
        "build",
        "--data-file", DATA_FILE,
        "--settings-file", SETTINGS_FILE,
        "--logos-path", LOGOS_PATH,
        "--cache-dir", CACHE_DIR,
        "--output-dir", BUILD_DIR,
    ], { stdio: ["ignore", "pipe", "pipe"] })
} catch (e) {
    console.error("landscape2 build failed:\n" + (e.stderr?.toString() || e.message))
    process.exit(1)
}

// Structural comparison, keyed by item name: every content field step 2
// round-trips must be equal. category/subcategory are trimmed on both sides
// (the one intended normalization); annotations drop landscape2's build-derived
// category/subcategory copies; tags are order-insensitive. The deep,
// key-order-insensitive equality is Node's built-in util.isDeepStrictEqual.
const annotations = it => {
    const { category, subcategory, ...rest } = it.annotations || {}
    return rest
}
const fields = {
    category: it => (it.category || "").trim(),
    subcategory: it => (it.subcategory || "").trim(),
    homepage_url: it => it.homepage_url,
    description: it => it.description,
    logo: it => it.logo,
    maturity: it => it.maturity,
    accepted_at: it => it.accepted_at,
    incubating_at: it => it.incubating_at,
    graduated_at: it => it.graduated_at,
    audits: it => it.audits,
    tag: it => (it.tag || []).slice().sort(),
    summary: it => it.summary,
    annotations,
}

const original = JSON.parse(fs.readFileSync(ORIGINAL, "utf8")).items
const rebuilt = JSON.parse(fs.readFileSync(REBUILT, "utf8")).items
const rebuiltByName = new Map(rebuilt.map(it => [it.name, it]))

// Compact one-line rendering of a value for the diff report, truncated.
const show = v => { const s = JSON.stringify(v) ?? "undefined"; return s.length > 60 ? s.slice(0, 60) + "…" : s }

const diffs = []
if (original.length !== rebuilt.length) diffs.push(`item count: original ${original.length} vs rebuilt ${rebuilt.length}`)
for (const o of original) {
    const r = rebuiltByName.get(o.name)
    if (!r) { diffs.push(`missing in rebuilt: ${o.name}`); continue }
    for (const [name, get] of Object.entries(fields)) {
        if (!isDeepStrictEqual(get(o), get(r))) diffs.push(`${o.name} :: ${name}: ${show(get(o))} != ${show(get(r))}`)
    }
}

if (diffs.length) {
    console.error(`FAIL: ${diffs.length} structural difference(s) (rebuilt vs authoritative full.json):`)
    for (const d of diffs.slice(0, 40)) console.error(`  - ${d}`)
    if (diffs.length > 40) console.error(`  ... and ${diffs.length - 40} more`)
    process.exit(1)
}

console.log(`OK: rebuilt full.json matches data/upstream/full.json across all ${original.length} items`)
console.log(`    full site kept at data/scratch/build/ — view it with: landscape2 serve --landscape-dir data/scratch/build`)
