// Use-case page "Selbstauskunft": the graph gives an account of itself (its Annahmen & Lücken). Because graph.js
// loads each layer into its own named graph as well, provenance is queryable — GRAPH ?g { ... }
// reveals which Schicht a triple is from, and each Schicht carries its Herkunft (offiziell
// geliftet / transkribiert / verfasst / angenommen / fiktiv / Szenario). Three views: what the
// graph is made of by Herkunft; what a concrete answer actually rests on (every dependency edge,
// coloured by trust); and where the stack has gaps and tensions. Every claim hands you its SPARQL.

import { useCase, esc, $ } from "./use-case.js"

const PRE = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX m8g: <http://data.europa.eu/m8g/>
PREFIX archimate: <https://purl.org/archimate#>
PREFIX dstack: <https://deutschland-stack.gov.de/vocab#>`

const { select, queryLink, runLink, renderGallery } = useCase(PRE)

// most official to most invented — the order the section reads in
const HERKUNFT_ORDER = ["offiziell geliftet", "transkribiert", "verfasst", "angenommen", "fiktiv", "Szenario"]
const HERKUNFT_ERKLAERUNG = {
    "offiziell geliftet": "maschinell aus offiziellen Quellen übernommen",
    "transkribiert": "von Hand aus datierten Beschlüssen übertragen",
    "verfasst": "von Hand formuliert",
    "angenommen": "fachlich begründete Vermutung, keine belegte Tatsache",
    "fiktiv": "frei erfunden, um ein Konzept zu zeigen",
    "Szenario": "erfundenes Szenario auf echten Daten",
}
const ERFUNDEN = new Set(["angenommen", "fiktiv", "Szenario"])

// --- 1) Woraus besteht der Graph? Each Schicht (named graph) by its Herkunft, with its triple
//        count. The provenance lives in the meta the loader writes; GRAPH ?g joins it to content.
const HERKUNFT_Q = `# Aus welchen Schichten besteht der Graph? Pro benanntem Graphen (Schicht) seine Herkunft,
# sein Label und die Zahl seiner Triples. Möglich, weil jede Schicht zusätzlich als eigener
# benannter Graph geladen ist und sich selbst über dstack:herkunft beschreibt.
SELECT ?herkunft ?label (COUNT(*) AS ?triples) WHERE {
    GRAPH ?g { ?s ?p ?o } .
    ?g dstack:herkunft ?herkunft ;
        dstack:schichtLabel ?label .
} GROUP BY ?g ?herkunft ?label ORDER BY ?herkunft DESC(?triples)`

const renderHerkunft = async () => {
    const rows = await select(HERKUNFT_Q)
    const byH = new Map()   // herkunft -> { triples, schichten:[{label,triples}] }
    for (const r of rows) {
        if (!byH.has(r.herkunft)) byH.set(r.herkunft, { triples: 0, schichten: [] })
        const e = byH.get(r.herkunft)
        const t = Number(r.triples)
        e.triples += t
        e.schichten.push({ label: r.label, triples: t })
    }
    const gesamt = [...byH.values()].reduce((s, e) => s + e.triples, 0)
    const erfunden = [...byH.entries()].filter(([h]) => ERFUNDEN.has(h)).reduce((s, [, e]) => s + e.triples, 0)

    const ordered = HERKUNFT_ORDER.filter(h => byH.has(h))
    const blocks = ordered.map(h => {
        const e = byH.get(h)
        const erf = ERFUNDEN.has(h) ? " gap" : ""
        const items = e.schichten.map(s => `<li>${esc(s.label)} <span class="muted">· ${s.triples.toLocaleString("de-DE")} Triples</span></li>`).join("")
        return `<div class="reach-group">
            <p class="reach-head"><span class="bl-chip${erf}">${esc(h)}</span> <span class="reach-src">${esc(HERKUNFT_ERKLAERUNG[h] || "")}</span></p>
            <ul class="reach-list">${items}</ul>
        </div>`
    }).join("")

    const summary = `<p class="answer-head">Der Graph besteht aus <b>${rows.length}</b> Schichten mit zusammen <b>${gesamt.toLocaleString("de-DE")}</b> Triples. Die allermeisten sind offiziell geliftet; nur <b>${erfunden.toLocaleString("de-DE")}</b> stammen aus angenommenen, fiktiven oder szenariohaften Schichten, und genau die sind hier markiert.</p>`
    $("herkunft-out").innerHTML = summary + runLink(HERKUNFT_Q) + blocks

    // anchor the abstract intro with the live figure (falls back to its static text if this never runs)
    const anteil = $("intro-anteil")
    if (anteil) anteil.textContent = `(von ${gesamt.toLocaleString("de-DE")} Aussagen sind nur ${erfunden.toLocaleString("de-DE")} angenommen oder erfunden)`
}

