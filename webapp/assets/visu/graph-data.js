// Projects the composed RDF graph into a {nodes, links} model the force-graph can draw.
// Pure and side-effect-free (only imports the Turtle parser), so it runs the same in the
// browser (fed graph.js's LAYERS) and in a node smoke test (fed the .ttl files from disk).
//
// The graph is lopsided — 768 reified Konformitaetsbewertung + ~545 FIM Datenfelder/-gruppen
// would drown the ~180-node backbone — so projection is deliberately selective: it keeps only
// the structural relations that carry meaning between instances, resolves a German label per
// node, tags each node/link with the layer (Schicht) it came from, and lets the caller exclude
// noisy classes. Nodes carry their degree so the renderer can size and label the hubs.

import { parser } from "@foerderfunke/sem-ops-utils/core"

// the two namespaces that hold the graph's own instances; everything else (external vocab IRIs,
// dct:source URLs, the dcat-ap.de geocoding concepts) is not drawn as a node
const ID = "https://deutschland-stack.gov.de/id/"
const MUS = "https://example.org/musterstadt#"
const OC = "https://example.org/opencode#"   // the openCode conformance scenario (repos, deps, products)
// the comms Textbausteine (and report definitions) are authored under the vocab# namespace, not
// id/, yet they are graph instances we want to draw — so vocab# counts as an instance namespace too.
// (Class/property terms under vocab# only ever appear as rdf:type objects or predicates, both filtered.)
const VOCAB = "https://deutschland-stack.gov.de/vocab#"
export const isInstance = (iri) => iri.startsWith(ID) || iri.startsWith(MUS) || iri.startsWith(OC) || iri.startsWith(VOCAB)

// an IRI in prefixed (CURIE) form — shown on hover so nodes whose only label is a derived local
// name stay identifiable: ds: for instances, dstack: for the vocabulary, mus: for Musterstadt
const PREFIXES = [["ds:", ID], ["dstack:", VOCAB], ["mus:", MUS], ["oc:", OC]]
export const prefixIRI = (iri) => {
    for (const [pfx, ns] of PREFIXES) if (iri.startsWith(ns)) return pfx + iri.slice(ns.length)
    return iri
}

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"

// the predicates that form the structural graph (subject → object instance). An allow-list, so
// noise (rdfs:seeAlso to fimportal, schema:url, dct:spatial to geocoding, …) never becomes an edge.
const STRUCTURAL = new Set([
    "http://data.europa.eu/m8g/hasChannel",            // Leistung → Onlinedienst
    "http://data.europa.eu/m8g/hasCompetentAuthority", // Leistung → Behörde
    "http://data.europa.eu/m8g/isGroupedBy",           // Leistung → Lebenslage
    "http://data.europa.eu/m8g/hasInput",              // Leistung → Nachweis
    "https://deutschland-stack.gov.de/vocab#realisiertDurch", // Onlinedienst/Basisdienst → Technik
    "https://deutschland-stack.gov.de/vocab#nenntStandard",   // Standardbereich → Standard
    "https://deutschland-stack.gov.de/vocab#abgebildetAuf",   // Abhängigkeit → D-Stack-Element/Produkt/Standard
    "https://deutschland-stack.gov.de/vocab#serialisiertAls", // Fachdatenschema → Format
    "https://deutschland-stack.gov.de/vocab#kandidat",        // Fähigkeit → Kandidat
    "https://deutschland-stack.gov.de/vocab#benoetigt",       // Vorhaben → Fähigkeit
    "http://purl.org/dc/terms/conformsTo",             // Komponente/Produkt → Standard
    "http://purl.org/dc/terms/source",                 // Knoten → Beschluss (internal only; URLs filtered)
    "http://purl.org/dc/terms/hasPart",                // IT-Landschaft → Komponenten
    "http://purl.org/dc/terms/subject",                // StackElement → Gruppe (Landkarte-Taxonomie)
    "http://www.w3.org/2004/02/skos/core#broader",     // Gruppe → Schicht
    "http://www.w3.org/2004/02/skos/core#topConceptOf",// Schicht → Landkarte (Schema) — joins the Schicht-Bäume zu einem Baum
    "https://deutschland-stack.gov.de/fit-connect#zustellpunkt", // Leistung → Zustellpunkt
    "https://deutschland-stack.gov.de/fim#datenfeld",  // Schema/Gruppe → Datenfeld(gruppe)
    "https://purl.org/archimate#serving",              // Dienst → bedient Komponente
    "http://purl.org/vocab/cpsv#follows",              // Leistung → Rechtsgrundlage
    "http://schema.org/about",                         // Textbaustein → Anker
])

// label predicates in descending priority; the German (or fachlich) value wins within a predicate
const LABEL_PREDS = [
    "http://www.w3.org/2004/02/skos/core#prefLabel",
    "http://purl.org/dc/terms/title",
    "https://purl.org/archimate#name",
    "http://www.w3.org/2000/01/rdf-schema#label",
    "http://schema.org/headline",
    "http://schema.org/name",
]

