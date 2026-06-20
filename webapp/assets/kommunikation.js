// Use-case page: rendering Deutschland-Stack comms pieces straight out of the graph.
// Each "Blickwinkel" is a dstack:Textbaustein hung onto a graph node (authored/comms.authored.ttl):
// it carries an authored headline + line template (with {{placeholder}}s) AND its own SPARQL query.
// Pressing a tag runs that query live against the composed graph, fills the placeholders from the
// results, and renders a finished Faktenkarte — a projection of the graph, every number traceable.
// The comms layer (authored/comms.authored.ttl) is part of the shared composed graph, so the Query
// page, the visual builder and the export include it too — each Textbaustein carries its own query.

import { useCase, esc, $ } from "./use-case.js"

const PRE = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX schema: <http://schema.org/>
PREFIX sh: <http://www.w3.org/ns/shacl#>
PREFIX cpsv: <http://purl.org/vocab/cpsv#>
PREFIX m8g: <http://data.europa.eu/m8g/>
PREFIX archimate: <https://purl.org/archimate#>
PREFIX ds: <https://deutschland-stack.gov.de/id/>
PREFIX dstack: <https://deutschland-stack.gov.de/vocab#>
PREFIX mus: <https://example.org/musterstadt#>`

const { select, queryLink } = useCase(PRE)

