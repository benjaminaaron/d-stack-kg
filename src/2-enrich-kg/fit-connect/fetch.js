/**
 * Ingest live FIT-Connect Zustellpunkte and convert them to RDF — the third enrich
 * layer, joining the administrative services to the data they collect.
 *
 * Access model (no API key, no sandbox — reads only, never submits):
 *   - the production Routing API (leikaKey + ars → destinationId) is bot-protected
 *     and unusable anonymously, so destinationIds are harvested out of band (from
 *     public FITKO GitLab issues), not routed;
 *   - reading a destination IS public: GET /submission-api/v2/destinations/{id}
 *     returns its Leistungen, regions and Fachdatenschema URIs, no auth.
 *
 * For each destination we flatten publicServices to one record per Leistung × schema,
 * then convert JSON → RDF with the repo's lift/transform idiom (SPARQL Anything lift
 * → CONSTRUCT). Governed XÖV Fachdatenschema URNs (e.g. XSozial) are resolvable in
 * XRepository and surface as dstack:ReferenzierterStandard / dstack:inLandkarte false.
 *
 * Writes:
 *   data/2-enrich-kg/fit-connect.ttl   the converted RDF (committed — the schema layer)
 *   data/2-enrich-kg/fit-connect/      raw destination reads (gitignored)
 *
 * The committed TTL carries each fact's dct:source, so kg:enrich and the deploy never
 * need the network. Run `npm run fit-connect:fetch` to refresh. Needs java (SPARQL Anything).
 *
 * Run: npm run fit-connect:fetch
 */

import { storeFromTurtles, sparqlConstruct, storeToTurtle, newStore } from "@foerderfunke/sem-ops-utils"
import { ENRICH_KG, SCRATCH, PREFIXES, FIT_CONNECT_TTL, LIFT_SPARQL } from "../../common/utils.js"
import { execFileSync } from "child_process"
import path from "path"
import fs from "fs"

// the Zustellpunkte to ingest. destinationIds are harvested from public FITKO GitLab
// issues (the routing API is not anonymously usable); reads are public. Three contrasting
// live destinations — three data ecosystems: an all-XÖV standard (XSozial), a FIM-derived
// bespoke JSON (KAM), and a govOS/THAVEL platform whose services aren't even LeiKa-keyed.
const DESTINATIONS = [
    { id: "f76774a7-5584-481e-9fd6-275fab9e4ce8", note: "Landkreis Traunstein — 6 Sozialleistungen, XSozial-Basis" },
    { id: "a8ca34eb-2db8-411c-b9a3-562da95371f5", note: "Niedersachsen (KAM) — 2 Meldewesen-Leistungen, bespoke JSON" },
    // The two Beihilfe forms are large — their field trees flatten to ~250 and ~100 nodes,
    // so this single destination accounts for the bulk of fit-connect.ttl. We keep them in
    // full deliberately: that depth is real form data, the tree is collapsed by default in the
    // webapp, and the no-LeiKa finding only makes its point against an authentically granular
    // schema. (If the file ever needs slimming, cap walkSchema's recursion depth here, not by
    // dropping the destination — the Zustellpunkt-without-LeiKa is the reason it's included.)
    { id: "db2c5da7-8ea8-491c-856a-2edfb14b74fd", note: "Thüringen (govOS/THAVEL) — 2 Beihilfe-Leistungen, govOS-JSON, OHNE LeiKa" },
]

const UA = "d-stack-kg-fetcher (+https://codeberg.org/benjaminaaron/d-stack-kg)"
const SUBMISSION = "https://prod.fit-connect.fitko.net/submission-api/v2"
const XREPOSITORY_API = "https://www.xrepository.de/api/xrepository/"
const XREPOSITORY_DETAILS = "https://www.xrepository.de/details/"
const FIM_API = "https://fimportal.de/api/v1"          // Baukasten lookup (resolves the exact version)
const FIM_PORTAL = "https://fimportal.de"              // human page; needs the precise version in the path
const OUT_TTL = FIT_CONNECT_TTL
const SQL_DIR = path.join(import.meta.dirname, "sparql")
const SA_VERSION = "v1.1.0"
const JAR = path.join(SCRATCH, "tools", "sparql-anything.jar")
const WORK = path.join(ENRICH_KG, "fit-connect")
const RESPONSES_DIR = path.join(WORK, "responses")
const COMBINED = path.join(WORK, "combined.json")
const RAW = path.join(WORK, "raw.ttl")

