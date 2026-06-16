// Use-case page: which public services use which D-Stack elements, what the elements'
// Landkarte conformity scores imply for the services, and a few cross-cutting questions
// the join unlocks. The bridge links are ASSUMED — no register records what a service is
// built on, and that gap is the point. The three graph layers (technical + services + the
// assumed bridge) load into one in-browser Comunica store; every query runs live, and the
// answers hand you the exact SPARQL to run yourself on the Query page.

import { graphStore } from "./graph.js"
import { queryEngine } from "@foerderfunke/sem-ops-utils/sparql"

const store = graphStore()

const PRE = `PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX schema: <http://schema.org/>
PREFIX cpsv: <http://purl.org/vocab/cpsv#>
PREFIX m8g: <http://data.europa.eu/m8g/>
PREFIX ds: <https://deutschland-stack.gov.de/id/>
PREFIX dstack: <https://deutschland-stack.gov.de/vocab#>`

const select = async (query) => {
    const result = await queryEngine.query(PRE + query, { sources: [store] })
    const rows = []
    for await (const b of await result.execute()) {
        const row = {}
        for (const [k, v] of b) row[k.value] = v.value
        rows.push(row)
    }
    return rows
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
const short = (label) => (label.match(/\(([^)]+)\)\s*$/) || [, label])[1]   // "… (TLS)" -> "TLS"
const $ = (id) => document.getElementById(id)
const queryLink = (q) => "../query.html?query=" + encodeURIComponent(PRE + "\n\n" + q)

let CRITERIA = []   // the six Konformität criteria, loaded from the graph (dstack:Kriterium)
const GESAMT = "Gesamt (Ø aller sechs)"

const loadCriteria = async () => {
    const rows = await select(`SELECT ?label WHERE {
        ?k a dstack:Kriterium ;
            skos:prefLabel ?label .
    } ORDER BY ?label`)
    CRITERIA = rows.map(r => r.label)
}

// --- 1) element picker -> services that use it -------------------------------
let elements = []
let totalServices = 0   // distinct bridged services — the denominator in "x von N"

const loadElements = async () => {
    const pairs = await select(`SELECT ?title ?el ?elLabel WHERE {
        ?l a cpsv:PublicService ;
            dct:title ?title ;
            m8g:hasChannel ?od .
        ?od dstack:realisiertDurch ?el .
        ?el skos:prefLabel ?elLabel .
    } ORDER BY ?title`)
    const byEl = new Map()
    for (const p of pairs) {
        if (!byEl.has(p.el)) byEl.set(p.el, { iri: p.el, label: p.elLabel, abbr: short(p.elLabel), count: 0, services: [] })
        const e = byEl.get(p.el); e.count++; e.services.push(p.title)
    }
    elements = [...byEl.values()].sort((a, b) => b.count - a.count || a.abbr.localeCompare(b.abbr))
    totalServices = new Set(pairs.map(p => p.title)).size
}

const usedByQuery = (iri, label) => `# Verwaltungsleistungen, die ${label} nutzen — auf den (angenommenen) Brücken-Verknüpfungen
SELECT ?leistung ?onlinedienst WHERE {
    ?l a cpsv:PublicService ;
        dct:title ?leistung ;
        m8g:hasChannel ?od .
    ?od dstack:realisiertDurch <${iri}> .
    OPTIONAL { ?od schema:url ?onlinedienst }
} ORDER BY ?leistung`

const renderButtons = () => {
    $("elbuttons").innerHTML = elements.map(e =>
        `<button class="elbtn" data-iri="${esc(e.iri)}">${esc(e.abbr)} <span class="n">${e.count}</span></button>`).join("")
    $("elbuttons").querySelectorAll(".elbtn").forEach(b => b.addEventListener("click", () => selectElement(b.dataset.iri)))
}

const selectElement = (iri) => {
    const e = elements.find(x => x.iri === iri)
    $("elbuttons").querySelectorAll(".elbtn").forEach(b => b.classList.toggle("active", b.dataset.iri === iri))
    const items = e.services.map(s => `<li>${esc(s)}</li>`).join("")
    $("answer").innerHTML = `<p><a class="run-link" href="${queryLink(usedByQuery(iri, e.label))}" target="_blank" rel="noopener">Diese Abfrage als Query ausführen ↗</a></p>
        <p class="answer-head"><b>${esc(e.count)}</b> von ${totalServices} Verwaltungsleistungen nutz${e.count === 1 ? "t" : "en"} <b>${esc(e.label)}</b>:</p>
        <ul class="answer-list">${items}</ul>`
}

// --- 2) conformity filter (the six criteria, or the Gesamt average) ----------
const isGesamt = () => $("criterion").value === GESAMT
// keep the chosen threshold when the criterion changes; only fall back to the
// default when the old value isn't on the new scale (switching to/from Gesamt %)
const thresholdOpts = (sel) => {
    const [vals, dflt, unit] = isGesamt() ? [[30, 40, 50, 60, 70], 50, " %"] : [[1, 2, 3, 4, 5], 3, " von 5"]
    const chosen = vals.includes(Number(sel)) ? Number(sel) : dflt
    return vals.map(n => `<option value="${n}"${n === chosen ? " selected" : ""}>${n}${unit}</option>`).join("")
}

const filterBody = (crit, t) => crit === GESAMT
    ? `{
            SELECT ?el (AVG(?w) AS ?avg) WHERE {
                ?el dstack:konformitaet/dstack:wertProzent ?w
            } GROUP BY ?el
        }
        FILTER(?avg < ${t})`
    : `?el dstack:konformitaet ?a .
        ?a dstack:kriterium/skos:prefLabel ?c ;
            dstack:stufe ?s .
        FILTER(STR(?c) = "${crit}" && ?s < ${t})`