// deep-link a snippet's whole self-describing shape on Codeberg (its leading comment, triples and the
// carried query). Line ranges are hardcoded for simplicity — re-check them if comms.authored.ttl is
// re-laid-out above or within these blocks.
const TTL_URL = "https://codeberg.org/benjaminaaron/d-stack-kg/src/branch/main/authored/comms.authored.ttl"
const VORLAGE_LINES = {
    "tb-souveraenitaet": "L37-L52",
    "tb-buergernah": "L54-L73",
    "tb-wiederverwendung": "L75-L89",
    "tb-luecken": "L91-L106",
}
const vorlageLink = (iri) => {
    const range = VORLAGE_LINES[iri.split(/[#/]/).pop()]
    return range ? `${TTL_URL}#${range}` : null
}

// fill {{key}} placeholders from a bindings row; round decimal-looking numbers for display
const fmt = (v) => /^-?\d+\.\d+$/.test(v) ? String(Math.round(Number(v))) : v
const fill = (tpl, row) => tpl.replace(/{{\s*(\w+)\s*}}/g, (_, k) => esc(fmt(row[k] ?? "")))

// every Textbaustein = one Blickwinkel tag, ordered by the scheme. The headline, the optional
// line template and the snippet's own query all come straight off the node.
const SNIPPETS_Q = `SELECT ?tb ?angleLabel ?ord ?headline ?hinweis ?zeile ?abfrage WHERE {
    ?tb a dstack:Textbaustein ;
        rdfs:label ?angleLabel ;
        sh:order ?ord ;
        schema:headline ?headline ;
        sh:select ?abfrage .
    OPTIONAL { ?tb schema:description ?hinweis }
    OPTIONAL { ?tb schema:text ?zeile }
} ORDER BY ?ord`

let SNIPPETS = []
let active = 0

const renderTags = () => {
    $("comms-tags").innerHTML = SNIPPETS.map((s, i) =>
        `<button type="button" class="elbtn${i === active ? " active" : ""}" data-i="${i}">${esc(s.angleLabel)}</button>`).join("")
    $("comms-tags").querySelectorAll("button").forEach(b =>
        b.addEventListener("click", () => { active = Number(b.dataset.i); renderTags(); renderCard() }))
}

// run the selected snippet's own query, fill its templates, render the card. anzahl (the row
// count) is always available to the headline; everything else is read off the first result row.
const renderCard = async () => {
    const s = SNIPPETS[active]
    $("comms-card").innerHTML = `<p class="muted">Wird aus dem Graphen gerendert …</p>`
    const rows = await select(s.abfrage)
    if (!rows.length) { $("comms-card").innerHTML = `<p class="muted">Diese Abfrage liefert gerade keine Zeilen.</p>`; return }
    const ctx = { ...rows[0], anzahl: String(rows.length) }
    const list = s.zeile
        ? `<ul class="answer-list comms-list">${rows.map(r => `<li>${fill(s.zeile, { ...r, anzahl: String(rows.length) })}</li>`).join("")}</ul>`
        : ""
    const hinweis = s.hinweis ? `<p class="comms-hinweis">${esc(s.hinweis)}</p>` : ""
    const link = `<a class="run-link" href="${queryLink(s.abfrage)}" target="_blank" rel="noopener">Abfrage ansehen ↗</a>`
    const vurl = vorlageLink(s.tb)
    const vorlage = vurl ? `<a class="run-link" href="${vurl}" target="_blank" rel="noopener">Vorlage ansehen ↗</a> · ` : ""
    $("comms-card").innerHTML = `
        <article class="comms-piece">
            <p class="comms-headline">${fill(s.headline, ctx)}</p>
            ${hinweis}
            ${list}
            <p class="comms-foot">Alle Zahlen live aus dem Graphen. ${vorlage}${link}</p>
        </article>`
}

// --- second section: a full per-Leistung report, audience-parameterised -------
// The richer payoff: a complete report assembled from the graph. The report definition is a
// schema:Report node in comms.authored.ttl that carries its own SPARQL query (sh:select); the query
// returns, per bridged Leistung, each D-Stack baustein with both description registers and the
// technical facts. The audience flag is a pure render parameter — it picks the description register
// (the upstream technical dct:description@de vs. the authored @de-x-fachlich one) and how much detail
// to show.
const AUDIENCES = [
    { key: "technisch", label: "Technisch" },
    { key: "fachlich", label: "Fachlich" },
]
let REPORT = null    // { abfrage, order: [ [leistung, [block,...]], ... ] }
let aud = 0

const loadReport = async () => {
    const meta = (await select(`SELECT ?abfrage WHERE { dstack:bericht-leistung sh:select ?abfrage }`))[0]
    if (!meta) return
    const rows = await select(meta.abfrage)
    const byL = new Map()
    for (const r of rows) { if (!byL.has(r.leistung)) byL.set(r.leistung, []); byL.get(r.leistung).push(r) }
    // richest reports first (most bausteine, then most with a fachlich register)
    const order = [...byL.entries()].sort((a, b) =>
        b[1].length - a[1].length
        || b[1].filter(r => r.fachlich).length - a[1].filter(r => r.fachlich).length
        || a[0].localeCompare(b[0]))
    REPORT = { abfrage: meta.abfrage, order }
}

// wired once from init: the Leistung picker, the audience buttons and their listeners. toggling the
// audience only updates `aud`, restyles the active button and re-renders — so the picked Leistung is
// preserved and no change-listeners pile up on the persistent <select>.
const renderBerichtControls = () => {
    $("bericht-picker").innerHTML = REPORT.order.map(([l]) => `<option>${esc(l)}</option>`).join("")
    $("bericht-picker").addEventListener("change", renderBericht)
    $("bericht-aud").innerHTML = AUDIENCES.map((a, i) =>
        `<button type="button" class="elbtn${i === aud ? " active" : ""}" data-i="${i}">${esc(a.label)}</button>`).join("")
    $("bericht-aud").querySelectorAll("button").forEach(b =>
        b.addEventListener("click", () => {
            aud = Number(b.dataset.i)
            $("bericht-aud").querySelectorAll("button").forEach((x, i) => x.classList.toggle("active", i === aud))
            renderBericht()
        }))
}

const renderBericht = () => {
    const leistung = $("bericht-picker").value
    const blocks = (REPORT.order.find(([l]) => l === leistung) || [, []])[1]
    const technisch = AUDIENCES[aud].key === "technisch"
    // element name + the description in the audience's register. the technisch register is the (longer)
    // upstream Landkarte text, so it is truncated to roughly the fachlich length with a "mehr …" link
    // that reveals the full text in place; the authored fachlich text is short and shown whole.
    const TECH_LIMIT = 120
    const descBlock = (text) => {
        text = text.trim()
        if (!technisch || text.length <= TECH_LIMIT) return `<p class="bericht-text">${esc(text)}</p>`
        let cut = text.lastIndexOf(" ", TECH_LIMIT)
        if (cut < 1) cut = TECH_LIMIT
        return `<p class="bericht-text">
            <span class="bt-short">${esc(text.slice(0, cut).trim())} <a href="#" class="mehr">mehr …</a></span>
            <span class="bt-full" hidden>${esc(text)}</span>
        </p>`
    }
    const block = (r) => {
        const desc = (technisch ? (r.technisch || r.fachlich) : (r.fachlich || r.technisch)) || ""
        return `<div class="bericht-block">
            <p class="bericht-name">${esc(r.element)}</p>
            ${descBlock(desc)}
        </div>`
    }
    const intro = `Dieser Online-Antrag stützt sich auf <b>${blocks.length}</b> Baustein${blocks.length === 1 ? "" : "e"} des Deutschland-Stack${technisch ? ", hier technisch beschrieben." : ", hier fachlich eingeordnet."}`
    const link = `<a class="run-link" href="${queryLink(REPORT.abfrage)}" target="_blank" rel="noopener">Abfrage ansehen ↗</a>`
    $("bericht-out").innerHTML =
        `<p class="bericht-title">Bausteine hinter »${esc(leistung)}«</p>
         <p class="bericht-intro">${intro}</p>
         ${blocks.map(block).join("")}
         <p class="comms-foot">Automatisch aus dem Graphen erzeugt. ${link}</p>`
}

// --- third section: the cross-layer footprint of a single baustein ------------
// The clearest argument for one shared graph. The report (another schema:Report carrying its own
// sh:select) returns, per baustein, every connected thing across four source datasets — services
// (PVOG), data schemas (FIT-Connect), municipal components (Musterstadt), planned capabilities (the
// Vorhaben), each tagged with its ?layer. The footprint message is the join made visible.
const LAYERS = [
    { key: "Verwaltungsleistung", one: "Verwaltungsleistung", many: "Verwaltungsleistungen", quelle: "PVOG" },
    { key: "Fachdatenschema", one: "Fachdatenschema", many: "Fachdatenschemata", quelle: "FIT-Connect" },
    { key: "Kommunale Komponente", one: "kommunale Komponente", many: "kommunale Komponenten", quelle: "Musterstadt" },
    { key: "Geplante Fähigkeit", one: "geplante Fähigkeit", many: "geplante Fähigkeiten", quelle: "Musterstadt-Vorhaben" },
]
let REACH = null   // { abfrage, order: [ [element, Map(layer -> [ziel,...])], ... ] }

const loadReach = async () => {
    const meta = (await select(`SELECT ?abfrage WHERE { dstack:bericht-reichweite sh:select ?abfrage }`))[0]
    if (!meta) return
    const byEl = new Map()
    for (const r of await select(meta.abfrage)) {
        if (!byEl.has(r.element)) byEl.set(r.element, new Map())
        const m = byEl.get(r.element)
        if (!m.has(r.layer)) m.set(r.layer, [])
        m.get(r.layer).push(r.ziel)
    }
    // most-connected first: by number of layers spanned, then total connections
    const span = (m) => m.size * 1000 + [...m.values()].reduce((n, a) => n + a.length, 0)
    REACH = { abfrage: meta.abfrage, order: [...byEl.entries()].sort((a, b) => span(b[1]) - span(a[1]) || a[0].localeCompare(b[0])) }
}

const renderReichweiteControls = () => {
    $("reichweite-picker").innerHTML = REACH.order.map(([el]) => `<option>${esc(el)}</option>`).join("")
    $("reichweite-picker").addEventListener("change", renderReichweite)
}

const renderReichweite = () => {
    const el = $("reichweite-picker").value
    const m = (REACH.order.find(([e]) => e === el) || [, new Map()])[1]
    const present = LAYERS.filter(l => m.get(l.key)?.length)
    const summary = present.map(l => { const n = m.get(l.key).length; return `<b>${n}</b> ${n === 1 ? l.one : l.many}` }).join(" · ")
    const sections = present.map(l => {
        const head = l.many.charAt(0).toUpperCase() + l.many.slice(1)
        const items = m.get(l.key).map(z => `<li>${esc(z)}</li>`).join("")
        return `<div class="reach-group">
            <p class="reach-head">${esc(head)} <span class="reach-src">Quelle: ${esc(l.quelle)}</span></p>
            <ul class="reach-list">${items}</ul>
        </div>`
    }).join("")
    const quellen = [...new Set(present.map(l => l.quelle))].join(", ")
    const link = `<a class="run-link" href="${queryLink(REACH.abfrage)}" target="_blank" rel="noopener">Abfrage ansehen ↗</a>`
    $("reichweite-out").innerHTML =
        `<p class="bericht-title">»${esc(el)}« verbindet ${present.length} ${present.length === 1 ? "Schicht" : "Schichten"} der Verwaltung</p>
         <p class="bericht-intro">${summary}</p>
         ${sections}
         <p class="comms-foot">Automatisch aus dem Graphen erzeugt. ${link}</p>`
}

const init = async () => {
    // render in visual order — the Botschaften cards now sit at the bottom, so the visible top
    // sections (Steckbrief, then footprint) are computed first.
    await loadReport()
    if (REPORT) { renderBerichtControls(); renderBericht() }
    // reveal the full technisch text in place when "mehr …" is clicked (delegated, #bericht-out persists)
    $("bericht-out").addEventListener("click", e => {
        const a = e.target.closest("a.mehr")
        if (!a) return
        e.preventDefault()
        const p = a.closest(".bericht-text")
        p.querySelector(".bt-short").hidden = true
        p.querySelector(".bt-full").hidden = false
    })
    await loadReach()
    if (REACH) { renderReichweiteControls(); renderReichweite() }
    SNIPPETS = await select(SNIPPETS_Q)
    renderTags()
    await renderCard()
}
init().catch(e => { $("bericht-out").innerHTML = `<p class="muted">Der Graph konnte nicht geladen werden: ${esc(e.message || e)}</p>` })