const today = new Date().toISOString().slice(0, 10)
const leikaOf = identifier => (identifier.match(/\d{14}/) || [])[0]
const regionKey = region => (region || "").replace(/^DE/, "").padEnd(12, "0")

// the Landkarte data-format tile each Fachdatenschema is encoded in — the small "bridge"
// that ties the data layer positively into the Tech-Stack-Landkarte (XML / JSON ARE tiles,
// even where the domain standard, e.g. XSozial, is not). A format identification, not a guess.
const FORMAT_TILE = {
    "application/xml": "extensible-markup-language",
    "application/json": "javascript-object-notation",
}

const fetchText = async url => {
    const res = await fetch(url, { headers: { "user-agent": UA } })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return res.text()
}

// the proper display name of an XÖV standard lives in its XRepository VersionStandard
// (the "<Name> Spezifikation Version X" entry); memoised, falls back to the URN name.
const xoevNames = new Map()
const xoevName = async urn => {
    if (!xoevNames.has(urn)) {
        let name = null
        try {
            const xml = await fetchText(XREPOSITORY_API + urn)
            name = (xml.match(/<dat:name>([^<]+?)\s+Spezifikation\b/) || [])[1]?.trim() || null
        } catch { /* offline / unexpected format → fall back to the URN name */ }
        xoevNames.set(urn, name)
    }
    return xoevNames.get(urn)
}

// resolve a cited FIM Baustein (Datenfeld 'F…' or Datenfeldgruppe 'G…') to its FIM Portal page,
// or null if it isn't in the central Baukasten (e.g. a vendor's own Nummernkreis id — a real
// traceability gap, then left unlinked). The API gives the exact latest version the human page
// needs (groups live under /groups/, fields under /fields/). Memoised; never ships a dead link.
const fimResolved = new Map()
const resolveFimBaustein = async baustein => {
    if (!fimResolved.has(baustein)) {
        const kind = baustein.startsWith("G") ? "groups" : "fields"
        let url = null
        try {
            const body = await getJson(`${FIM_API}/${kind}/baukasten/${baustein}`)
            const items = Array.isArray(body) ? body : (body.items || [])
            const version = (items.find(i => i.is_latest) || items[items.length - 1])?.fim_version
            if (version) url = `${FIM_PORTAL}/${kind}/baukasten/${baustein}/${version}`
        } catch { /* not central / network → no link */ }
        fimResolved.set(baustein, url)
    }
    return fimResolved.get(baustein)
}

const slug = s => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")
// a schema's fields form a tree (Datenfeldgruppe → Datenfelder / sub-groups), exactly like FIM's
// Baukasten — so we walk the JSON-Schema $refs recursively and flatten it to a node list. Each node
// names the FIM Baustein it is "Basiert auf"/"Entspricht dem FIM-Baustein …", read from the
// definition (authoritative per field, unlike the noisier property-level text), with a resolved FIM
// Portal link where the id is central. parentSlug "ROOT" = a top-level node attached to the schema.
const walkSchema = async (key, node, defs, parentSlug, pathSlug, seen, out) => {
    const def = node.$ref ? (defs[node.$ref.split("/").pop()] || {}) : node
    const refName = node.$ref ? node.$ref.split("/").pop() : null
    if (refName && seen.has(refName)) return            // guard against recursive $refs
    const childProps = def.properties
        || def.items?.properties
        || (def.items?.$ref ? (defs[def.items.$ref.split("/").pop()] || {}).properties : null)
    // the FIM Baustein: govOS schemas key their properties BY the FIM id (G16003311); KAM cites it
    // in the field's prose ("Basiert auf G17007419"). Prefer the key when it is itself a FIM id.
    const baustein = (/^[FG]\d{7,8}$/.test(key) ? key : null)
        || ([node.title, node.description, def.title, def.description].filter(Boolean)
            .join(" ").match(/\b[FG]\d{7,8}\b/) || [])[0]
    // some source titles lead with the Baustein reference ("Basierend auf G17007420. …"); drop that
    // metadata prefix (the id is captured in fim:baustein) for a clean label
    const label = (node.title || def.title || key)
        .replace(/^Basier(?:t|end) auf (?:dem )?(?:FIM-Baustein )?[FG]\d{7,8}\.?\s*/i, "").trim() || key
    out.push({
        nodeSlug: pathSlug,
        parentSlug: parentSlug,
        key,
        label,
        kind: childProps ? "group" : "field",
        ...(baustein ? { baustein } : {}),
        ...(baustein ? { fimportal: await resolveFimBaustein(baustein) } : {}),
    })
    if (childProps) {
        const nextSeen = refName ? new Set([...seen, refName]) : seen
        for (const [ck, cv] of Object.entries(childProps)) {
            await walkSchema(ck, cv, defs, pathSlug, `${pathSlug}-${slug(ck)}`, nextSeen, out)
        }
    }
}

