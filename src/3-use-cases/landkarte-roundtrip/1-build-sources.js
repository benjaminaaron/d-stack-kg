/**
 * Use case · Landkarte roundtrip — step 1: build the source artefacts
 *
 * Rebuilds the landscape2 source files (landscape.yml + settings.yml) straight
 * out of data/graph/d-stack-kg.ttl with plain SPARQL SELECTs and js-yaml — no
 * extra tooling. This is the reverse of build-kg's lift, and it closes the loop
 * the pipeline was built for: full.json → landscape.yml (reconstruct) → the graph
 * (build-kg + enrich) → landscape.yml again, now sourced entirely from the graph.
 *
 * Scope: build-kg lifts most of the Landkarte, so the rebuilt source carries
 * name, homepage, description, reifegrad, the STANDARD/TECHNOLOGIE badge,
 * verantwortliche Stelle, version, the six Konformität dimensions, the logo
 * filename and the source order (dstack:landkartePosition). Not yet modeled, so absent
 * here: maturity dates, audits, tags and the summary_* texts.
 *
 * Output: data/use-cases/landkarte-roundtrip/{landscape.yml,settings.yml}.
 * Render + view them with 3-serve-landkarte.js (npm run 3-landkarte:serve).
 *
 * Run: npm run 3-landkarte
 */

import { storeFromTurtles, sparqlSelect } from "@foerderfunke/sem-ops-utils"
import { ROOT, GRAPH } from "../../common/utils.js"
import yaml from "js-yaml"
import path from "path"
import fs from "fs"

const IN = path.join(GRAPH, "d-stack-kg.ttl")
const OUT_DIR = path.join(ROOT, "data", "use-cases", "landkarte-roundtrip")
const OUT_YML = path.join(OUT_DIR, "landscape.yml")
const OUT_SETTINGS = path.join(OUT_DIR, "settings.yml")

const PRE = `
PREFIX skos:   <http://www.w3.org/2004/02/skos/core#>
PREFIX dct:    <http://purl.org/dc/terms/>
PREFIX schema: <http://schema.org/>
PREFIX ds:     <https://deutschland-stack.gov.de/id/>
PREFIX dstack: <https://deutschland-stack.gov.de/vocab#>
`

if (!fs.existsSync(IN)) throw new Error(`missing ${path.relative(ROOT, IN)} — run npm run 1-build-kg && npm run 2-enrich first`)

const store = storeFromTurtles([fs.readFileSync(IN, "utf8")])

// 1. each item with its group/layer and scalar Steckbrief fields (one row/item)
const itemRows = await sparqlSelect(PRE + `
SELECT ?item ?name ?schicht ?schichtPos ?gruppe ?gruppePos ?itemPos ?logo ?homepage ?description ?reifegrad ?badge ?owner ?version WHERE {
    ?item a dstack:StackElement ;
        skos:prefLabel ?name ;
        dstack:landkartePosition ?itemPos ;
        dct:subject ?g .
    ?g skos:prefLabel ?gruppe ; dstack:landkartePosition ?gruppePos ; skos:broader ?s .
    ?s skos:prefLabel ?schicht ; dstack:landkartePosition ?schichtPos .
    OPTIONAL { ?item dstack:landkarteLogoFile ?logo }
    OPTIONAL { ?item schema:url ?homepage }
    OPTIONAL { ?item dct:description ?description }
    OPTIONAL { ?item dstack:reifegrad ?reifegrad }
    OPTIONAL { ?item dstack:badge ?badge }
    OPTIONAL { ?item dstack:verantwortlicheStelle ?owner }
    OPTIONAL { ?item schema:version ?version }
}`, [store])

// 2. the konformität assessments (six rows per item) -> cf_* annotation pairs.
// Each Kriterium carries its landscape2 annotation stem (dstack:landkarteAnnotationKey),
// so the source key comes straight from the graph — no reverse mapping needed here.
const kfRows = await sparqlSelect(PRE + `
SELECT ?item ?annKey ?stufe ?wert WHERE {
    ?item dstack:konformitaet ?kb .
    ?kb dstack:kriterium ?kriterium ; dstack:stufe ?stufe .
    ?kriterium dstack:landkarteAnnotationKey ?annKey .
    OPTIONAL { ?kb dstack:wertProzent ?wert }
}`, [store])