// --- 2) Worauf ruht ein Standard wirklich? The graph names many standards, but how well each is
//        actually attested varies sharply. Pick one and see who relies on it (realisiertDurch /
//        nenntStandard / conformsTo / serialisiertAls / kandidat), each reliance coloured by the
//        Herkunft of the named graph it lives in. Some standards carry across every layer; many are
//        only named by the Beschluss, used by no real service. That variation is the whole point.
const RELIANCE = "?p IN (dstack:realisiertDurch, dstack:nenntStandard, dct:conformsTo, dstack:serialisiertAls, dstack:kandidat)"

const ANCHORS_Q = `# Standards (Landkarte-Kachel oder referenziert), auf die sich überhaupt etwas stützt, je mit der
# Zahl der Schichten (Herkünfte), die das tun. Sortiert: schichtübergreifend tragende zuerst.
SELECT ?std ?label ?arten ?gesamt WHERE {
    {
        SELECT ?std (COUNT(DISTINCT ?herkunft) AS ?arten) (COUNT(*) AS ?gesamt) WHERE {
            GRAPH ?g { ?s ?p ?std . FILTER(${RELIANCE}) }
            ?g dstack:herkunft ?herkunft .
        } GROUP BY ?std
    }
    ?std a ?typ . FILTER(?typ IN (dstack:StackElement, dstack:ReferenzierterStandard))
    OPTIONAL { ?std skos:prefLabel ?pl }
    OPTIONAL { ?std rdfs:label ?rl }
    BIND(COALESCE(?pl, ?rl) AS ?label)
} ORDER BY DESC(?arten) DESC(?gesamt) ?label`

// the reliance is shown as a focused node-link map (Cytoscape, lazy-loaded from the CDN so the lib
// only loads with this page). The neighbourhood query resolves each dependent to a readable label
// (Onlinedienste shown as their Leistung) and carries the Herkunft of its edge.
const CYTO_URL = "https://cdn.jsdelivr.net/npm/cytoscape@3.30.2/dist/cytoscape.min.js"
let cytoLoading
const loadCytoscape = () => {
    if (window.cytoscape) return Promise.resolve(window.cytoscape)
    if (cytoLoading) return cytoLoading
    cytoLoading = new Promise((resolve, reject) => {
        const s = document.createElement("script")
        s.src = CYTO_URL
        s.onload = () => resolve(window.cytoscape)
        s.onerror = () => { cytoLoading = undefined; reject(new Error("Cytoscape konnte nicht vom CDN geladen werden")) }
        document.head.append(s)
    })
    return cytoLoading
}

// herkunft -> colour; erfunden edges (angenommen/fiktiv/Szenario) are drawn dashed (see ERFUNDEN)
const MAP_COLOR = {
    "offiziell geliftet": "#2b8a9e", "transkribiert": "#6b46c1", "verfasst": "#2f855a",
    "angenommen": "#c05621", "fiktiv": "#718096", "Szenario": "#718096",
}
const mapColor = (h) => MAP_COLOR[h] || "#718096"
let cy = null

