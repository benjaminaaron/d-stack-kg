/**
 * Enrich the LeiKa-keyed Leistung hubs with their canonical FIM Steckbrief — the
 * Stamminformation the FIT-Connect layer cannot give (name, legal basis, classification).
 *
 * FIM is an enrichment PASS: it reads the fim:leikaId values already in the graph (the
 * SOURCES below) and, by that LeiKa, fetches the public FIM Portal Steckbrief
 * (GET https://fimportal.de/api/v0/leistung-steckbriefe/{leikaKey}, no auth). The facts
 * land on the same ds:leistung-leika-<leika> hub the FIT-Connect layer created.
 *
 * Kept lean for now: name (dct:title), alt name, legal basis (cpsv:follows → cpsv:Rule),
 * Leistungstyp, OZG-Themenfeld. Codelist-coded facts (typisierung, PV-Lagen, SDG) and the
 * XZuFi synonyms / resolvable-law deep-links are a later pass.
 *
 * It also ingests a few FULLY-FIM-NATIVE exemplars (FIM_SCHEMA_EXEMPLARS): real Datenschemata
 * pulled straight from the central FIM library, where every Datenfeldgruppe/Datenfeld is a
 * governed, resolvable Baustein — the contrast to the bespoke vendor schemas FIT-Connect
 * destinations declare. See fimSchemaTurtle().
 *
 * Writes:
 *   data/2-enrich-kg/fim-leistungen.ttl   the converted RDF (committed — the FIM layer)
 *   data/2-enrich-kg/fim/                  raw Steckbriefe + Datenschemata (gitignored)
 *
 * The committed TTL carries each Leistung's dct:source, so kg:enrich and the deploy never
 * need the network. Run `npm run fim:fetch` to refresh. Needs java (SPARQL Anything).
 *
 * Run: npm run fim:fetch
 */

import { storeFromTurtles, sparqlConstruct, sparqlSelect, storeToTurtle, newStore, addTurtleToStore } from "@foerderfunke/sem-ops-utils"
import { ENRICH_KG, SCRATCH, PREFIXES, FIM_LEISTUNGEN_TTL, FIT_CONNECT_TTL, LIFT_SPARQL } from "../../common/utils.js"
import { execFileSync } from "child_process"
import path from "path"
import fs from "fs"

// the layers whose Leistungen (by fim:leikaId) to enrich. Add PVOG_LEISTUNGEN_TTL to also
// enrich the original 8 PVOG services — note those carry the LeiKa on per-redaktion nodes,
// which raises the LeiKa-hub ↔ PVOG-node cross-link question (deliberately deferred).
const SOURCES = [FIT_CONNECT_TTL]

const UA = "d-stack-kg-fetcher (+https://codeberg.org/benjaminaaron/d-stack-kg)"
const STECKBRIEFE = "https://fimportal.de/api/v0/leistung-steckbriefe/"
const FIM_SCHEMAS = "https://fimportal.de/api/v1/schemas/"
const FIM_PORTAL = "https://fimportal.de"

// fully-FIM-native exemplars: real FIM Datenschemata from the central library, where every
// Datenfeldgruppe/Datenfeld is a governed, resolvable Baustein (no local Nummernkreis brew) —
// the counterpart to the bespoke vendor schemas FIT-Connect destinations declare. FIM exposes no
// machine Leistung↔Schema index (schemas?bezug=<leika> is empty), but the schema's own description
// names its LeiKas, so the conformsTo link is DOCUMENTED (verified against the description below),
// just not routed through a Zustellpunkt (dct:provenance records that).
const FIM_SCHEMA_EXEMPLARS = [
    // Anzeige Meldung Personalausweis (gold) — the fim-native twin of the KAM bespoke schema for
    // the same Leistung (99008001014002, Personalausweis Meldung wegen Verlust)
    { id: "S00000311", version: "1.0", leika: "99008001014002" },
]
const OUT_TTL = FIM_LEISTUNGEN_TTL
const SQL_DIR = path.join(import.meta.dirname, "sparql")
const SA_VERSION = "v1.1.0"
const JAR = path.join(SCRATCH, "tools", "sparql-anything.jar")
const WORK = path.join(ENRICH_KG, "fim")
const RESPONSES_DIR = path.join(WORK, "responses")
const COMBINED = path.join(WORK, "combined.json")
const RAW = path.join(WORK, "raw.ttl")

