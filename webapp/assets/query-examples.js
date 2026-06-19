// Curated example queries for the Query page, aimed at someone getting a feel for
// what's in the graph and what they might ask of it. Each example is one of:
//   { name, sparql }  -> dropped into the editor and run
//   { name, visual }  -> opens the visual builder, pre-populated via loadQuery()
//
// The visual queries reference the SHACL *shape* IRIs emitted by
// src/3-prepare-webapp/visual-query-builder/build-config.js (e.g. :StackElement,
// :StackElement_subject). Keep them in sync if that script's shape naming changes.

const PREFIXES = `PREFIX dstack: <https://deutschland-stack.gov.de/vocab#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX schema: <http://schema.org/>
PREFIX cpsv: <http://purl.org/vocab/cpsv#>
PREFIX m8g: <http://data.europa.eu/m8g/>
PREFIX archimate: <https://purl.org/archimate#>
PREFIX mus: <https://example.org/musterstadt#>`

// Every sparql example interpolates the full PREFIXES block above; trimPrefixes then drops the
// PREFIX lines whose prefix never appears in the query body, so each example shows only what it uses.
const trimPrefixes = sparql => {
    const all = sparql.split("\n")
    const body = all.filter(l => !/^(# PREFIX lines|PREFIX )/.test(l)).join("\n").replace(/^\n+/, "")
    const kept = all.filter(l => {
        const m = l.match(/^PREFIX (\w+):/)
        return m && new RegExp(`\\b${m[1]}:`).test(body)
    })
    return `${kept.join("\n")}\n\n${body}`
}

// --- Sparnatural query-JSON builders (keep the nested literal readable) -------
const CONFIG = "https://deutschland-stack.gov.de/sparnatural-config#"
const shape = local => CONFIG + local
const variable = (value, rdfType) => ({ type: "term", subType: "variable", value, ...(rdfType && { rdfType }) })
const iri = value => ({ type: "term", subType: "namedNode", value })
const pair = (predicate, object) => ({ type: "predicateObjectPair", predicate: iri(predicate), object })
const selectQuery = (variables, subject, predicateObjectPairs) => ({
    type: "query", subType: "SELECT", distinct: true, variables,
    solutionModifiers: { limitOffset: { type: "solutionModifier", subType: "limitOffset", limit: 100 } },
    where: { type: "pattern", subType: "bgpSameSubject", subject, predicateObjectPairs },
})

// Build the query JSON from a linear traversal spec, one entry per class box:
//   { label, cls, via?, pick? }
//     label  display label of the class — drives the variable name
//     cls    its shape local name (StackElement, Concept, …)
//     via    shape local name of the property reaching it from the previous step
//     pick   include it as a result column
// The only Sparnatural-internal coupling is variable naming. A node's selected variable and
// its WHERE variable must be the same string or that result column comes back empty. The
// builder names the *root* after its class (the shape local name, e.g. "Concept"), and every
// *object* node i (1-based) after its display label, "<Pascal(label)>_i" (e.g. "Category_2").
// If a future Sparnatural names variables differently, this is the one knob to turn.
const pascal = label => label.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("")
const visualQuery = steps => {
    const nodes = steps.map((s, i) => ({ ...s, varName: i === 0 ? s.cls : `${pascal(s.label)}_${i + 1}` }))
    const objectAt = i => {
        const node = { type: "objectCriteria", variable: variable(nodes[i].varName, shape(nodes[i].cls)), filters: [] }
        if (i + 1 < nodes.length) node.predicateObjectPairs = [pair(shape(nodes[i + 1].via), objectAt(i + 1))]
        return node
    }
    return selectQuery(
        nodes.filter(n => n.pick).map(n => variable(n.varName)),
        variable(nodes[0].varName, shape(nodes[0].cls)),
        [pair(shape(nodes[1].via), objectAt(1))],
    )
}

const RAW_EXAMPLES = [
    {
        name: "Alle Stack-Elemente durchsuchen",
        sparql: `${PREFIXES}

# A browsable inventory of all 128 stack elements. The WHERE block is a shape
# every match must have; ";" reuses the subject ?el, "." ends the statement.
SELECT ?element ?category ?type ?version ?responsibleBody WHERE {
    ?el a dstack:StackElement ;                 # ?el = anything typed StackElement
        skos:prefLabel ?element ;               # its name
        dct:subject/skos:prefLabel ?category ;  # "/" follows a link to the category's name
        dstack:badge ?type ;                    # "Standard" or "Technologie"
        dstack:verantwortlicheStelle ?responsibleBody .
    OPTIONAL { ?el schema:version ?version }    # OPTIONAL keeps elements with no version
}
ORDER BY ?category ?element
# Tinker: add "LIMIT 10" to peek, or remove a line plus its ?var above to simplify.`,
    },
    {
        name: "Welche Kategorien enthalten die meisten Elemente?",
        sparql: `${PREFIXES}

# Count elements per category: GROUP BY collapses rows sharing a ?category,
# then COUNT tallies each group into ?elements.
SELECT ?category (COUNT(?el) AS ?elements) WHERE {
    ?el a dstack:StackElement ;
        dct:subject/skos:prefLabel ?category .
}
GROUP BY ?category
ORDER BY DESC(?elements)    # largest first; drop DESC() to flip the order`,
    },
    {
        name: "Standards vs. Technologien je Kategorie",
        sparql: `${PREFIXES}

# How each category splits between standards and technology products.
# SUM(IF(test, 1, 0)) is a counting trick: add 1 for each row that matches.
SELECT ?category
    (SUM(IF(STR(?type) = "Standard", 1, 0)) AS ?standards)
    (SUM(IF(STR(?type) = "Technologie", 1, 0)) AS ?technologies)
    (COUNT(?el) AS ?total)
WHERE {
    ?el a dstack:StackElement ;
        dct:subject/skos:prefLabel ?category ;
        dstack:badge ?type .            # the value the SUMs test
}
GROUP BY ?category
ORDER BY DESC(?total)
# Comes out all-standard (KI), all-technology (Browser), or mixed (Daten).`,
    },
    {
        name: "Wer ist für die meisten Elemente verantwortlich?",
        sparql: `${PREFIXES}

# Responsible bodies ranked by element count — the same GROUP BY / COUNT pattern
# as above, just grouped on the body instead of the category.
SELECT ?responsibleBody (COUNT(?el) AS ?elements) WHERE {
    ?el a dstack:StackElement ;
        dstack:verantwortlicheStelle ?responsibleBody .
}
GROUP BY ?responsibleBody
ORDER BY DESC(?elements)
# IETF leads by far; the long tail of single-element bodies shows how spread-out the stack is.`,
    },
    {
        name: "Welche Elemente erreichen die höchste digitale Souveränität?",
        sparql: `${PREFIXES}

# Each element is scored on six criteria, but the scores don't sit on the element
# directly — they live on separate assessment nodes (one per element + criterion).
# So we read through such a node (?a), then back to the element for its own fields.
SELECT ?element ?category ?type ?percent WHERE {
    ?a a dstack:Konformitaetsbewertung ;        # ?a = one assessment...
        dstack:element ?el ;                    # ...of this element
        dstack:kriterium/skos:prefLabel ?crit ; # ...on this criterion (by name)
        dstack:wertProzent ?percent .           # ...scored this %, 0-100
    ?el skos:prefLabel ?element ;
        dct:subject/skos:prefLabel ?category ;
        dstack:badge ?type .
    FILTER(STR(?crit) = "Souveränität")  # try "Interoperabilität", "Nachhaltigkeit", ...
    FILTER(?percent >= 80)                        # lower this to see more
}
ORDER BY DESC(?percent) ?element`,
    },
    {
        name: "Konformitäts-Steckbrief für OAuth",
        sparql: `${PREFIXES}

# The flip side of the previous query: one element, all six criteria — a handy
# way to see the assessment model up close.
SELECT ?criterion ?level ?percent WHERE {
    ?el a dstack:StackElement ;
        skos:prefLabel ?elLabel ;
        dstack:konformitaet ?a .            # follow the element to its assessments
    FILTER(STR(?elLabel) = "Open Authorization (OAuth)")   # swap for "Kubernetes", "PostgreSQL", ...
    ?a dstack:kriterium/skos:prefLabel ?criterion ;
        dstack:stufe ?level ;               # the "N von 5" rating, as a number
        dstack:wertProzent ?percent .       # and the percentage
}
ORDER BY ?criterion`,
    },
    {
        name: "Welche D-Stack-Elemente nutzt eine PVOG-Leistung?",
        sparql: `${PREFIXES}

# Über die administrative Ebene: jede Verwaltungsleistung (PVOG) mit den D-Stack-Elementen,
# auf denen ihr Onlinedienst aufbaut. Die Brücke dstack:realisiertDurch ist von Hand angenommen.
SELECT ?leistung ?element WHERE {
    ?l a cpsv:PublicService ;
        dct:title ?leistung ;
        m8g:hasChannel/dstack:realisiertDurch/skos:prefLabel ?element .
}
ORDER BY ?leistung ?element`,
    },
    {
        name: "Vom Gesetz zum Fachdatenschema (FIM & FIT-Connect)",
        sparql: `${PREFIXES}

# Die durchgehende Kette über die echte LeiKa-ID: jede Leistung mit ihrer Rechtsgrundlage
# (aus dem FIM-Steckbrief) und dem Fachdatenschema, dem ihre Einreichung genügt (FIT-Connect).
SELECT ?leistung ?gesetz ?fachdatenschema WHERE {
    ?l dct:title ?leistung ;
        cpsv:follows/dct:description ?gesetz ;       # die Rechtsgrundlage
        dct:conformsTo/rdfs:label ?fachdatenschema . # das Fachdatenschema
}
ORDER BY ?leistung`,
    },
    {
        name: "Musterstadts IT-Komponenten und ihre Standards",
        sparql: `${PREFIXES}

# Die fiktive kommunale IT-Landschaft: jede Komponente von "Stadt Musterstadt" und der
# Standard, dem sie folgt. Leeres ?standard = proprietäre Insellösung ohne offenen Standard.
SELECT ?komponente ?standard WHERE {
    mus:it-landschaft dct:hasPart ?c .
    ?c archimate:name ?komponente .
    OPTIONAL { ?c dct:conformsTo ?std . ?std (skos:prefLabel|rdfs:label) ?standard }
}
ORDER BY ?komponente`,
    },
    {
        name: "Elemente und ihre Kategorie",
        visual: visualQuery([
            { label: "Stack element", cls: "StackElement", pick: true },
            { label: "Category", cls: "Concept", via: "StackElement_subject", pick: true },
        ]),
    },
    {
        name: "Element-Konformität nach Kriterium",
        visual: visualQuery([
            { label: "Stack element", cls: "StackElement", pick: true },
            { label: "Conformity assessment", cls: "Konformitaetsbewertung", via: "StackElement_konformitaet" },
            { label: "Assessment criterion", cls: "Kriterium", via: "Konformitaetsbewertung_kriterium", pick: true },
        ]),
    },
    {
        name: "Kategorien und ihre übergeordnete Schicht",
        visual: visualQuery([
            { label: "Category", cls: "Concept", pick: true },
            { label: "Category", cls: "Concept", via: "Concept_broader", pick: true },
        ]),
    },
    {
        // four hops across three layers: PVOG service -> its online channel -> the (assumed) Stack
        // element it runs on -> that element's category
        name: "Von der Verwaltungsleistung bis zur Stack-Kategorie",
        visual: visualQuery([
            { label: "Public service", cls: "PublicService", pick: true },
            { label: "Online service", cls: "Channel", via: "PublicService_hasChannel" },
            { label: "Stack element", cls: "StackElement", via: "Channel_realisiertDurch" },
            { label: "Category", cls: "Concept", via: "StackElement_subject", pick: true },
        ]),
    },
    {
        // the municipal landscape into the taxonomy: component -> the Stack element it follows -> category
        name: "Von Musterstadts Komponente zur Stack-Kategorie",
        visual: visualQuery([
            { label: "Component", cls: "ApplicationComponent", pick: true },
            { label: "Stack element", cls: "StackElement", via: "ApplicationComponent_conformsTo" },
            { label: "Category", cls: "Concept", via: "StackElement_subject", pick: true },
        ]),
    },
    {
        // the planning layer: the chatbot project -> the capabilities it needs -> their candidate elements
        name: "Chatbot-Projekt: Fähigkeiten und Kandidaten-Elemente",
        visual: visualQuery([
            { label: "Project", cls: "WorkPackage", pick: true },
            { label: "Capability", cls: "Capability", via: "WorkPackage_benoetigt", pick: true },
            { label: "Stack element", cls: "StackElement", via: "Capability_kandidat", pick: true },
        ]),
    },
]

// trim each sparql example's prefix block to only the prefixes it uses; visual examples pass through
export const EXAMPLES = RAW_EXAMPLES.map(e => e.sparql ? { ...e, sparql: trimPrefixes(e.sparql) } : e)