const nachbarschaftQ = (iri) => `# Die unmittelbare Abhängigkeits-Nachbarschaft eines Standards: alles, was direkt auf ihn verweist
# (realisiertDurch/nenntStandard/conformsTo/serialisiertAls/kandidat), je mit der Herkunft seiner Kante.
SELECT DISTINCT ?label ?herkunft ?art WHERE {
    { GRAPH ?g { ?od dstack:realisiertDurch <${iri}> } . ?g dstack:herkunft ?herkunft .
        ?l m8g:hasChannel ?od ; dct:title ?label . BIND("Leistung" AS ?art) }
    UNION { GRAPH ?g { ?area dstack:nenntStandard <${iri}> } . ?g dstack:herkunft ?herkunft .
        ?area skos:prefLabel ?label . BIND("Standardbereich" AS ?art) }
    UNION { GRAPH ?g { ?p dct:conformsTo <${iri}> } . ?g dstack:herkunft ?herkunft .
        OPTIONAL { ?p archimate:name ?an } OPTIONAL { ?p skos:prefLabel ?pl } OPTIONAL { ?p rdfs:label ?rl }
        BIND(COALESCE(?an, ?pl, ?rl) AS ?label) BIND("Produkt/Komponente" AS ?art) }
    UNION { GRAPH ?g { ?fds dstack:serialisiertAls <${iri}> } . ?g dstack:herkunft ?herkunft .
        ?fds rdfs:label ?label . BIND("Fachdatenschema" AS ?art) }
    UNION { GRAPH ?g { ?cap dstack:kandidat <${iri}> } . ?g dstack:herkunft ?herkunft .
        ?cap rdfs:label ?label . BIND("Fähigkeit" AS ?art) }
} ORDER BY ?herkunft ?label`

// the honest verdict, varying with which Herkünfte rely on the standard
const verdict = (has) => {
    if (has.has("angenommen"))
        return "Real genutzt, doch die tragende Verbindung dorthin ist geraten (die angenommene Brücke); belastbar ist das nur so weit wie diese Brücke."
    if (has.has("offiziell geliftet"))
        return "Direkt auf offiziell gelifteten Daten belegt (ein realer Dienst oder ein Fachdatenschema nutzt ihn)."
    if ([...has].every(h => ERFUNDEN.has(h)))
        return "Nur in erfundenen Schichten vorhanden (Musterstadt oder Chatbot-Szenario), nicht in den realen Daten."
    if (has.size === 1 && has.has("transkribiert"))
        return "Vom Beschluss benannt, aber von keinem realen Dienst genutzt: verbindlich auf dem Papier, in den Daten ungenutzt."
    if (has.has("transkribiert"))
        return "Vom Beschluss benannt und in einer erfundenen Schicht verwendet, aber von keinem realen Dienst."
    return "Über mehrere Schichten in Anspruch genommen."
}

let ANCHORS = []

const renderBeruhtControls = () => {
    const seen = new Set()
    ANCHORS = ANCHORS.filter(a => a.label && !seen.has(a.std) && seen.add(a.std))   // dedup (label lang variants / multi-type)
    $("beruht-picker").innerHTML = ANCHORS.map(a => {
        const n = Number(a.arten)
        return `<option value="${esc(a.std)}">${esc(a.label)} (${n} ${n === 1 ? "Schicht" : "Schichten"})</option>`
    }).join("")
    const def = ANCHORS.find(a => /open.?id/i.test(a.std)) || ANCHORS[0]
    if (def) $("beruht-picker").value = def.std
    $("beruht-picker").addEventListener("change", renderBeruht)
}