// the actual Datenfelder a citizen submits — the field tree of a bespoke JSON-Schema (the precise
// per-service schemas; generic XÖV standards like XSozial don't expose these). Memoised by URL.
const jsonSchemas = new Map()
const jsonSchema = async url => {
    if (!jsonSchemas.has(url)) {
        let parsed = { fields: [] }
        try {
            const s = JSON.parse(await fetchText(url))
            const defs = s.definitions || s.$defs || {}
            const fields = []
            for (const [key, v] of Object.entries(s.properties || {})) {
                await walkSchema(key, v, defs, "ROOT", slug(key), new Set(), fields)
            }
            parsed = { title: s.title, fields }
        } catch { /* schema unreachable / not JSON → no fields */ }
        jsonSchemas.set(url, parsed)
    }
    return jsonSchemas.get(url)
}

// derive the stable facts of a Fachdatenschema from its URI. XÖV standards are URNs
// (urn:xoev-de:<publisher>:standard:<name>_<version>), with their proper name resolvable
// in XRepository; everything else is a bespoke per-service schema hosted at a plain URL,
// keyed by slugBase (the LeiKa, or the govOS id where no LeiKa exists).
const versionOf = uri => (uri.match(/\/(\d+(?:\.\d+)*)\/[^/]*$/) || [, "0"])[1]
const parseSchema = async (schemaUri, slugBase) => {
    if (schemaUri.startsWith("urn:")) {
        const parts = schemaUri.split(":")
        const [name, version] = parts[parts.length - 1].split("_")
        return {
            schemaSlug: `${name}-${version}`.replace(/[._]/g, "-"),
            schemaVersion: version,
            schemaPublisher: parts[2],
            schemaLabel: `${(await xoevName(schemaUri)) || name} ${version}`,
            xrepoUrl: XREPOSITORY_DETAILS + schemaUri,
        }
    }
    const version = versionOf(schemaUri)
    const { title, fields } = await jsonSchema(schemaUri)
    return {
        schemaSlug: `${slugBase}-${version}`.replace(/\./g, "-"),
        ...(version !== "0" ? { schemaVersion: version } : {}),
        ...(title ? { schemaLabel: title } : {}),
        ...(fields.length ? { fields } : {}),
    }
}

const getJson = async url => {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return res.json()
}

// pick the ONE Fachdatenschema to model for a service: prefer the highest version that actually
// resolves to a real schema. govOS/THAVEL advertises schema versions that 404, so probe down from
// the newest; URN (XÖV) schemas always resolve in XRepository. Returns the chosen submissionSchema.
const verDesc = (a, b) => {
    const pa = versionOf(a.schemaUri).split(".").map(Number), pb = versionOf(b.schemaUri).split(".").map(Number)
    for (let i = 0; i < Math.max(pa.length, pb.length); i++)
        if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0)
    return 0
}
const pickSchema = async schemas => {
    const sorted = [...schemas].sort(verDesc)
    for (const sc of sorted) {
        if (sc.schemaUri.startsWith("urn:")) return sc
        const { title, fields } = await jsonSchema(sc.schemaUri)
        if (title || fields.length) return sc            // a real schema, not a 404 / error envelope
    }
    return sorted[0] || null
}

