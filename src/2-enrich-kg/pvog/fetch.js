/**
 * Ingest real Verwaltungsleistungen from the FITKO PVOG Suchdienst (public API,
 * host pvog.fitko.net) and convert them to RDF for the enrich phase.
 *
 * The verified two-step recipe:
 *   1. GET /suchdienst/api/v3/servicedescriptions/leikaid?leikaIds=&ars=&validDate=
 *      → a Spring Data Page; content[0].id is the lbid.
 *   2. GET /suchdienst/api/v6/servicedescriptions/{lbid}/detail?ars=<12digit>&validDate=
 *      → the full service description (12-digit ARS required).
 *
 * The JSON → RDF conversion follows the repo's lift/transform idiom (the same one
 * build-kg uses): SPARQL Anything triplifies the responses into the raw Facade-X
 * model (the shared common/sparql/lift.sparql), then a CONSTRUCT reshapes them into the
 * EU public-service vocabularies (sparql/transform/*.sparql).
 *
 * Writes:
 *   data/2-enrich-kg/pvog-leistungen.ttl   the converted RDF (committed — the services layer)
 *   data/2-enrich-kg/pvog/                  raw responses + lift intermediates (gitignored)
 *
 * The converted TTL is committed, so kg:enrich and the deploy never need the network
 * (provenance is each Leistung's exact dct:source URL + dct:date in the TTL). The raw
 * responses are gitignored working files. Run `npm run pvog:fetch` to refresh from
 * live PVOG. Needs java (SPARQL Anything).
 *
 * Run: npm run pvog:fetch
 */

import { storeFromTurtles, sparqlConstruct, storeToTurtle, newStore } from "@foerderfunke/sem-ops-utils"
import { ENRICH_KG, SCRATCH, PREFIXES, PVOG_LEISTUNGEN_TTL, LIFT_SPARQL } from "../../common/utils.js"
import { execFileSync } from "child_process"
import path from "path"
import fs from "fs"

// the Leistungen to ingest: (LeiKa-ID, ARS) pairs verified to return content with a
// real Onlinedienst. A deliberate sweep across life domains (identity, civil registry,
// business, justice, housing, mobility, social housing, local tax) and authorities, so
// the "which services are affected if standard X changes?" query returns a varied,
// recognisable set. LeiKa-IDs are the national "99…" keys from verwaltung.bund.de.
const SERVICES = [
    { leikaId: "99008001012000", ars: "02000000", note: "Personalausweis beantragen — Hamburg" },
    { leikaId: "99027002012000", ars: "05315000", note: "Geburtsurkunde beantragen — Köln" },
    { leikaId: "99050012104000", ars: "05315000", note: "Gewerbe anmelden — Köln" },
    { leikaId: "99049001001000", ars: "11000000", note: "Führungszeugnis beantragen — Berlin (Bundesamt für Justiz)" },
    { leikaId: "99107023037000", ars: "11000000", note: "Wohngeld – Mietzuschuss beantragen — Berlin" },
    { leikaId: "99108001001000", ars: "11000000", note: "Parkausweis für Bewohner beantragen — Berlin" },
    { leikaId: "99107022012000", ars: "11000000", note: "Wohnberechtigungsschein (WBS) beantragen — Berlin" },
    { leikaId: "99102013104000", ars: "05315000", note: "Hundesteuer Anmeldung — Köln" },
]

const SUCHDIENST = "https://pvog.fitko.net/suchdienst/api"
const OUT_TTL = PVOG_LEISTUNGEN_TTL
const SQL_DIR = path.join(import.meta.dirname, "sparql")
const SA_VERSION = "v1.1.0"
const JAR = path.join(SCRATCH, "tools", "sparql-anything.jar")
// all PVOG fetch/transform intermediates are bundled here and gitignored
const WORK = path.join(ENRICH_KG, "pvog")
const RESPONSES_DIR = path.join(WORK, "responses")
const COMBINED = path.join(WORK, "combined.json")
const RAW = path.join(WORK, "raw.ttl")

const today = new Date().toISOString().slice(0, 10)
const pad12 = ars => (ars + "000000000000").slice(0, 12)

// PVOG text modules (Beschreibung/Rechtsgrundlage/Kosten) are HTML-ish: tags plus
// named/numeric entities. Clean them here so the literals are plain text and the
// transform can stay purely structural (no REPLACE chains in SPARQL).
const NAMED = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß",
    bdquo: "„", ldquo: "“", rdquo: "”", sbquo: "‚", lsquo: "‘", rsquo: "’",
    ndash: "–", mdash: "—", hellip: "…", euro: "€", sect: "§", deg: "°", middot: "·" }