const renderBeruht = async () => {
    const iri = $("beruht-picker").value
    const label = (ANCHORS.find(a => a.std === iri) || {}).label || iri
    $("beruht-out").innerHTML = `<p class="muted">Wird aus dem Graphen gerendert …</p>`
    const q = nachbarschaftQ(iri)
    const rows = await select(q)
    const has = new Set(rows.map(r => r.herkunft))

    // the colour-coded tally is both the legend (which colour is which Herkunft) and the count
    const counts = {}
    rows.forEach(r => { counts[r.herkunft] = (counts[r.herkunft] || 0) + 1 })
    // legend, one Herkunft per line: coloured name (matches the map), edge count, and line style
    const legend = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([h, n]) =>
        `<li><b style="color:${mapColor(h)}">${esc(h)}</b> <span class="muted">· ${esc(n)} ${n === 1 ? "Kante" : "Kanten"} · ${ERFUNDEN.has(h) ? "gestrichelt" : "durchgezogen"}</span></li>`).join("")

    $("beruht-out").innerHTML = runLink(q) +
        `<p class="bericht-title">»${esc(label)}«</p>
         <p class="bericht-intro">${rows.length} ${rows.length === 1 ? "Abhängigkeit" : "Abhängigkeiten"} aus ${has.size} Schicht${has.size === 1 ? "" : "en"}. ${verdict(has)}</p>
         <ul class="dep-legend">${legend}</ul>
         <div id="dep-map" class="dep-map"></div>`

    // the map is a CDN-loaded layer on top of the (local) verdict + tally — degrade gracefully offline
    let cytoscape
    try { cytoscape = await loadCytoscape() }
    catch { $("dep-map").innerHTML = `<p class="muted" style="padding:1rem">Die Karte benötigt eine Internetverbindung; die Auswertung darüber stammt direkt aus dem Graphen.</p>`; return }

    // the standard in the centre, each dependent around it; edge colour = Herkunft, erfunden = dashed
    const elements = [{ data: { id: "c", label }, classes: "center" }]
    rows.forEach((r, i) => {
        elements.push({ data: { id: "n" + i, label: `${r.art}:\n${r.label || "?"}`, herk: r.herkunft } })
        elements.push({ data: { id: "e" + i, source: "n" + i, target: "c", herk: r.herkunft } })
    })
    if (cy) cy.destroy()
    cy = cytoscape({
        container: $("dep-map"),
        elements,
        style: [
            { selector: "node", style: {
                "label": "data(label)", "color": "#fff", "font-size": "10px", "text-wrap": "wrap",
                "text-max-width": "92px", "text-valign": "center", "text-halign": "center",
                "background-color": ele => mapColor(ele.data("herk")),
                "shape": "round-rectangle", "width": "label", "height": "label", "padding": "7px",
            } },
            { selector: "node.center", style: {
                "background-color": "#1a365d", "font-size": "12px", "font-weight": "bold", "text-max-width": "120px",
            } },
            { selector: "edge", style: {
                "width": 2, "curve-style": "bezier", "target-arrow-shape": "triangle",
                "line-color": ele => mapColor(ele.data("herk")),
                "target-arrow-color": ele => mapColor(ele.data("herk")),
                "line-style": ele => ERFUNDEN.has(ele.data("herk")) ? "dashed" : "solid",
            } },
        ],
        layout: { name: "concentric", concentric: n => n.hasClass("center") ? 10 : 1, levelWidth: () => 1, minNodeSpacing: 26, padding: 14 },
    })
}

// --- 3) Wo hat der Stack Lücken und Spannungen? Each finding is its own small query. ----------
const GAP_BESCHLOSSEN_Q = `# Standards, die ein Standardbereich laut Beschluss verbindlich nennt, die die
# Tech-Stack Landkarte aber nicht als Kachel führt (dstack:inLandkarte false); beschlossen, aber nicht kartiert.
SELECT DISTINCT ?standard ?bereich ?beschluss WHERE {
    ?area a dstack:Standardbereich ;
        skos:prefLabel ?bereich ;
        dstack:nenntStandard ?std ;
        dct:source ?b .
    ?std dstack:inLandkarte false ;
        rdfs:label ?standard .
    OPTIONAL { ?b dct:title ?beschluss }
} ORDER BY ?standard`

