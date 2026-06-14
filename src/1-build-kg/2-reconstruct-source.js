/**
 * Step 2: reconstruct the landscape2 source files from the fetched
 * full.json.
 *
 * The Landkarte's own landscape.yml is not public, so this step inverts the
 * landscape2 build: fields the build derives (id, oss, website,
 * additional_categories, the category/subcategory copies inside annotations)
 * are omitted; everything else maps back to its source position. No content
 * is interpreted or corrected — the reconstruction is judgment-free. Together
 * with the logos it forms a buildable landscape2 source (step 3 verifies the
 * round-trip). The day the BMDS publishes its real landscape.yml, this step
 * falls away and everything downstream applies unchanged.
 *
 * settings.yml can only be reconstructed in part: just the category/subcategory
 * tree is recoverable from full.json. Theme, header/footer, badge rules and
 * Konformität rendering are not — so settings.yml is a minimal stand-in, enough
 * to let landscape2 build, not a faithful copy.
 */

import { UPSTREAM, RECONSTRUCTED } from "../common/utils.js"
import yaml from "js-yaml"
import path from "path"
import fs from "fs"

const SRC = path.join(UPSTREAM, "full.json")
const META = path.join(UPSTREAM, "full.meta.json")
const OUT_YML = path.join(RECONSTRUCTED, "landscape.yml")
const OUT_SETTINGS = path.join(RECONSTRUCTED, "settings.yml")

const items = JSON.parse(fs.readFileSync(SRC, "utf8")).items
const meta = JSON.parse(fs.readFileSync(META, "utf8"))

// Category/subcategory nesting; order = order of first appearance, which is
// how landscape2 emitted them and the closest guess at the source order.
// Upstream labels carry inconsistent leading whitespace (a mix of U+0020 and
// U+2000 en-quad), which splits one category across several strings; trim() is
// the one deliberate normalization here, collapsing them to the intended names.
const cats = new Map()
for (const it of items) {
    const c = it.category.trim(), s = it.subcategory.trim()
    if (!cats.has(c)) cats.set(c, new Map())
    if (!cats.get(c).has(s)) cats.get(c).set(s, [])
    cats.get(c).get(s).push(it)
}

function convertItem(it) {
    const extra = {}
    // CNCF-style maturity timeline; landscape2 accepts these under extra.
    if (it.accepted_at) extra.accepted = it.accepted_at
    if (it.incubating_at) extra.incubating = it.incubating_at
    if (it.graduated_at) extra.graduated = it.graduated_at
    if (it.audits?.length) extra.audits = it.audits

    // extra.annotations is landscape2's official free-form passthrough — the
    // D-Stack instance uses it for the entire Steckbrief layer: the
    // STANDARD/TECHNOLOGIE badge (dstype), the six Konformität levels (cf_*),
    // verantwortliche Stelle (bs_owner) and version (bs_number).
    // The category/subcategory entries inside it are build-derived copies.
    // Keys sorted for stable diffs.
    const userAnn = Object.fromEntries(
        Object.entries(it.annotations || {})
            .filter(([k]) => k !== "category" && k !== "subcategory")
            .sort(([a], [b]) => a.localeCompare(b)))
    if (Object.keys(userAnn).length) extra.annotations = userAnn

    if (it.tag?.length) extra.tag = it.tag

    // Steckbrief summary fields, mapped to landscape2's extra.summary_* keys.
    // Preserved as-is, including upstream's repurposed schema fields (the license
    // sits in release_rate, operating systems in personas) — faithful means faithful.
    const s = it.summary || {}
    if (s.business_use_case) extra.summary_business_use_case = s.business_use_case
    if (s.intro_url) extra.summary_intro_url = s.intro_url
    if (s.personas?.length) extra.summary_personas = s.personas.join(", ")
    if (s.release_rate) extra.summary_release_rate = s.release_rate
    if (s.use_case) extra.summary_use_case = s.use_case

    // The source logo field holds an original filename; full.json only carries
    // the post-build hashed path (logos/<hash>.png). The basename is all that
    // survives — and it names the file step 1 fetched, which is enough to build.
    const item = { name: it.name, homepage_url: it.homepage_url }
    if (it.logo) item.logo = path.basename(it.logo)
    if (it.description) item.description = it.description
    if (it.maturity) item.project = it.maturity  // landscape2 input key
    if (Object.keys(extra).length) item.extra = extra
    return item
}

const landscape = {
    categories: [...cats].map(([c, subs]) => ({
        name: c,
        subcategories: [...subs].map(([s, lst]) => ({
            name: s, items: lst.map(convertItem) })),
    })),
}

// settings.yml: only the category tree is data-derived; foundation/url are the
// known instance values, everything else of a real settings.yml is unrecoverable.
const settings = {
    foundation: "Deutschland-Stack",
    url: new URL(meta.source).origin,
    categories: [...cats].map(([c, subs]) => ({
        name: c,
        subcategories: [...subs.keys()],
    })),
}

const stamp = `retrieved ${meta.retrievedAt.slice(0, 10)}`
const dump = obj => yaml.dump(obj, { noRefs: true, lineWidth: 100, sortKeys: false })

fs.mkdirSync(RECONSTRUCTED, { recursive: true })
fs.writeFileSync(OUT_YML,
    `# Reconstructed from ${meta.source} (${stamp})\n` +
    "# Not the original - the actual source file is not public.\n" +
    dump(landscape))
fs.writeFileSync(OUT_SETTINGS,
    `# Minimal reconstruction from ${meta.source} (${stamp}).\n` +
    "# Only the category tree is recoverable; theme, header/footer, badge rules\n" +
    "# and Konformitaet rendering of the original settings.yml are not public.\n" +
    dump(settings))

console.log(`OK: ${items.length} items, ${cats.size} categories -> data/reconstructed/`)
