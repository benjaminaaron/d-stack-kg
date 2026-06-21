// Use-case page: the IT-Planungsrat Beschlusslage as a queryable graph (authored/
// beschlusslage.authored.ttl). Three views over the transcribed decisions: how the seven
// Standardbereiche cover (or miss) the Landkarte, the five Basisdienste with their financing,
// and a cross-layer Betroffenheit ("change X, see who's hit"). Every official fact is
// dct:source'd to a dated dstack:Beschluss; each view hands you its exact SPARQL.

import { useCase, esc, $ } from "./use-case.js"

const PRE = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX schema: <http://schema.org/>
PREFIX cpsv: <http://purl.org/vocab/cpsv#>
PREFIX m8g: <http://data.europa.eu/m8g/>
PREFIX archimate: <https://purl.org/archimate#>
PREFIX ds: <https://deutschland-stack.gov.de/id/>
PREFIX dstack: <https://deutschland-stack.gov.de/vocab#>
PREFIX mus: <https://example.org/musterstadt#>`

const { select, queryLink, runLink, renderGallery } = useCase(PRE)

// --- 1) Standards-Deckung: each Standardbereich, its named standards split into tiles
//        present in the Landkarte vs. named-but-not-tiled (the OWL/SPARQL/SKOS gap), plus
//        the open Festlegungsbedarfe. The bucketing is anchored on the Standardbereich
//        (dstack:nenntStandard), the parallel official classification over the same elements.
const STANDARDS_Q = `# Pro Standardbereich, alles aus dem Graphen: die benannten Standards (als Landkarte-Kachel
# vorhanden, mit Deep-Link via dstack:landkarteItemId, oder benannt ohne Kachel) UND die offenen
# Festlegungsbedarfe (wörtlich aus dem Beschluss). ?typ trennt beides.
SELECT ?bereich ?typ ?wert ?imStack ?itemId WHERE {
    ?area a dstack:Standardbereich ; skos:prefLabel ?bereich .
    {
        ?area dstack:nenntStandard ?std .
        OPTIONAL { ?std skos:prefLabel ?pl }   # Kachel: skos:prefLabel
        OPTIONAL { ?std rdfs:label ?rl }        # referenzierter Standard: rdfs:label
        OPTIONAL { ?std dstack:landkarteItemId ?itemId }   # der offizielle Landkarte-Deep-Link
        BIND(COALESCE(?pl, ?rl) AS ?wert)
        BIND("standard" AS ?typ)
        BIND(EXISTS { ?std a dstack:StackElement } AS ?imStack)
    } UNION {
        ?area dstack:festlegungsbedarf ?wert .
        BIND("festlegungsbedarf" AS ?typ)
    }
} ORDER BY ?bereich ?typ ?wert`

// a present tile is a chip linking gently into the official Tech-Stack Landkarte (its deep-link id
// lives in the graph as dstack:landkarteItemId); a named-but-untiled standard is a dashed "ghost" chip
const LANDKARTE = "https://technologie.deutschland-stack.gov.de/?item="
const tileChip = (label, itemId) => itemId
    ? `<a class="bl-chip" href="${LANDKARTE}${itemId}" target="_blank" rel="noopener">${esc(label)}</a>`
    : `<span class="bl-chip">${esc(label)}</span>`
const gapChip = (label) => `<span class="bl-chip gap">${esc(label)}</span>`