const GAP_FESTLEGUNG_Q = `# Welche Festlegungsbedarfe der Beschluss je Standardbereich noch offen lässt.
# Gezählt werden diese transkribierten Notizen, nicht Standards oder Landkarten-Kacheln.
SELECT ?bereich ?festlegungsbedarf WHERE {
    ?a a dstack:Standardbereich ;
        skos:prefLabel ?bereich ;
        dstack:festlegungsbedarf ?festlegungsbedarf .
} ORDER BY ?bereich ?festlegungsbedarf`

const GAP_BASISDIENST_Q = `# Basisdienste, deren realisierendes Produkt im Graphen an keinen Standard gebunden ist
# (kein dct:conformsTo): ein loser Knoten, dessen Betroffenheit sich noch nicht abfragen lässt.
SELECT ?bd ?produkt WHERE {
    ?b a dstack:Basisdienst ; skos:prefLabel ?bd ; dstack:realisiertDurch ?p .
    ?p archimate:name ?produkt .
    FILTER NOT EXISTS { ?p dct:conformsTo ?s }
} ORDER BY ?bd`

const GAP_HONESTY_Q = `# Explizit im Graphen vermerkte Ehrlichkeits-/Provenienznotizen (dct:provenance).
SELECT ?label ?note WHERE {
    ?s dct:provenance ?note .
    OPTIONAL { ?s rdfs:label ?label }
}`

const DANGLING_Q = `# Strukturcheck: läuft eine Referenz-Kante ins Leere, also auf einen ds:-Knoten, über den der Graph
# sonst nichts weiß? Erwartet wird 0. Die Referenz-Prädikate sind per VALUES gebunden, damit die Abfrage
# den Prädikat-Index nutzt statt alle Tripel zu durchlaufen (sonst spürbar langsam im Browser).
SELECT (COUNT(*) AS ?verwaisteVerweise) WHERE {
    VALUES ?pred { dstack:realisiertDurch dstack:nenntStandard dct:conformsTo dstack:serialisiertAls dstack:kandidat }
    ?s ?pred ?obj .
    FILTER(isIRI(?obj) && STRSTARTS(STR(?obj), "https://deutschland-stack.gov.de/id/"))
    FILTER NOT EXISTS { ?obj ?p2 ?o2 }
}`