// each layer (Schicht) gets a colour and a short German label; the four "erfundenen" layers
// (assumed/fictional/scenario) are flagged so the renderer can mark them as not-asserted
export const LAYER_META = {
    "tech-stack":   { color: "#33a7bd", label: "Tech-Stack Landkarte" },
    "pvog":         { color: "#4d8bf0", label: "Verwaltungsleistungen (PVOG)" },
    "fim":          { color: "#ec4899", label: "FIM-Datenfelder" },
    "fit-connect":  { color: "#f5a524", label: "FIT-Connect" },
    "beschlusslage":{ color: "#9d6bf0", label: "Beschlusslage (IT-Planungsrat)" },
    "comms":        { color: "#22c39a", label: "Kommunikation" },
    "bridge":       { color: "#ef4444", label: "Brücke Technik ↔ Verwaltung" },
    "musterstadt":  { color: "#7b8aa0", label: "Kommunale IT, Musterstadt" },
    "chatbot":      { color: "#b89cf5", label: "Chatbot-Szenario (Musterstadt)" },
    "support115":   { color: "#fb7a3c", label: "115 First-Level-Support" },
    "konformitaet": { color: "#c9a227", label: "openCode-Konformität" },
}
export const ERFUNDEN_LAYERS = new Set(["bridge", "musterstadt", "chatbot", "support115", "konformitaet"])
export const layerColor = (key) => LAYER_META[key]?.color || "#8a93a0"

// the six Herkunft (provenance) classes, most official to most invented — the alternative colouring,
// matching the Selbstauskunft page. ERFUNDEN_HERKUNFT marks the three that are not asserted fact.
export const HERKUNFT_META = {
    "offiziell geliftet": { color: "#2b8a9e", label: "offiziell geliftet" },
    "transkribiert":      { color: "#6b46c1", label: "transkribiert" },
    "verfasst":           { color: "#2f855a", label: "verfasst" },
    "angenommen":         { color: "#c05621", label: "angenommen" },
    "fiktiv":             { color: "#718096", label: "fiktiv" },
    "Szenario":           { color: "#9aa0aa", label: "Szenario" },
}
export const ERFUNDEN_HERKUNFT = new Set(["angenommen", "fiktiv", "Szenario"])
export const herkunftColor = (h) => HERKUNFT_META[h]?.color || "#8a93a0"

// a readable fallback label from an IRI's local name ("open-id-connect" → "open id connect")
const localName = (iri) => {
    const tail = iri.replace(/[#/]+$/, "").split(/[#/]/).pop()
    return decodeURIComponent(tail).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
}

// projectGraph(layers, opts) → { nodes, links }
//   layers: [{ key, herkunft, label, ttl }]   (graph.js's LAYERS shape)
//   opts.onlyLayers:   array of layer keys to include (default: all)
//   opts.excludeTypes: array of class local-names to drop (e.g. "Konformitaetsbewertung")
export function projectGraph(layers, opts = {}) {
    const onlyLayers = opts.onlyLayers ? new Set(opts.onlyLayers) : null
    const excludeTypes = new Set(opts.excludeTypes || [])

    const nodes = new Map()   // iri → node
    const rawLinks = []       // collected first, filtered after drops are known

    const ensure = (iri, layerKey, herkunft) => {
        let n = nodes.get(iri)
        if (!n) {
            n = { id: iri, label: null, layer: layerKey, herkunft, types: new Set(), degree: 0, _typed: false, _labelScore: Infinity }
            nodes.set(iri, n)
        }
        return n
    }

    for (const L of layers) {
        if (onlyLayers && !onlyLayers.has(L.key)) continue
        let quads
        try { quads = parser.parse(L.ttl) } catch (e) { console.warn(`projectGraph: Schicht „${L.key}" konnte nicht geparst werden, wird übersprungen`, e); continue }
        for (const q of quads) {
            const s = q.subject.value
            if (!isInstance(s)) continue
            const p = q.predicate.value
            const o = q.object

            if (p === RDF_TYPE) {
                const n = ensure(s, L.key, L.herkunft)
                n.types.add(o.value)
                if (!n._typed) { n.layer = L.key; n.herkunft = L.herkunft; n._typed = true } // home layer = where typed
                continue
            }
            if (LABEL_PREDS.includes(p) && o.termType === "Literal") {
                const n = ensure(s, L.key, L.herkunft)
                const lang = o.language || ""
                // lower is better: predicate priority dominates, German beats untagged beats English
                const score = LABEL_PREDS.indexOf(p) * 10 + (lang.startsWith("de") ? 0 : lang === "" ? 1 : 5)
                if (score < n._labelScore) { n.label = o.value; n._labelScore = score }
                continue
            }
            if (STRUCTURAL.has(p) && o.termType === "NamedNode" && isInstance(o.value)) {
                ensure(s, L.key, L.herkunft)
                ensure(o.value, L.key, L.herkunft)
                rawLinks.push({ source: s, target: o.value, predicate: p, layer: L.key, herkunft: L.herkunft })
            }
        }
    }

    // drop nodes whose type is excluded (e.g. the 768 Konformitaetsbewertung, the FIM Datenfelder)
    const dropped = new Set()
    for (const [iri, n] of nodes) {
        if ([...n.types].some(t => excludeTypes.has(localName(t)))) { dropped.add(iri); nodes.delete(iri) }
    }

    for (const n of nodes.values()) if (!n.label) n.label = localName(n.id)

    const seen = new Set()
    const links = []
    for (const l of rawLinks) {
        if (!nodes.has(l.source) || !nodes.has(l.target)) continue        // an endpoint was dropped
        const k = `${l.source}|${l.predicate}|${l.target}`
        if (seen.has(k)) continue
        seen.add(k)
        l.crossLayer = nodes.get(l.source).layer !== nodes.get(l.target).layer   // joins two Schichten = the thesis
        links.push(l)
        nodes.get(l.source).degree++
        nodes.get(l.target).degree++
    }

    return {
        nodes: [...nodes.values()].map(({ id, label, layer, herkunft, types, degree }) =>
            ({ id, label, layer, herkunft, types: [...types].map(localName), degree })),
        links,
    }
}