const renderCoverage = async () => {
    const rows = await select(STANDARDS_Q)
    const areas = new Map()   // bereich -> { bereich, tiles:Map(label->itemId), gaps:Set, fb:[] }
    const ensure = (b) => { if (!areas.has(b)) areas.set(b, { bereich: b, tiles: new Map(), gaps: new Set(), fb: [] }); return areas.get(b) }
    for (const r of rows) {
        const a = ensure(r.bereich)
        if (r.typ === "festlegungsbedarf") a.fb.push(r.wert)
        else if (r.imStack === "true") { if (!a.tiles.has(r.wert)) a.tiles.set(r.wert, r.itemId || "") }
        else a.gaps.add(r.wert)
    }

    const allTiles = new Set()
    for (const a of areas.values()) a.tiles.forEach((_, t) => allTiles.add(t))

    // lead with the area that has a named-but-not-tiled gap (Semantische Technologien),
    // then by how many tiles each covers
    const ordered = [...areas.values()].sort((a, b) =>
        (b.gaps.size > 0) - (a.gaps.size > 0) || b.tiles.size - a.tiles.size || a.bereich.localeCompare(b.bereich))

    // one compact block per area: tiles and gaps inline (comma-separated), Festlegungsbedarfe muted
    const blocks = ordered.map(a => {
        const tilesPart = a.tiles.size
            ? `<p class="bl-label">In der Landkarte</p><div class="bl-chips">${[...a.tiles].map(([l, id]) => tileChip(l, id)).join("")}</div>` : ""
        const gapsPart = a.gaps.size
            ? `<p class="bl-label">Benannt, nicht in der Landkarte</p><div class="bl-chips">${[...a.gaps].map(gapChip).join("")}</div>` : ""
        const fbPart = a.fb.length
            ? `<p class="bl-label">Offene Festlegungsbedarfe</p><ul class="bl-fb-list">${a.fb.map(f => `<li>${esc(f)}</li>`).join("")}</ul>` : ""
        return `<div class="reach-group"><p class="reach-head">${esc(a.bereich)}</p>${tilesPart}${gapsPart}${fbPart}</div>`
    }).join("")

    const summary = `<p class="answer-head">In den sieben Bereichen führt die Tech-Stack Landkarte bereits <b>${allTiles.size}</b> der benannten Standards als Kachel.</p>`
    const note = `<p class="bl-note muted">Im Detail je Bereich, live aus dem Graphen abgefragt.</p>`
    $("coverage").innerHTML = summary + note + runLink(STANDARDS_Q) + blocks
}

// --- 2) Plattformkern: the five Basisdienste with their realising product, who finances it
//        (schema:funder = Bund; absence is the queryable distinction) and the Anbindungspflicht.
const BD_Q = `# Die fünf Basisdienste mit Funktionsbaustein, realisierendem Produkt, Finanzierung
# (schema:funder, nur bei den vier Bund-finanzierten Produkten) und Anbindungspflicht (skos:scopeNote).
SELECT ?bd ?dienst ?funktionsbaustein ?produkt ?finanzierung ?pflicht WHERE {
    ?bd a dstack:Basisdienst ; skos:prefLabel ?dienst ; dstack:realisiertDurch ?p .
    ?p archimate:name ?produkt .
    OPTIONAL { ?bd skos:altLabel ?funktionsbaustein }
    OPTIONAL { ?bd skos:scopeNote ?pflicht }
    OPTIONAL { ?p schema:funder ?finanzierung }
} ORDER BY ?dienst ?produkt`

// the official portfolio order (Anlage Portfolio); Identität & Vertrauen leads
const BD_ORDER = ["Identität und Vertrauen", "Datenaustausch", "Datenabruf", "Zahlungsabwicklung", "Postfach"]