const filterQuery = (crit, t) => `# Verwaltungsleistungen, deren Stack-Elemente alle mindestens ${t}${crit === GESAMT ? "%" : "/5"} bei ${crit === GESAMT ? "dem Gesamt-Durchschnitt" : `"${crit}"`} erreichen
SELECT DISTINCT ?leistung WHERE {
    ?l a cpsv:PublicService ;
        dct:title ?leistung .
    FILTER EXISTS { ?l m8g:hasChannel/dstack:realisiertDurch ?any }
    FILTER NOT EXISTS {
        ?l m8g:hasChannel/dstack:realisiertDurch ?el .
        ${filterBody(crit, t)}
    }
} ORDER BY ?leistung`

// the sentence + the two <select> shells live in the HTML; JS only fills the
// dynamic option lists and wires the listeners
const renderFilterControls = () => {
    $("criterion").innerHTML = [...CRITERIA, GESAMT].map(c => `<option${c === "Nachhaltigkeit" ? " selected" : ""}>${esc(c)}</option>`).join("")
    $("threshold").innerHTML = thresholdOpts()
    $("criterion").addEventListener("change", () => { $("threshold").innerHTML = thresholdOpts($("threshold").value); runFilter() })
    $("threshold").addEventListener("change", runFilter)
}

const runFilter = async () => {
    const crit = $("criterion").value, t = Number($("threshold").value)
    const unit = isGesamt() ? "%" : "/5", critLabel = isGesamt() ? "Gesamt-Durchschnitt" : crit
    const rows = await select(filterQuery(crit, t))
    const link = `<p><a class="run-link" href="${queryLink(filterQuery(crit, t))}" target="_blank" rel="noopener">Diese Abfrage als Query ausführen ↗</a></p>`
    $("filter-result").innerHTML = link + (rows.length
        ? `Bei <span class="answer-head"><b>${rows.length}</b> von ${totalServices} kommen nur Stack-Elemente zum Einsatz, die bei <em>${esc(critLabel)}</em> mit ${t}${unit} bewertet sind:</span>
           <ul class="answer-list">${rows.map(r => `<li>${esc(r.leistung)}</li>`).join("")}</ul>`
        : `<p class="filter-none"><b>Keine</b> Verwaltungsleistung erfüllt diese Anforderung.</p>`)
}

// --- 3) cross-cutting questions the join unlocks -----------------------------
const GALLERY = [
    {
        q: "Welche Behörden wären von einem Fehler in OpenID Connect betroffen - wegen Leistungen in ihrem Verantwortungsbereich?",
        sparql: `SELECT DISTINCT ?stelle WHERE {
    ?l a cpsv:PublicService ;
        m8g:hasCompetentAuthority ?o ;
        m8g:hasChannel/dstack:realisiertDurch ds:open-id-connect .
    ?o skos:prefLabel ?stelle .
} ORDER BY ?stelle`,
    },
    {
        q: "Welche Lebenslagen laufen auf Technik, die bei Souveränität mit 1/5 bewertet ist?",
        sparql: `SELECT DISTINCT ?lebenslage WHERE {
    ?l a cpsv:PublicService ;
        m8g:isGroupedBy/dct:title ?lebenslage ;
        m8g:hasChannel/dstack:realisiertDurch ?el .
    ?el dstack:konformitaet ?a .
    ?a dstack:kriterium ds:kriterium-digitale-souveraenitaet ;  # Souveränität
        dstack:stufe 1 .
} ORDER BY ?lebenslage`,
    },
    {
        q: "Von welchem Stack-Element hängen die meisten Verwaltungsleistungen ab?",
        sparql: `SELECT ?element (COUNT(DISTINCT ?l) AS ?services) WHERE {
    ?l a cpsv:PublicService ;
        m8g:hasChannel/dstack:realisiertDurch ?el .
    ?el skos:prefLabel ?element .
} GROUP BY ?element ORDER BY DESC(?services)`,
    },
    {
        q: "Wohngeld auf einen Blick: Lebenslagen, zuständige Stellen und Technik",
        sparql: `SELECT
    (SAMPLE(?t) AS ?leistung)
    (GROUP_CONCAT(DISTINCT ?lebenslage; separator=" · ") AS ?lebenslagen)
    (COUNT(DISTINCT ?stelle) AS ?zustaendige_stellen)
    (GROUP_CONCAT(DISTINCT ?stackElement; separator=" · ") AS ?stack)
WHERE {
    ?l a cpsv:PublicService ;
        dct:title ?t .
    FILTER(CONTAINS(?t, "Wohngeld"))
    OPTIONAL { ?l m8g:isGroupedBy/dct:title ?lebenslage }
    OPTIONAL { ?l m8g:hasCompetentAuthority ?stelle }
    OPTIONAL { ?l m8g:hasChannel/dstack:realisiertDurch/skos:prefLabel ?stackElement }
}`,
    },
]

const renderGallery = () => {
    $("gallery").innerHTML = `<ul>${GALLERY.map(g => `<li>${esc(g.q)}
        <a class="run-link" href="${queryLink(g.sparql)}" target="_blank" rel="noopener">Ausführen ↗</a></li>`).join("")}</ul>`
}

// --- boot -------------------------------------------------------------------
const init = async () => {
    await Promise.all([loadElements(), loadCriteria()])
    renderButtons()
    renderFilterControls()
    renderGallery()
    if (elements[0]) selectElement(elements[0].iri)
    await runFilter()
}
init().catch(e => { $("elbuttons").innerHTML = `<p class="muted">Der Graph konnte nicht geladen werden: ${esc(e.message || e)}</p>` })
