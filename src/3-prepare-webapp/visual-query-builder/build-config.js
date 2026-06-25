/**
 * Use case · Query builder — generate the Sparnatural configuration
 *
 * Profiles the full composed knowledge graph (the same layers graph.js loads: technical,
 * PVOG/FIM/FIT-Connect, the assumed bridge, the fictional Musterstadt landscape + chatbot
 * scenario, the comms layer, the Beschlusslage, the 115 First-Level-Support layer and the
 * openCode conformity scan) and emits the
 * SHACL config that drives the in-browser visual query builder:
 * one NodeShape per class,
 * one property shape per predicate actually used on that class's instances, with the
 * widget chosen from the value type (string -> Search, number -> Number, IRI -> List).
 * Human labels come from the vocabulary (authored/vocabulary.ttl); a small blocklist
 * drops build-support noise so the generator needs no hand-curation afterwards.
 *
 * Output: webapp/public/dstack.sparnatural.ttl (gitignored, regenerated on deploy).
 * Run: npm run query-builder:prepare  (reads the committed graph + vocabulary)
 */

import { ROOT, DSTACK_TTL, PVOG_LEISTUNGEN_TTL, FIM_LEISTUNGEN_TTL, FIT_CONNECT_TTL,
    PVOG_DSTACK_BRIDGE_TTL, MUSTERSTADT_LANDSCHAFT_TTL, MUSTERSTADT_CHATBOT_TTL, COMMS_TTL,
    BESCHLUSSLAGE_TTL, SUPPORT115_TTL, OPENCODE_KONFORMITAET_TTL, VOCABULARY_TTL } from "../../common/utils.js"
import { storeFromTurtles } from "@foerderfunke/sem-ops-utils/core"
import { queryEngine } from "@foerderfunke/sem-ops-utils/sparql"
import fs from "fs"
import path from "path"

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
const RDFS = "http://www.w3.org/2000/01/rdf-schema#"
const XSD = "http://www.w3.org/2001/XMLSchema#"
const SKOS = "http://www.w3.org/2004/02/skos/core#"
const SCHEMA = "http://schema.org/"
const DCT = "http://purl.org/dc/terms/"
const DSTACK = "https://deutschland-stack.gov.de/vocab#"
const CPSV = "http://purl.org/vocab/cpsv#"
const M8G = "http://data.europa.eu/m8g/"
const FIM = "https://deutschland-stack.gov.de/fim#"
const FITCONNECT = "https://deutschland-stack.gov.de/fit-connect#"
const ARCHIMATE = "https://purl.org/archimate#"
const DCAT = "http://www.w3.org/ns/dcat#"
const SH = "http://www.w3.org/ns/shacl#"

// prefixes for the emitted Turtle; "" is the config's own shape namespace
const PREFIXES = {
    sh: "http://www.w3.org/ns/shacl#",
    dash: "http://datashapes.org/dash#",
    rdf: RDF, rdfs: RDFS, xsd: XSD, owl: "http://www.w3.org/2002/07/owl#",
    core: "http://data.sparna.fr/ontologies/sparnatural-config-core#",
    skos: SKOS, dct: DCT, schema: SCHEMA, dstack: DSTACK,
    cpsv: CPSV, m8g: M8G, fim: FIM, fitconnect: FITCONNECT, archimate: ARCHIMATE, dcat: DCAT,
    "": "https://deutschland-stack.gov.de/sparnatural-config#",
}
const CONFIG_IRI = "https://deutschland-stack.gov.de/sparnatural-config"

// --- curation (the only manual knobs; everything else is derived) ------------

