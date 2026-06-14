/**
 * Step 3: validate the reconstruction by round-tripping it through
 * landscape2 and structurally comparing the result to the upstream original.
 *
 * landscape2 build is the inverse of step 2's reconstruction: fed the
 * reconstructed landscape.yml + settings.yml and the logos, it recompiles a
 * full.json. If that matches the authoritative data/1-build-kg/upstream/full.json on every
 * content field, the reconstruction is faithful. The built site is kept under
 * data/scratch/build/ (gitignored) so it can be eyeballed with `landscape2 serve`,
 * but it is not the deployment path — rendering comes later, from the graph in
 * src/3-use-cases.
 *
 * The one expected difference is the category/subcategory whitespace that step 2
 * normalizes (upstream mixes U+0020 and U+2000); the comparison trims those, so
 * any other drift fails the check.
 *
 * Requires the landscape2 CLI (no npm package): brew install cncf/landscape2/landscape2
 */

import { ROOT, UPSTREAM, RECONSTRUCTED, SCRATCH } from "../common/utils.js"
import { requireFiles, validateRoundtrip } from "../common/landscape2.js"
import path from "path"

const DATA_FILE = path.join(RECONSTRUCTED, "landscape.yml")
const SETTINGS_FILE = path.join(RECONSTRUCTED, "settings.yml")
const ORIGINAL = path.join(UPSTREAM, "full.json")

// Every content field step 2 round-trips must be equal. category/subcategory are
// trimmed on both sides (the one intended normalization); annotations drop
// landscape2's build-derived category/subcategory copies; tags are order-insensitive.
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

requireFiles([DATA_FILE, SETTINGS_FILE, ORIGINAL], ROOT, "run steps 1 and 2 first")
const n = validateRoundtrip({
    dataFile: DATA_FILE, settingsFile: SETTINGS_FILE, reference: ORIGINAL,
    scratch: SCRATCH, logosZip: path.join(UPSTREAM, "logos.zip"),
    buildDir: path.join(SCRATCH, "build"), cacheDir: path.join(SCRATCH, "landscape2-cache"),
    fields, failLabel: "structural difference(s) (rebuilt vs authoritative full.json):",
})

console.log(`OK: rebuilt full.json matches data/1-build-kg/upstream/full.json across all ${n} items`)
console.log(`    full site kept at data/scratch/build/ — view it with: landscape2 serve --landscape-dir data/scratch/build`)