const renderBasisdienste = async () => {
    const rows = await select(BD_Q)
    const bd = new Map()   // dienst -> { funktionsbaustein, produkte:Set, finanziert:bool, pflicht }
    for (const r of rows) {
        if (!bd.has(r.dienst)) bd.set(r.dienst, { funktionsbaustein: r.funktionsbaustein || "", produkte: new Set(), finanziert: false, pflicht: r.pflicht || "" })
        const e = bd.get(r.dienst)
        e.produkte.add(r.produkt)
        if (r.finanzierung) e.finanziert = true
    }
    const ordered = [...bd.entries()].sort((a, b) => BD_ORDER.indexOf(a[0]) - BD_ORDER.indexOf(b[0]))
    const row = ([dienst, e]) => {
        const fin = e.finanziert
            ? `<span class="reach-src">Bund (BMDS)</span>`
            : `<span class="muted">nicht Bund-finanziert</span>`
        const pflicht = e.pflicht ? esc(e.pflicht) : "<span class='muted'>—</span>"
        return `<tr>
            <td><b>${esc(dienst)}</b><br><span class="muted">${esc(e.funktionsbaustein)}</span></td>
            <td>${[...e.produkte].map(esc).join(", ")}</td>
            <td>${fin}</td>
            <td class="alt">${pflicht}</td>
        </tr>`
    }
    const financed = ordered.filter(([, e]) => e.finanziert).length
    $("basisdienste").innerHTML = runLink(BD_Q) +
        `<p class="answer-head">Der Bund finanziert <b>${financed}</b> der <b>${ordered.length}</b> Basisdienste (Konzeption, Pflege, Entwicklung); die Länder verpflichten sich zur Anbindung.</p>
         <div class="uc-table-wrap"><table class="uc-table">
            <thead><tr><th>Basisdienst</th><th>Produkt</th><th>Finanzierung</th><th>Anbindungspflicht</th></tr></thead>
            <tbody>${ordered.map(row).join("")}</tbody></table></div>`
}

// --- 3) Betroffenheit: pick a Basisdienst or Standardbereich, see everything affected across
//        layers. The anchor resolves to a set of standards (a Basisdienst via its Produkt's
//        dct:conformsTo, a Standardbereich via dstack:nenntStandard); each standard's footprint
//        spans real services (PVOG), governed data schemas (FIT-Connect), municipal components
//        (Musterstadt) and planned capabilities (the Vorhaben).
const ANCHORS_Q = `SELECT ?iri ?label ?typ WHERE {
    { ?iri a dstack:Basisdienst ; skos:prefLabel ?label . BIND("Basisdienst" AS ?typ) }
    UNION
    { ?iri a dstack:Standardbereich ; skos:prefLabel ?label . BIND("Standardbereich" AS ?typ) }
} ORDER BY ?typ ?label`

// ONE query per dropdown choice. ?ebene tags each row: "Produkt" (what realises a Basisdienst),
// "Standard" (the standards the anchor rests on — Basisdienst via product→conformsTo, Standardbereich via
// nenntStandard), and the four footprint layers (everything hanging off those standards across the datasets).
const betroffenheitQ = (iri) => `# Was hängt an <${iri}>? Eine Abfrage: das realisierende Produkt, die Standards,
# auf denen der Auslöser beruht, und alles, was über diese Standards an vier Quell-Datensätzen hängt. ?ebene trennt es.
# Diese Abfrage macht bewusst recht viel auf einmal; für einen konkreten Zweck ließe sie sich gezielt kürzen.
SELECT DISTINCT ?ebene ?betroffen ?ueber ?imStack WHERE {
    {
        <${iri}> dstack:realisiertDurch ?p . ?p archimate:name ?betroffen .
        BIND("Produkt" AS ?ebene)
    } UNION {
        { <${iri}> dstack:realisiertDurch/dct:conformsTo ?el } UNION { <${iri}> dstack:nenntStandard ?el }
        OPTIONAL { ?el skos:prefLabel ?pl } OPTIONAL { ?el rdfs:label ?rl }
        BIND(COALESCE(?pl, ?rl) AS ?betroffen)
        BIND("Standard" AS ?ebene)
        BIND(EXISTS { ?el a dstack:StackElement } AS ?imStack)
    } UNION {
        { <${iri}> dstack:realisiertDurch/dct:conformsTo ?el } UNION { <${iri}> dstack:nenntStandard ?el }
        ?el skos:prefLabel ?ueber .
        {
            ?l a cpsv:PublicService ; dct:title ?betroffen ; m8g:hasChannel/dstack:realisiertDurch ?el .
            BIND("Verwaltungsleistung" AS ?ebene)
        } UNION {
            ?fds a dstack:Fachdatenschema ; dstack:serialisiertAls ?el ; rdfs:label ?betroffen .
            BIND("Fachdatenschema" AS ?ebene)
        } UNION {
            mus:it-landschaft dct:hasPart ?c . ?c archimate:name ?betroffen ; dct:conformsTo ?el .
            BIND("Kommunale Komponente" AS ?ebene)
        } UNION {
            ?cap dstack:kandidat ?el ; rdfs:label ?betroffen .
            BIND("Geplante Fähigkeit" AS ?ebene)
        }
    }
} ORDER BY ?ebene ?betroffen`