const renderLuecken = async () => {
    // the four cheap findings first, so section 3 shows immediately
    const [beschlossen, festlegung, basisdienste, honesty] = await Promise.all(
        [GAP_BESCHLOSSEN_Q, GAP_FESTLEGUNG_Q, GAP_BASISDIENST_Q, GAP_HONESTY_Q].map(select))

    // (a) beschlossen aber nicht kartiert. When only one Bereich has this gap modelled (currently
    // Semantische Technologien), say so honestly rather than letting it read as an arbitrary spotlight.
    const bereiche = [...new Set(beschlossen.map(r => r.bereich))]
    const beschluss = (beschlossen[0] || {}).beschluss || ""
    const chips = beschlossen.map(r => `<span class="bl-chip gap">${esc(r.standard)}</span>`).join("")
    // the Beschluss defines "Semantische Technologien" broadly as a data area, so seemingly
    // non-semantic standards (SQL/ODBC/JDBC, ODF, PDF/UA) legitimately sit there — say so.
    const semTech = bereiche.length === 1 && /Semantische/.test(bereiche[0])
        ? " Der Beschluss fasst diesen Bereich weit als Datenbereich; daher stehen dort neben RDF/SPARQL/OWL/SKOS auch SQL, ODBC, JDBC und Formate wie ODF."
        : ""
    const nurEiner = bereiche.length === 1
        ? " Es ist der einzige Bereich, für den diese Spannung hier vollständig modelliert ist."
        : ""
    const aBlock = `<div class="reach-group">
        <p class="reach-head">Beschlossen, aber nicht in der Landkarte</p>
        <p class="bericht-intro"><b>${beschlossen.length}</b> Standards nennt der Beschluss${beschluss ? ` (${esc(beschluss)})` : ""} im Bereich ${bereiche.map(esc).join(", ")} verbindlich, doch die Tech-Stack Landkarte führt sie nicht als Kachel.${semTech}${nurEiner} Die Deckung aller Standardbereiche zeigt die <a href="beschlusslage.html">Beschlusslage</a>.</p>
        <div class="bl-chips">${chips}</div>
        ${runLink(GAP_BESCHLOSSEN_Q)}</div>`

    // (b) offene Festlegungsbedarfe
    const fbByBereich = new Map()
    for (const r of festlegung) {
        if (!fbByBereich.has(r.bereich)) fbByBereich.set(r.bereich, [])
        fbByBereich.get(r.bereich).push(r.festlegungsbedarf)
    }
    const fbRows = [...fbByBereich.entries()]
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "de"))
        .map(([bereich, punkte]) => `<tr>
            <td><b>${esc(bereich)}</b></td>
            <td><span class="bl-chip">${punkte.length} ${punkte.length === 1 ? "offener Punkt" : "offene Punkte"}</span>
                <ul class="reach-list">${punkte.map(p => `<li>${esc(p)}</li>`).join("")}</ul></td>
        </tr>`).join("")
    const bBlock = `<div class="reach-group">
        <p class="reach-head">Offene Festlegungsbedarfe</p>
        <p class="bericht-intro">Der Beschluss nennt <b>${festlegung.length}</b> offene Festlegungsbedarfe in <b>${fbByBereich.size}</b> Standardbereichen. Gezählt werden die im Graphen transkribierten Festlegungsbedarf-Notizen, nicht Standards oder Landkarten-Kacheln.</p>
        <div class="uc-table-wrap"><table class="uc-table">
            <thead><tr><th>Standardbereich</th><th>Offen</th></tr></thead>
            <tbody>${fbRows}</tbody>
        </table></div>
        ${runLink(GAP_FESTLEGUNG_Q)}</div>`

    // (c) lose Basisdienste
    const bdItems = basisdienste.map(r => `<li>${esc(r.bd)} <span class="muted">· ${esc(r.produkt)}</span></li>`).join("")
    const cBlock = `<div class="reach-group">
        <p class="reach-head">Basisdienste ohne Standard-Anbindung</p>
        <p class="bericht-intro"><b>${basisdienste.length}</b> der fünf Basisdienste sind über ein Produkt realisiert, das im Graphen noch an keinen Standard gebunden ist; an ihnen hängt darum (noch) keine abfragbare Betroffenheit.</p>
        <ul class="reach-list">${bdItems}</ul>
        ${runLink(GAP_BASISDIENST_Q)}</div>`

    // (d) selbst vermerkte Ehrlichkeitsnotizen
    const hItems = honesty.map(r => `<li>${r.label ? `<b>${esc(r.label)}</b>: ` : ""}${esc(r.note)}</li>`).join("")
    const dBlock = honesty.length ? `<div class="reach-group">
        <p class="reach-head">Vom Graphen selbst vermerkte Lücken</p>
        <p class="bericht-intro">Manche Lücke steht ausdrücklich als Notiz im Graphen, etwa wo eine Quelle dokumentiert, aber nicht regulär angebunden ist.</p>
        <ul class="reach-list">${hItems}</ul>
        ${runLink(GAP_HONESTY_Q)}</div>` : ""

    // render the four findings now; the structural check is the heaviest query, so it gets a
    // placeholder and is filled in when ready — never blocking section 3 or the rest of the page
    $("luecken-out").innerHTML = aBlock + bBlock + cBlock + dBlock +
        `<div id="strukturcheck" class="bl-note muted">Strukturcheck läuft …</div>`

    // (e) Strukturcheck: Referenzen ins Leere (appended once it returns)
    const dangling = await select(DANGLING_Q)
    const verwaist = (dangling[0] || {}).verwaisteVerweise ?? "0"
    const sc = $("strukturcheck")
    if (sc) sc.innerHTML = `Strukturcheck: <b>${esc(verwaist)}</b> Referenzen laufen ins Leere; jede Referenz-Kante zeigt auf einen Knoten, über den der Graph auch etwas weiß. Tiefere logische Widersprüche ließen sich erst mit OWL/SHACL prüfen (noch nicht im Einsatz). ${runLink(DANGLING_Q, "Strukturcheck ausführen")}`
}