// read a destination and flatten its publicServices to one record per Leistung (the chosen
// Fachdatenschema). A service is keyed by its 14-digit LeiKa where it has one; a govOS/THAVEL
// service has none, so it is keyed by its vendor id (e.g. s16000413) — modelled with no
// fim:leikaId (it sits outside the federal join) and named from its schema title.
const fetchDestination = async ({ id, note }) => {
    const sourceUrl = `${SUBMISSION}/destinations/${id}`
    const dest = await getJson(sourceUrl)
    fs.writeFileSync(path.join(RESPONSES_DIR, `${id}.json`), JSON.stringify(dest, null, 2) + "\n")  // raw
    const records = []
    for (const service of dest.publicServices ?? []) {
        const leika = leikaOf(service.identifier)
        const govosKey = leika ? null : (service.identifier.match(/[^:]+$/) || [])[0]   // e.g. s16000413
        const slugBase = leika || govosKey
        if (!slugBase) continue
        const schema = await pickSchema(service.submissionSchemas ?? [])
        if (!schema) continue
        const parsed = await parseSchema(schema.schemaUri, slugBase)
        records.push({
            destinationId: id,
            status: dest.status,
            leistungSlug: leika ? `leika-${leika}` : `govos-${govosKey}`,
            ...(leika ? { leika } : { govosIdentifier: service.identifier }),
            // a LeiKa hub gets its name from the FIM Steckbrief layer; a govOS service has no LeiKa,
            // so it takes its name from the schema title here
            ...(!leika && parsed.schemaLabel ? { leistungTitle: parsed.schemaLabel } : {}),
            regionKey: regionKey((service.regions ?? [])[0]),
            schemaUri: schema.schemaUri,
            mimeType: schema.mimeType,
            sourceUrl,
            retrievedAt: today,
            ...(FORMAT_TILE[schema.mimeType] ? { formatTileSlug: FORMAT_TILE[schema.mimeType] } : {}),
            ...parsed,
        })
    }
    console.log(`  ${id}  status=${dest.status}  ${records.length} Leistung(en)  (${note})`)
    return records
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

// 1. read the destinations from live FIT-Connect (anonymous)
console.log(`reading ${DESTINATIONS.length} Zustellpunkt(e) from ${SUBMISSION}`)
const records = (await Promise.all(DESTINATIONS.map(fetchDestination))).flat()

// 2. lift the flattened records to raw Facade-X with SPARQL Anything
await ensureJar()
fs.writeFileSync(COMBINED, JSON.stringify(records))
execFileSync("java", ["-jar", JAR, "-q", LIFT_SPARQL,
    "-v", `location=${COMBINED}`, "-v", "mediatype=application/json", "-f", "TTL", "-o", RAW], { stdio: ["ignore", "ignore", "inherit"] })

// 3. transform Facade-X → the FIT-Connect / Fachdatenschema shape (CONSTRUCT queries, in order)
const raw = storeFromTurtles([fs.readFileSync(RAW, "utf8")])
const store = newStore()
const transformDir = path.join(SQL_DIR, "transform")
for (const f of fs.readdirSync(transformDir).filter(f => f.endsWith(".sparql")).sort()) {
    await sparqlConstruct(fs.readFileSync(path.join(transformDir, f), "utf8"), [raw], store)
}

const header =
    "# FIT-Connect Zustellpunkte + the Fachdatenschema each Leistung's submission must conform to,\n" +
    "# read anonymously from the FIT-Connect Submission API. Generated by\n" +
    "# src/2-enrich-kg/fit-connect/fetch.js from the destination reads — not hand-edited.\n" +
    `# Each Zustellpunkt carries its exact dct:source URL + dct:date. Retrieved ${today}.\n\n`
fs.writeFileSync(OUT_TTL, header + await storeToTurtle(store, PREFIXES))
console.log(`OK: ${records.length} record(s) -> ${store.size} triples -> ${path.relative(ENRICH_KG, OUT_TTL)}`)