// classes never offered as queryable (badge subtypes of StackElement, the scheme node)
const BLOCK_CLASSES = new Set([
    DSTACK + "Standard", DSTACK + "Technologieprodukt", SKOS + "ConceptScheme",
])
// predicates never offered as facets: Landkarte projection facts, taxonomy plumbing,
// and the konformitaet inverse back-pointer
const BLOCK_PROPS = new Set([
    RDF + "type",
    DSTACK + "landkartePosition", DSTACK + "landkarteLogoFile", DSTACK + "landkarteAnnotationKey", DSTACK + "landkarteItemId",
    DSTACK + "element",
    SKOS + "inScheme", SKOS + "topConceptOf", SKOS + "hasTopConcept",
    DCT + "source", DCT + "date", RDFS + "seeAlso", RDFS + "comment",
])
// display labels for reused terms the vocabulary doesn't define as triples (it labels
// only the dstack: terms). Anything not here falls back to a humanized local name.
const EXTERNAL_LABELS = {
    [SKOS + "Concept"]: { en: "Category", de: "Kategorie" },
    [SKOS + "prefLabel"]: { en: "name", de: "Name" },
    [RDFS + "label"]: { en: "name", de: "Name" },
    [SKOS + "broader"]: { en: "broader", de: "Oberbegriff" },
    [SKOS + "notation"]: { en: "code", de: "Code" },
    [DCT + "subject"]: { en: "category", de: "Kategorie" },
    [DCT + "description"]: { en: "description", de: "Beschreibung" },
    [DCT + "title"]: { en: "name", de: "Name" },
    [DCT + "identifier"]: { en: "identifier", de: "Kennung" },
    [DCT + "language"]: { en: "language", de: "Sprache" },
    [DCT + "spatial"]: { en: "region (ARS)", de: "Region (ARS)" },
    [SCHEMA + "version"]: { en: "version", de: "Version" },
    [SCHEMA + "url"]: { en: "homepage", de: "Webseite" },
    [SCHEMA + "validFrom"]: { en: "valid from", de: "gültig ab" },
    [SCHEMA + "validThrough"]: { en: "valid through", de: "gültig bis" },
    // the communication layer (comms snippets + the per-Leistung report) reuses these
    [SCHEMA + "Report"]: { en: "Report", de: "Bericht" },
    [SCHEMA + "about"]: { en: "about (node)", de: "hängt an Knoten" },
    [SCHEMA + "headline"]: { en: "headline", de: "Schlagzeile" },
    [SCHEMA + "text"]: { en: "line template", de: "Zeilenvorlage" },
    [SCHEMA + "description"]: { en: "note", de: "Hinweis" },
    [SH + "order"]: { en: "order", de: "Reihenfolge" },
    [SH + "select"]: { en: "query", de: "Abfrage" },
    // the governance layer (Standardbereiche + Basisdienste): the reused terms it leans on
    // (the dstack: terms — Standardbereich, Basisdienst, nenntStandard, festlegungsbedarf — are labelled in vocabulary.ttl)
    [SCHEMA + "funder"]: { en: "funder", de: "Finanzierung" },
    [SKOS + "altLabel"]: { en: "alternative name", de: "alternative Bezeichnung" },
    [SKOS + "scopeNote"]: { en: "scope note", de: "Anwendungshinweis" },
    // the EU public-service layer (CPSV-AP / CCCEV m8g) — German labels for the builder
    [CPSV + "PublicService"]: { en: "Public service", de: "Verwaltungsleistung" },
    [CPSV + "Rule"]: { en: "Legal rule", de: "Rechtsgrundlage" },
    [CPSV + "follows"]: { en: "legal basis", de: "Rechtsgrundlage" },
    [M8G + "PublicOrganisation"]: { en: "Public organisation", de: "Zuständige Stelle" },
    [M8G + "hasCompetentAuthority"]: { en: "competent authority", de: "zuständige Stelle" },
    [M8G + "LifeEvent"]: { en: "Life event", de: "Lebenslage" },
    [M8G + "isGroupedBy"]: { en: "life event", de: "Lebenslage" },
    [M8G + "Channel"]: { en: "Online service", de: "Onlinedienst" },
    [M8G + "hasChannel"]: { en: "online service", de: "Onlinedienst" },
    [M8G + "Cost"]: { en: "Cost", de: "Kosten" },
    [M8G + "hasCost"]: { en: "cost", de: "Kosten" },
    // the IT-landscape layer: ArchiMate (the ontology) + DCAT, plus the dct: join predicates.
    // The fim:/fitconnect:/dstack: terms are labelled in vocabulary.ttl, so they need nothing here.
    [ARCHIMATE + "ApplicationComponent"]: { en: "Application component", de: "Anwendungskomponente" },
    [ARCHIMATE + "ApplicationService"]: { en: "Application service", de: "Anwendungsdienst" },
    [ARCHIMATE + "TechnologyService"]: { en: "Technology service", de: "Technologiedienst" },
    [ARCHIMATE + "SystemSoftware"]: { en: "System software", de: "Systemsoftware" },
    [ARCHIMATE + "Node"]: { en: "Node", de: "Infrastrukturknoten" },
    [ARCHIMATE + "WorkPackage"]: { en: "Project", de: "Vorhaben" },
    [ARCHIMATE + "Capability"]: { en: "Capability", de: "Fähigkeit" },
    [ARCHIMATE + "name"]: { en: "name", de: "Name" },
    [ARCHIMATE + "serving"]: { en: "serves", de: "bedient" },
    [DCAT + "Dataset"]: { en: "IT landscape", de: "IT-Landschaft" },
    [DCT + "conformsTo"]: { en: "conforms to", de: "konform zu" },
    [DCT + "hasPart"]: { en: "has component", de: "Komponente" },
    [DCT + "format"]: { en: "format", de: "Format" },
    [DCT + "publisher"]: { en: "publisher", de: "Herausgeber" },
    [DCT + "provenance"]: { en: "provenance", de: "Herkunft" },
    [DCT + "alternative"]: { en: "alternative name", de: "alternative Bezeichnung" },
    // the 115 First-Level-Support layer + the openCode conformity scan (scenario layers); the
    // dstack: terms they add (Abhaengigkeit, abgebildetAuf, betriebsstatus, …) are labelled in vocabulary.ttl
    [SCHEMA + "SoftwareSourceCode"]: { en: "Repository", de: "Repository" },
    [SCHEMA + "CreativeWork"]: { en: "Help resource", de: "Hilfe-Ressource" },
    [SCHEMA + "ContactPoint"]: { en: "Contact point", de: "Kontaktstelle" },
    [SCHEMA + "contactType"]: { en: "contact type", de: "Kontaktart" },
    [M8G + "Evidence"]: { en: "Evidence", de: "Nachweis" },
    [CPSV + "hasInput"]: { en: "required input", de: "erforderliche Unterlage" },
    [DCT + "type"]: { en: "type", de: "Art" },
    [SKOS + "hiddenLabel"]: { en: "hidden keyword", de: "Volksmund-Stichwort" },
    [SKOS + "closeMatch"]: { en: "close match", de: "enge Entsprechung" },
    [SKOS + "relatedMatch"]: { en: "related match", de: "verwandte Entsprechung" },
    [M8G + "value"]: { en: "value", de: "Betrag" },
    [M8G + "currency"]: { en: "currency", de: "Währung" },
}