// status marks where a connection is our own rather than transcribed: the Leistung→Standard link is
// the assumed PVOG bridge; the Musterstadt landscape and its Vorhaben are fictional; FIT-Connect is observed
const EBENEN = [
    { key: "Verwaltungsleistung", one: "Verwaltungsleistung", many: "Verwaltungsleistungen", quelle: "PVOG", status: "angenommene Brücke" },
    { key: "Fachdatenschema", one: "Fachdatenschema", many: "Fachdatenschemata", quelle: "FIT-Connect", status: "" },
    { key: "Kommunale Komponente", one: "kommunale Komponente", many: "kommunale Komponenten", quelle: "Musterstadt", status: "fiktiv" },
    { key: "Geplante Fähigkeit", one: "geplante Fähigkeit", many: "geplante Fähigkeiten", quelle: "Musterstadt-Vorhaben", status: "fiktiv" },
]

let ANCHORS = []

const renderBetroffenheitControls = () => {
    const groups = new Map()
    for (const a of ANCHORS) { if (!groups.has(a.typ)) groups.set(a.typ, []); groups.get(a.typ).push(a) }
    $("betroffenheit-picker").innerHTML = [...groups.entries()].map(([typ, items]) =>
        `<optgroup label="${esc(typ)}">${items.map(a => `<option value="${esc(a.iri)}">${esc(a.label)}</option>`).join("")}</optgroup>`).join("")
    // default to Identität und Vertrauen (the politically live, deadline-bearing vertical)
    const def = ANCHORS.find(a => a.label === "Identität und Vertrauen") || ANCHORS[0]
    if (def) $("betroffenheit-picker").value = def.iri
    $("betroffenheit-picker").addEventListener("change", renderBetroffenheit)
}

const renderBetroffenheit = async () => {
    const iri = $("betroffenheit-picker").value
    const label = (ANCHORS.find(a => a.iri === iri) || {}).label || iri
    $("betroffenheit").innerHTML = `<p class="muted">Wird aus dem Graphen gerendert …</p>`
    const istBasisdienst = (ANCHORS.find(a => a.iri === iri) || {}).typ === "Basisdienst"
    const q = betroffenheitQ(iri)
    const rows = await select(q)

    // bucket the one result by ?ebene; each value is Map(betroffen -> { ueber, imStack })
    const byEbene = new Map()
    for (const r of rows) {
        if (!byEbene.has(r.ebene)) byEbene.set(r.ebene, new Map())
        byEbene.get(r.ebene).set(r.betroffen, { ueber: r.ueber, imStack: r.imStack })
    }

    // the "Standard" rows -> the "beruht auf" line; gaps get a "keine Kachel" marker, and a Basisdienst's
    // product→standard mapping is our own attribution (flagged "Zuordnung angenommen")
    const standards = [...(byEbene.get("Standard") || new Map())]
    const beruht = standards.map(([s, { imStack }]) => imStack === "true" ? esc(s) : `${esc(s)} <span class="reach-src">keine Kachel</span>`).join(", ")
    const zuordnung = istBasisdienst ? ` <span class="reach-src">Zuordnung angenommen</span>` : ""
    const beruhtLine = standards.length ? `<p class="bericht-intro">Beruht auf den Standards: ${beruht}.${zuordnung}</p>` : ""

    const present = EBENEN.filter(l => byEbene.get(l.key)?.size)
    if (!present.length) {
        // no footprint: name the realising product (the "Produkt" rows) and why nothing hangs off it
        const produkte = [...(byEbene.get("Produkt") || new Map()).keys()]
        const info = produkte.length
            ? `<p class="bericht-intro">Realisiert durch <b>${produkte.map(esc).join(", ")}</b>. Dieses Produkt ist im Graphen noch nicht mit Standards verknüpft, daher zeigt sich hier über die Ebenen hinweg (noch) keine Betroffenheit.</p>`
            : `<p class="muted">In den modellierten Beispieldaten hängt daran noch nichts Abfragbares (die Brücken decken nur einen kleinen Ausschnitt ab).</p>`
        $("betroffenheit").innerHTML = runLink(q) +
            `<p class="bericht-title">Ändert sich »${esc(label)}«</p>${beruhtLine}${info}`
        return
    }
    const sections = present.map(l => {
        const head = l.many.charAt(0).toUpperCase() + l.many.slice(1)
        const items = [...byEbene.get(l.key).entries()].map(([ziel, { ueber }]) =>
            `<li>${esc(ziel)} <span class="muted">· über ${esc(ueber)}</span></li>`).join("")
        return `<div class="reach-group">
            <p class="reach-head">${esc(head)} <span class="reach-src">Quelle: ${esc(l.quelle)}${l.status ? ` · ${esc(l.status)}` : ""}</span></p>
            <ul class="reach-list">${items}</ul>
        </div>`
    }).join("")
    $("betroffenheit").innerHTML = runLink(q) +
        `<p class="bericht-title">Ändert sich »${esc(label)}«, sind betroffen:</p>
         ${beruhtLine}
         ${sections}`
}

