/**
 * Use case · Landkarte roundtrip — step 2: validate the round-trip
 *
 * The mirror of src/1-build-kg/3-validate-roundtrip.js, one turn further out.
 * There, landscape2 rebuilds the *reconstructed* source and it is checked against
 * upstream full.json. Here it rebuilds the *graph-derived* source (the output of
 * 1-build-sources.js) and checks it the same way — proving the knowledge graph
 * carries the modeled Landkarte content losslessly, all the way back to a
 * landscape2-compiled full.json. Same shared machinery; only the inputs and the
 * compared field set differ.
 *
 * The graph is the semantic core, so only the modeled fields are compared:
 * category/subcategory, homepage, description, logo, maturity (reifegrad) and the
 * modeled annotations (dstype, owner, version, the six Konformität pairs). Fields
 * the lift doesn't carry yet — tags, summaries, maturity dates, audits, cf_overall
 * — are excluded, not expected to match. cf_*_value is normalized to a number on
 * both sides (the source mixes "33,3%"/"10%"; the graph stores 33.3). Item order
 * isn't checked (the comparison is keyed by name); the known group-order gap is
 * documented in modeling-choices.md.
 *
 * Run: node src/3-prepare-webapp/landkarte-roundtrip/2-validate-roundtrip.js
 *
 * Requires the landscape2 CLI (no npm package): brew install cncf/landscape2/landscape2
 */

import { ROOT, UPSTREAM, SCRATCH, PREPARE_WEBAPP } from "../../common/utils.js"
import { requireFiles, validateRoundtrip } from "../../common/landscape2.js"
import path from "path"

const OUT_DIR = path.join(PREPARE_WEBAPP, "landkarte-roundtrip")
const DATA_FILE = path.join(OUT_DIR, "landscape.yml")
const SETTINGS_FILE = path.join(OUT_DIR, "settings.yml")
const ORIGINAL = path.join(UPSTREAM, "full.json")

// Compare only the annotation keys the graph actually models — an allowlist, so
// upstream's un-modeled extras (build-derived category/subcategory, the fork's
// item_color/item_size, the sparse cf_overall_*) are simply out of scope. cf_*_value
// is normalized to a number so "33,3%" / "10%" / "33.3" all compare equal.
const CF_CRITERIA = ["sovereignty", "interoperability", "actuality", "market", "trustworthiness", "sustainability"]
const cfKeys = CF_CRITERIA.flatMap(c => [`cf_${c}_label`, `cf_${c}_value`])
const MODELED = new Set(["dstype", "bs_owner", "bs_number", ...cfKeys])
const modeledAnnotations = it => {
    const out = {}
    for (const [k, v] of Object.entries(it.annotations || {})) {
        if (!MODELED.has(k)) continue
        out[k] = k.endsWith("_value") ? parseFloat(String(v).replace("%", "").replace(",", ".")) : v
    }
    return out
}
const fields = {
    category: it => (it.category || "").trim(),
    subcategory: it => (it.subcategory || "").trim(),
    homepage_url: it => it.homepage_url,
    description: it => it.description,
    logo: it => it.logo,
    maturity: it => it.maturity,
    annotations: modeledAnnotations,
}

requireFiles([DATA_FILE, SETTINGS_FILE, ORIGINAL], ROOT, "run npm run landkarte:prepare first")
const n = validateRoundtrip({
    dataFile: DATA_FILE, settingsFile: SETTINGS_FILE, reference: ORIGINAL,
    scratch: SCRATCH, logosZip: path.join(UPSTREAM, "logos.zip"),
    buildDir: path.join(SCRATCH, "roundtrip-build"), cacheDir: path.join(SCRATCH, "landscape2-cache"),
    fields, failLabel: "difference(s) on modeled fields (graph-derived vs upstream full.json):",
})

console.log(`OK: the graph-derived Landkarte reproduces upstream full.json on every modeled field, across all ${n} items`)
console.log("    (item order and the not-yet-modeled fields are out of scope — see modeling-choices.md)")