// --- 4) further self-audit questions ----------------------------------------
const GALLERY = [
    {
        q: "Welche Aussagen stehen in mehr als einer Schicht (schichtübergreifende Übereinstimmung)?",
        sparql: `SELECT ?s ?p (COUNT(DISTINCT ?g) AS ?schichten) WHERE {
    GRAPH ?g { ?s ?p ?o }
} GROUP BY ?s ?p ?o HAVING (COUNT(DISTINCT ?g) > 1) ORDER BY DESC(?schichten)`,
    },
    {
        q: "Welche Leistungen ruhen laut der angenommenen Brücke auf welchem Standard (alle geratenen Kanten)?",
        sparql: `SELECT ?leistung ?standard WHERE {
    GRAPH ?g { ?od dstack:realisiertDurch ?std } .
    ?g dstack:herkunft "angenommen" .
    ?l m8g:hasChannel ?od ;
        dct:title ?leistung .
    ?std skos:prefLabel ?standard .
} ORDER BY ?leistung ?standard`,
    },
    {
        q: "Abhängigkeit: Welche Standards tragen die meisten realen Leistungen (über die angenommene Brücke)?",
        sparql: `SELECT ?standard (COUNT(DISTINCT ?l) AS ?leistungen) WHERE {
    ?l m8g:hasChannel/dstack:realisiertDurch ?std .
    ?std skos:prefLabel ?standard .
} GROUP BY ?standard ORDER BY DESC(?leistungen)`,
    },
    {
        q: "Wie viele Triples trägt jede Schicht, und woher stammt sie?",
        sparql: `SELECT ?datei ?herkunft (COUNT(*) AS ?triples) WHERE {
    GRAPH ?g { ?s ?p ?o } .
    ?g dstack:herkunft ?herkunft ;
        dstack:schichtDatei ?datei .
} GROUP BY ?g ?datei ?herkunft ORDER BY DESC(?triples)`,
    },
    {
        q: "Welche verbindlich beschlossenen Standards nutzt in den modellierten Daten kein realer Dienst?",
        sparql: `SELECT DISTINCT ?standard WHERE {
    ?area a dstack:Standardbereich ;
        dstack:nenntStandard ?std .
    OPTIONAL { ?std skos:prefLabel ?pl }
    OPTIONAL { ?std rdfs:label ?rl }
    BIND(COALESCE(?pl, ?rl) AS ?standard)
    FILTER NOT EXISTS { ?od dstack:realisiertDurch ?std }   # von keinem Onlinedienst genutzt
    FILTER NOT EXISTS { ?p dct:conformsTo ?std }            # von keinem Produkt umgesetzt
} ORDER BY ?standard`,
    },
]

// --- boot -------------------------------------------------------------------
// each section renders independently, so a slow query in one never blocks the others
const fail = (id) => (e) => { $(id).innerHTML = `<p class="muted">Konnte nicht geladen werden: ${esc(e.message || e)}</p>` }

const bootBeruht = async () => {
    ANCHORS = await select(ANCHORS_Q)
    renderBeruhtControls()
    await renderBeruht()
}

renderGallery("gallery", GALLERY)                 // static, instant
renderHerkunft().catch(fail("herkunft-out"))
bootBeruht().catch(fail("beruht-out"))
renderLuecken().catch(fail("luecken-out"))