const NUMERIC = new Set(["integer", "decimal", "double", "float", "long", "int", "short",
    "nonNegativeInteger", "positiveInteger", "nonPositiveInteger", "negativeInteger",
    "unsignedLong", "unsignedInt"].map(t => XSD + t))
const TEMPORAL = new Set([XSD + "date", XSD + "dateTime"])

// --- profile the graph with SPARQL -------------------------------------------

// profile the whole graph the Query page exposes (the same layers graph.js composes): the
// technical layer, the administrative layers (PVOG services, FIM Steckbriefe, FIT-Connect
// schemas, the assumed bridge), the fictional municipal IT landscape + its chatbot scenario,
// the comms layer (Textbausteine + Blickwinkel + the fachlich register), the Beschlusslage,
// the 115 First-Level-Support layer and the openCode conformity scan
const graph = storeFromTurtles([
    DSTACK_TTL, PVOG_LEISTUNGEN_TTL, FIM_LEISTUNGEN_TTL, FIT_CONNECT_TTL,
    PVOG_DSTACK_BRIDGE_TTL, MUSTERSTADT_LANDSCHAFT_TTL, MUSTERSTADT_CHATBOT_TTL, COMMS_TTL, BESCHLUSSLAGE_TTL,
    SUPPORT115_TTL, OPENCODE_KONFORMITAET_TTL,
].map(f => fs.readFileSync(f, "utf8")))
const vocab = storeFromTurtles([fs.readFileSync(VOCABULARY_TTL, "utf8")])

const select = async (query, store) => {
    const result = await queryEngine.query(query, { sources: [store] })
    const out = []
    for await (const b of await result.execute()) out.push(b)
    return out
}

