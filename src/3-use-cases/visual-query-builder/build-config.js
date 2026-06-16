/**
 * Use case · Query builder — generate the Sparnatural configuration
 *
 * Profiles the knowledge graph (data/2-enrich-kg/d-stack-kg.ttl) and emits the SHACL
 * config that drives the in-browser visual query builder: one NodeShape per class,
 * one property shape per predicate actually used on that class's instances, with the
 * widget chosen from the value type (string -> Search, number -> Number, IRI -> List).
 * Human labels come from the vocabulary (definitions/vocabulary.ttl); a small blocklist
 * drops build-support noise so the generator needs no hand-curation afterwards.
 *
 * Output: webapp/public/dstack.sparnatural.ttl (gitignored, regenerated on deploy).
 * Run: node src/3-use-cases/visual-query-builder/build-config.js  (reads the committed graph + vocabulary)
 */

import { ROOT, DSTACK_TTL } from "../../common/utils.js"
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

// prefixes for the emitted Turtle; "" is the config's own shape namespace
const PREFIXES = {
    sh: "http://www.w3.org/ns/shacl#",
    dash: "http://datashapes.org/dash#",
    rdf: RDF, rdfs: RDFS, xsd: XSD, owl: "http://www.w3.org/2002/07/owl#",
    core: "http://data.sparna.fr/ontologies/sparnatural-config-core#",
    skos: SKOS, dct: DCT, schema: SCHEMA, dstack: DSTACK,
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
    DSTACK + "landkartePosition", DSTACK + "landkarteLogoFile", DSTACK + "landkarteAnnotationKey",
    DSTACK + "element",
    SKOS + "inScheme", SKOS + "topConceptOf", SKOS + "hasTopConcept",
    DCT + "source", DCT + "date", RDFS + "seeAlso", RDFS + "comment",
])
// display labels for reused terms the vocabulary doesn't define as triples (it labels
// only the dstack: terms). Anything not here falls back to a humanized local name.
const EXTERNAL_LABELS = {
    [SKOS + "Concept"]: { en: "Category", de: "Kategorie" },
    [SKOS + "prefLabel"]: { en: "name", de: "Name" },
    [SKOS + "broader"]: { en: "broader", de: "Oberbegriff" },
    [DCT + "subject"]: { en: "category", de: "Kategorie" },
    [DCT + "description"]: { en: "description", de: "Beschreibung" },
    [SCHEMA + "version"]: { en: "version", de: "Version" },
    [SCHEMA + "url"]: { en: "homepage", de: "Webseite" },
}

const NUMERIC = new Set(["integer", "decimal", "double", "float", "long", "int", "short",
    "nonNegativeInteger", "positiveInteger", "nonPositiveInteger", "negativeInteger",
    "unsignedLong", "unsignedInt"].map(t => XSD + t))
const TEMPORAL = new Set([XSD + "date", XSD + "dateTime"])

// --- profile the graph with SPARQL -------------------------------------------

const graph = storeFromTurtles([fs.readFileSync(DSTACK_TTL, "utf8")])
const vocab = storeFromTurtles([fs.readFileSync(path.join(ROOT, "definitions", "vocabulary.ttl"), "utf8")])

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

// the property that names instances of a class (so its dropdown/results read well)
const labelProp = props => props.has(SKOS + "prefLabel") ? SKOS + "prefLabel"
    : props.has(RDFS + "label") ? RDFS + "label" : null

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
    "# GENERATED by src/3-use-cases/visual-query-builder/build-config.js — do not edit by hand.",
    "# Profiles data/2-enrich-kg/d-stack-kg.ttl; labels from definitions/vocabulary.ttl.",
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