// --- 4) further questions the governance layer unlocks (links to the Query page) ----
const GALLERY = [
    {
        q: "Welche Standards macht der Beschluss verbindlich, ohne dass die Landkarte sie führt?",
        sparql: `SELECT DISTINCT ?standard ?bereich WHERE {
    ?area a dstack:Standardbereich ;
        skos:prefLabel ?bereich ;
        dstack:nenntStandard ?std .
    ?std dstack:inLandkarte false ;
        rdfs:label ?standard .
} ORDER BY ?standard`,
    },
    {
        q: "Über welchen gemeinsamen Standard hängen ein Standardbereich und ein Basisdienst zusammen?",
        sparql: `SELECT DISTINCT ?bereich ?standard ?basisdienst WHERE {
    ?area a dstack:Standardbereich ;
        skos:prefLabel ?bereich ;
        dstack:nenntStandard ?el .          # ein Standardbereich nennt einen Standard ...
    ?el skos:prefLabel ?standard .
    ?bd dstack:realisiertDurch ?p .
    ?p dct:conformsTo ?el .                 # ... auf den ein Basisdienst-Produkt baut
    ?bd skos:prefLabel ?basisdienst .
} ORDER BY ?bereich ?basisdienst`,
    },
    {
        q: "Welche Standards sind zugleich vom Beschluss benannt, in einem Basisdienst-Produkt umgesetzt und in einer realen Leistung im Einsatz?",
        sparql: `SELECT DISTINCT ?standard ?beschluss ?produkt ?leistung WHERE {
    ?el skos:prefLabel ?standard .
    ?area a dstack:Standardbereich ;
        dstack:nenntStandard ?el ;                              # vom Beschluss benannt ...
        dct:source ?b .
    ?b dct:title ?beschluss .                                   # ... aus diesem Beschluss
    ?bd dstack:realisiertDurch ?p .
    ?p dct:conformsTo ?el ;
        archimate:name ?produkt .                              # in diesem Basisdienst-Produkt umgesetzt
    ?l a cpsv:PublicService ;
        dct:title ?leistung ;
        m8g:hasChannel/dstack:realisiertDurch ?el .             # in dieser realen Leistung im Einsatz
} ORDER BY ?standard ?produkt ?leistung`,
    },
]

// --- boot -------------------------------------------------------------------
const init = async () => {
    await renderCoverage()
    await renderBasisdienste()
    ANCHORS = await select(ANCHORS_Q)
    renderBetroffenheitControls()
    await renderBetroffenheit()
    renderGallery("gallery", GALLERY)
}
init().catch(e => { $("coverage").innerHTML = `<p class="muted">Der Graph konnte nicht geladen werden: ${esc(e.message || e)}</p>` })