const today = new Date().toISOString().slice(0, 10)

const getJson = async url => {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return res.json()
}

// fetch a LeiKa's canonical FIM Steckbrief; save raw, return a flat record for the transform
const fetchSteckbrief = async leika => {
    const sourceUrl = STECKBRIEFE + leika
    const sb = await getJson(sourceUrl)
    fs.writeFileSync(path.join(RESPONSES_DIR, `${leika}.json`), JSON.stringify(sb, null, 2) + "\n")  // raw
    const name = sb.leistungsbezeichnung || sb.title
    const altName = sb.leistungsbezeichnung_2
    console.log(`  ${leika}  ${name}`)
    return {
        leika,
        name,
        ...(altName && altName !== name ? { altName } : {}),
        ...(sb.leistungstyp ? { leistungstyp: sb.leistungstyp } : {}),
        ...(sb.rechtsgrundlagen ? { rechtsgrundlagen: sb.rechtsgrundlagen } : {}),
        ...(sb.ozg?.themenfeld ? { themenfeld: sb.ozg.themenfeld, themenfeldLabel: sb.ozg.themenfeld_label } : {}),
        sourceUrl,
        retrievedAt: today,
    }
}

// pull a FIM Datenschema and render it straight to Turtle — the Fachdatenschema node, the
// documented conformsTo edge from its Leistung, and the whole central-Baustein tree (groups →
// fields, mirroring the FIT-Connect field tree). The data is clean structured JSON, so no SPARQL
// Anything lift is needed; every Baustein is central, so its rdfs:seeAlso resolves on the FIM Portal.
const tlit = s => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ").trim()}"`
const TTL_PREFIXES = [
    "@prefix ds: <https://deutschland-stack.gov.de/id/> .",
    "@prefix dstack: <https://deutschland-stack.gov.de/vocab#> .",
    "@prefix fim: <https://deutschland-stack.gov.de/fim#> .",
    "@prefix dct: <http://purl.org/dc/terms/> .",
    "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
    "@prefix schema: <http://schema.org/> .",
].join("\n")

const fimSchemaTurtle = async ({ id, version, leika }) => {
    const url = `${FIM_SCHEMAS}${id}/${version}`
    const s = await getJson(url)
    fs.writeFileSync(path.join(RESPONSES_DIR, `schema-${id}-${version}.json`), JSON.stringify(s, null, 2) + "\n")  // raw
    if (!String(s.beschreibung || "").includes(leika))
        console.warn(`  ! ${id}: description does not name LeiKa ${leika} — link would be assumed, not documented`)
    const cat = {}
    for (const d of [...(s.datenfelder || []), ...(s.datenfeldgruppen || [])]) cat[d.fim_id] = d
    const schemaSlug = `${id}-${version}`.replace(/\./g, "-")
    const schemaIri = `ds:fachdatenschema-${schemaSlug.toLowerCase()}`
    const L = [
        `ds:leistung-leika-${leika} dct:conformsTo ${schemaIri} .`,
        `${schemaIri} a dstack:Fachdatenschema ;`,
        `    rdfs:label ${tlit(`${s.name} ${version}`)} ;`,
        `    dct:format "application/xml" ;`,                         // XDatenfelder / XÖV
        `    dstack:serialisiertAls ds:extensible-markup-language ;`,
        `    schema:version ${tlit(version)} ;`,
        `    dct:publisher ${tlit(s.status_gesetzt_durch || "FIM-Baukasten (Bund)")} ;`,
        `    dct:provenance "Aus der zentralen FIM-Bibliothek dokumentiert (LeiKa-Nr. in der Schemabeschreibung) — nicht über einen FIT-Connect-Zustellpunkt deklariert."@de ;`,
        `    dct:source <${url}> .`,
    ]
    let nodes = 0
    // the schema's top-level `children` only reference the root Bausteine; a Datenfeldgruppe's
    // members live on its own catalog definition (meta.children), so groups recurse through the
    // catalog. seen guards against a group nesting into itself.
    const emit = (c, parentIri, parentPath, seen) => {
        const fid = c.fim_id
        const meta = cat[fid] || {}
        const isGroup = fid.startsWith("G")
        const ver = c.fim_version || meta.fim_version
        const pathS = parentPath ? `${parentPath}-${fid}` : fid
        const iri = `ds:datenfeld-${schemaSlug.toLowerCase()}-${pathS}`
        const portal = `${FIM_PORTAL}/${isGroup ? "groups" : "fields"}/baukasten/${fid}/${ver}`
        L.push(
            `${parentIri} fim:datenfeld ${iri} .`,
            `${iri} a ${isGroup ? "fim:Datenfeldgruppe" : "fim:Datenfeld"} ;`,
            `    rdfs:label ${tlit(meta.name || fid)} ;`,
            `    dct:identifier ${tlit(fid)} ;`,
            `    fim:baustein ${tlit(fid)} ;`,
            `    rdfs:seeAlso <${portal}> .`,
        )
        nodes++
        if (isGroup && !seen.has(fid))
            for (const k of (meta.children || [])) emit(k, iri, pathS, new Set([...seen, fid]))
    }
    for (const c of (s.children || [])) emit(c, schemaIri, "", new Set())
    console.log(`  ${id} v${version}  ${s.name}  → ${nodes} zentrale Bausteine → leika ${leika}`)
    return `${TTL_PREFIXES}\n\n${L.join("\n")}\n`
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

// 1. collect the LeiKas to enrich — every fim:leikaId in the source layers
const sources = storeFromTurtles(SOURCES.map(p => fs.readFileSync(p, "utf8")))
const leikas = (await sparqlSelect(
    "PREFIX fim: <https://deutschland-stack.gov.de/fim#> SELECT DISTINCT ?leika WHERE { ?l fim:leikaId ?leika }",
    [sources])).map(r => r.leika).sort()
console.log(`enriching ${leikas.length} Leistung(en) from FIM (${STECKBRIEFE})`)

// 2. fetch each canonical Steckbrief
const records = await Promise.all(leikas.map(fetchSteckbrief))

// 3. lift the records to raw Facade-X with SPARQL Anything
await ensureJar()
fs.writeFileSync(COMBINED, JSON.stringify(records))
execFileSync("java", ["-jar", JAR, "-q", LIFT_SPARQL,
    "-v", `location=${COMBINED}`, "-v", "mediatype=application/json", "-f", "TTL", "-o", RAW], { stdio: ["ignore", "ignore", "inherit"] })

// 4. transform Facade-X → the FIM Steckbrief shape (CONSTRUCT queries, in order)
const raw = storeFromTurtles([fs.readFileSync(RAW, "utf8")])
const store = newStore()
const transformDir = path.join(SQL_DIR, "transform")
for (const f of fs.readdirSync(transformDir).filter(f => f.endsWith(".sparql")).sort()) {
    await sparqlConstruct(fs.readFileSync(path.join(transformDir, f), "utf8"), [raw], store)
}

// 5. append the fully-FIM-native Datenschema exemplar(s), rendered directly to Turtle and added
//    to the same store (FIM-sourced → belongs in this layer, alongside the Steckbrief facts)
console.log(`ingesting ${FIM_SCHEMA_EXEMPLARS.length} fully-FIM-native Datenschema exemplar(s)`)
for (const ex of FIM_SCHEMA_EXEMPLARS) addTurtleToStore(store, await fimSchemaTurtle(ex))

const header =
    "# Canonical FIM Leistungs-Steckbriefe (name, legal basis, Leistungstyp, OZG-Themenfeld) read by\n" +
    "# LeiKa, plus fully-FIM-native Datenschema exemplar(s) from the central FIM library. Generated by\n" +
    "# src/2-enrich-kg/fim/fetch.js — not hand-edited. Each carries its exact dct:source. Retrieved " + today + ".\n\n"
fs.writeFileSync(OUT_TTL, header + await storeToTurtle(store, PREFIXES))
console.log(`OK: ${records.length} Steckbrief(e) + ${FIM_SCHEMA_EXEMPLARS.length} Datenschema -> ${store.size} triples -> ${path.relative(ENRICH_KG, OUT_TTL)}`)