const decodeEntities = s => s
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&(\w+);/g, (m, name) => NAMED[name] ?? m)
const cleanText = s => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()

const getJson = async url => {
    const res = await fetch(url, { headers: { Accept: "application/json" } })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return res.json()
}

// resolve (leikaId, ARS) → lbid, then fetch the v6 detail; save the raw response and
// return a working copy cleaned + annotated with exact provenance for the transform
const fetchDetail = async ({ leikaId, ars, note, optional }) => {
    const page = await getJson(`${SUCHDIENST}/v3/servicedescriptions/leikaid?leikaIds=${leikaId}&ars=${ars}&validDate=${today}`)
    const lbid = page.content?.[0]?.id
    if (!lbid) {
        if (optional) { console.warn(`  skip (no content): ${note}`); return null }
        throw new Error(`no PVOG content for ${note} (leikaId ${leikaId}, ars ${ars}) — set optional:true to allow skipping`)
    }
    // the v6 detail needs the (padded) ARS + validDate; keep the exact URL as provenance
    const sourceUrl = `${SUCHDIENST}/v6/servicedescriptions/${lbid}/detail?ars=${pad12(ars)}&validDate=${today}`
    const detail = await getJson(sourceUrl)
    fs.writeFileSync(path.join(RESPONSES_DIR, `${lbid}.json`), JSON.stringify(detail, null, 2) + "\n")  // raw
    for (const d of detail.details ?? []) if (typeof d.text === "string") d.text = cleanText(d.text)
    detail.sourceUrl = sourceUrl
    detail.retrievedAt = today
    console.log(`  ${lbid}  ${detail.name}  (${note})`)
    return detail
}

// SPARQL Anything (no npm package) — cached in scratch (gitignored), as in build-kg
async function ensureJar() {
    if (fs.existsSync(JAR)) return
    const url = `https://github.com/SPARQL-Anything/sparql.anything/releases/download/${SA_VERSION}/sparql-anything-${SA_VERSION}.jar`
    console.log(`Downloading sparql-anything ${SA_VERSION} ...`)
    fs.mkdirSync(path.dirname(JAR), { recursive: true })
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
    fs.writeFileSync(JAR, Buffer.from(await res.arrayBuffer()))
}

try {
    execFileSync("java", ["-version"], { stdio: "ignore" })
} catch {
    console.error("java not found — SPARQL Anything needs a JRE (e.g. brew install openjdk)")
    process.exit(1)
}

fs.mkdirSync(RESPONSES_DIR, { recursive: true })
fs.mkdirSync(SCRATCH, { recursive: true })

// 1. fetch the raw v6 detail responses from live PVOG
console.log(`fetching ${SERVICES.length} Leistung(en) from ${SUCHDIENST} (validDate ${today})`)
const details = (await Promise.all(SERVICES.map(fetchDetail))).filter(Boolean)

// 2. lift the combined responses to raw Facade-X with SPARQL Anything
await ensureJar()
fs.writeFileSync(COMBINED, JSON.stringify(details))
execFileSync("java", ["-jar", JAR, "-q", LIFT_SPARQL,
    "-v", `location=${COMBINED}`, "-v", "mediatype=application/json", "-f", "TTL", "-o", RAW], { stdio: ["ignore", "ignore", "inherit"] })

// 3. transform Facade-X → the EU public-service shape (CONSTRUCT queries, in order)
const raw = storeFromTurtles([fs.readFileSync(RAW, "utf8")])
const store = newStore()
const transformDir = path.join(SQL_DIR, "transform")
for (const f of fs.readdirSync(transformDir).filter(f => f.endsWith(".sparql")).sort()) {
    await sparqlConstruct(fs.readFileSync(path.join(transformDir, f), "utf8"), [raw], store)
}

const header =
    "# Real Verwaltungsleistungen ingested from the FITKO PVOG Suchdienst, modelled with\n" +
    "# the EU public-service vocabularies (CPSV-AP / CCCEV). Generated by\n" +
    "# src/2-enrich-kg/pvog/fetch.js from the fetched PVOG responses — not hand-edited.\n" +
    `# Source: PVOG Suchdienst v6 /detail; each Leistung carries its exact dct:source URL + dct:date. Retrieved ${today}.\n\n`
fs.writeFileSync(OUT_TTL, header + await storeToTurtle(store, PREFIXES))
console.log(`OK: ${details.length} Leistung(en) -> ${store.size} triples -> ${path.relative(ENRICH_KG, OUT_TTL)}`)