// term -> { lang: label } from the vocabulary
const vocabLabels = new Map()
for (const b of await select(`SELECT ?t ?l WHERE { ?t <${RDFS}label> ?l }`, vocab)) {
    const t = b.get("t").value
    if (!vocabLabels.has(t)) vocabLabels.set(t, {})
    vocabLabels.get(t)[b.get("l").language || "en"] = b.get("l").value
}

// class -> instance count (drives ordering); excludes blocked classes
const classCount = new Map()
for (const b of await select(`SELECT ?c (COUNT(DISTINCT ?s) AS ?n) WHERE { ?s a ?c } GROUP BY ?c`, graph)) {
    if (!BLOCK_CLASSES.has(b.get("c").value)) classCount.set(b.get("c").value, Number(b.get("n").value))
}
const isClass = c => classCount.has(c)

// per (class, predicate): literal facets carry a datatype, object facets the range
// class(es). Two queries (literals / IRIs) keep each pattern simple and dodge a
// Comunica quirk where a filter inside OPTIONAL drops the IRI rows. ORDER BY makes
// the emitted config deterministic.
const LITERALS = `SELECT DISTINCT ?class ?prop (datatype(?o) AS ?datatype) WHERE {
    ?s a ?class ; ?prop ?o . FILTER(isLiteral(?o))
} ORDER BY ?class ?prop ?datatype`
const OBJECTS = `SELECT DISTINCT ?class ?prop ?range WHERE {
    ?s a ?class ; ?prop ?o . FILTER(isIRI(?o)) OPTIONAL { ?o a ?range }
} ORDER BY ?class ?prop ?range`

const profile = new Map() // class -> Map(prop -> { kind, datatype, ranges:Set })
const facet = (cls, prop, kind) => {
    if (!isClass(cls) || BLOCK_PROPS.has(prop)) return null
    if (!profile.has(cls)) profile.set(cls, new Map())
    const props = profile.get(cls)
    if (!props.has(prop)) props.set(prop, { kind, datatype: undefined, ranges: new Set() })
    return props.get(prop)
}
for (const b of await select(LITERALS, graph)) {
    const e = facet(b.get("class").value, b.get("prop").value, "lit")
    if (e && e.datatype === undefined) e.datatype = b.get("datatype")?.value
}
for (const b of await select(OBJECTS, graph)) {
    const e = facet(b.get("class").value, b.get("prop").value, "iri")
    if (e && b.get("range")) e.ranges.add(b.get("range").value)
}

// --- helpers -----------------------------------------------------------------