// fold konformität back onto each item as the original cf_*_label / cf_*_value
const cfByItem = {}
for (const r of kfRows) {
    const ann = (cfByItem[r.item] ||= {})
    ann[`${r.annKey}_label`] = `${r.stufe} von 5`
    if (r.wert !== undefined) ann[`${r.annKey}_value`] = `${r.wert}%`
}

// group items into the categories -> subcategories -> items nesting, ordered by
// the source position carried in the graph (dstack:landkartePosition). Sorting the flat
// rows first makes the insertion-ordered Maps below come out in source order.
const num = x => parseInt(x, 10)
const byCat = new Map()
for (const r of itemRows.sort((a, b) =>
    num(a.schichtPos) - num(b.schichtPos) || num(a.gruppePos) - num(b.gruppePos) || num(a.itemPos) - num(b.itemPos))) {
    if (!byCat.has(r.schicht)) byCat.set(r.schicht, new Map())
    const subs = byCat.get(r.schicht)
    if (!subs.has(r.gruppe)) subs.set(r.gruppe, [])
    subs.get(r.gruppe).push(r)
}

function buildItem(r) {
    const ann = {}
    if (r.badge) ann.dstype = r.badge
    if (r.owner) ann.bs_owner = r.owner
    if (r.version) ann.bs_number = r.version
    Object.assign(ann, cfByItem[r.item] || {})
    // keys sorted for stable diffs, matching step 2's annotation ordering
    const annotations = Object.fromEntries(Object.entries(ann).sort(([a], [b]) => a.localeCompare(b)))

    const item = { name: r.name }
    if (r.homepage) item.homepage_url = r.homepage
    if (r.logo) item.logo = r.logo
    if (r.description) item.description = r.description
    if (r.reifegrad) item.project = r.reifegrad  // landscape2 input key
    if (Object.keys(annotations).length) item.extra = { annotations }
    return item
}

// the Maps were filled in source-position order, so iterating them keeps it
const landscape = {
    categories: [...byCat].map(([cat, subs]) => ({
        name: cat,
        subcategories: [...subs].map(([sub, lst]) => ({ name: sub, items: lst.map(buildItem) })),
    })),
}

// settings.yml: category tree from the taxonomy; url from the graph's own
// provenance stamp (dct:source on the scheme); foundation is the known constant.
// Bind the known scheme (ds:landkarte) directly rather than matching any
// skos:ConceptScheme, so a second scheme later can't make this ambiguous.
const [{ src } = {}] = await sparqlSelect(PRE + `
SELECT ?src WHERE { ds:landkarte dct:source ?src }`, [store])
const settings = {
    foundation: "Deutschland-Stack",
    url: src ? new URL(src).origin : "https://technologie.deutschland-stack.gov.de",
    categories: [...byCat].map(([cat, subs]) => ({ name: cat, subcategories: [...subs].map(([sub]) => sub) })),
}

const dump = obj => yaml.dump(obj, { noRefs: true, lineWidth: 100, sortKeys: false })

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_YML,
    "# Rebuilt from data/graph/d-stack-kg.ttl by the landkarte-roundtrip use case.\n" +
    "# Carries the fields build-kg models, incl. logo filename and source order; the\n" +
    "# logo files come from data/upstream/logos.zip. Not yet modeled: maturity\n" +
    "# dates, audits, tags, summary_* texts.\n" +
    dump(landscape))
fs.writeFileSync(OUT_SETTINGS,
    "# Rebuilt from data/graph/d-stack-kg.ttl — category tree from the SKOS taxonomy;\n" +
    "# foundation/url are the known instance constants.\n" +
    dump(settings))

const subCount = [...byCat.values()].reduce((n, s) => n + s.size, 0)
console.log(`OK: ${itemRows.length} items, ${byCat.size} categories, ${subCount} subcategories -> data/use-cases/landkarte-roundtrip/`)
console.log("    (still unmodeled, so absent: maturity dates, audits, tags, summary_*)")
console.log("check: npm run 3-landkarte:validate   |   view: npm run 3-landkarte:serve")