const local = iri => iri.split(/[#/]/).pop()
const toQname = iri => {
    let match = null
    for (const [pfx, ns] of Object.entries(PREFIXES)) {
        if (iri.startsWith(ns) && (!match || ns.length > match.ns.length)) match = { pfx, ns }
    }
    return match ? `${match.pfx}:${iri.slice(match.ns.length)}` : `<${iri}>`
}
const humanize = s => {
    const w = s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase()
    return w.charAt(0).toUpperCase() + w.slice(1)
}
// { lang: label, ... } from the vocabulary, else the external map, else a derived label
const labelFor = iri => vocabLabels.get(iri) || EXTERNAL_LABELS[iri] || { en: humanize(local(iri)) }
const titleEn = iri => labelFor(iri).en || local(iri)     // English heading for comments/logs
const labelTurtle = labels => Object.entries(labels)
    .map(([lang, v]) => `"${v.replace(/"/g, "\\\"")}"@${lang}`).join(", ")

// the property that names instances of a class (so its dropdown/results read well).
// dct:title covers the EU public-service layer (cpsv:PublicService, m8g:LifeEvent,
// m8g:Channel); archimate:name covers the IT-landscape components (which use neither
// skos:prefLabel nor dct:title), so their dropdowns show names and links into them stay selectable.
const labelProp = props => props.has(SKOS + "prefLabel") ? SKOS + "prefLabel"
    : props.has(RDFS + "label") ? RDFS + "label"
    : props.has(DCT + "title") ? DCT + "title"
    : props.has(ARCHIMATE + "name") ? ARCHIMATE + "name" : null

// widget + range/datatype for a profiled property, or null to skip it
const classify = e => {
    if (e.kind === "iri") {
        const range = [...e.ranges].find(isClass)        // must traverse to a modeled class
        if (!range) return null
        // a value picker only makes sense when the target carries labels; for label-less
        // nodes (the reified conformity assessments) the link is traversal-only, so the
        // dropdown would be empty — NonSelectableProperty drops the picker, keeps the hop
        const widget = labelProp(profile.get(range) || new Map()) ? "core:ListProperty" : "core:NonSelectableProperty"
        return { kind: "iri", widget, range }
    }
    const datatype = e.datatype || XSD + "string"
    if (NUMERIC.has(datatype)) return { kind: "lit", widget: "core:NumberProperty", datatype }
    if (TEMPORAL.has(datatype)) return { kind: "lit", widget: "core:TimeProperty-Date", datatype }
    return { kind: "lit", widget: "core:SearchProperty", datatype }
}

// --- assemble the queryable model --------------------------------------------

const rank = e => e.isLabel ? 0 : e.info.kind === "lit" ? 1 : 2     // label, then literals, then links
const built = []
for (const cls of classCount.keys()) {
    const props = profile.get(cls) || new Map()
    const lp = labelProp(props)
    const entries = []
    for (const [prop, e] of props) {
        const info = classify(e)
        if (info) entries.push({ prop, info, isLabel: prop === lp })
    }
    entries.sort((a, b) => rank(a) - rank(b))           // stable: ties keep the query's order
    built.push({ cls, entries })
}
// the entity with the most facets first; deterministic tie-breaks
built.sort((a, b) => b.entries.length - a.entries.length
    || classCount.get(b.cls) - classCount.get(a.cls)
    || a.cls.localeCompare(b.cls))

// --- emit Turtle -------------------------------------------------------------

const shapeName = cls => `:${local(cls)}`
const propName = (cls, prop) => `:${local(cls)}_${local(prop)}`

const classBlock = (b, order) => {
    const triples = [
        `sh:targetClass ${toQname(b.cls)}`,
        `sh:order "${order}"^^xsd:integer`,
        `rdfs:label ${labelTurtle(labelFor(b.cls))}`,
    ]
    if (b.entries.length) triples.push(`sh:property ${b.entries.map(e => propName(b.cls, e.prop)).join(", ")}`)
    return `${shapeName(b.cls)} a sh:NodeShape;\n    ${triples.join(";\n    ")}.`
}

const propBlock = (cls, entry, order) => {
    const { prop, info, isLabel } = entry
    const triples = [`sh:path ${toQname(prop)}`, `sh:order "${order}"^^xsd:integer`, `sh:name ${labelTurtle(labelFor(prop))}`]
    if (info.kind === "iri") triples.push("sh:nodeKind sh:IRI", `sh:class ${toQname(info.range)}`)
    else triples.push("sh:nodeKind sh:Literal", `sh:datatype ${toQname(info.datatype)}`)
    triples.push(`dash:searchWidget ${info.widget}`)
    if (isLabel) triples.push("dash:propertyRole dash:LabelRole")
    return `${propName(cls, prop)} ${triples.join(";\n    ")}.`
}

const lines = [
    "# GENERATED by src/3-prepare-webapp/visual-query-builder/build-config.js — do not edit by hand.",
    "# Profiles the full composed graph (all enrich layers + the authored landscape/scenario); labels from authored/vocabulary.ttl.",
    "# Drives the in-browser Sparnatural query builder on the webapp's Query page.",
    "",
    ...Object.entries(PREFIXES).map(([pfx, ns]) => `@prefix ${pfx}: <${ns}>.`),
    "",
    `<${CONFIG_IRI}> a owl:Ontology.`,
    "",
]
built.forEach((b, i) => {
    const title = titleEn(b.cls)
    lines.push(`# --- ${title} ${"-".repeat(Math.max(0, 70 - title.length))}`)
    lines.push(classBlock(b, i + 1), "")
    b.entries.forEach((e, j) => lines.push(propBlock(b.cls, e, j + 1), ""))
})

const OUT = path.join(ROOT, "webapp", "public", "dstack.sparnatural.ttl")
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, lines.join("\n"))

const propCount = built.reduce((n, b) => n + b.entries.length, 0)
console.log(`OK: ${built.length} classes, ${propCount} properties -> ${path.relative(ROOT, OUT)}`)
for (const b of built) console.log(`  ${titleEn(b.cls).padEnd(22)} ${b.entries.length} facets`)
