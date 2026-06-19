// Use-case page: checking a (fictional) municipal IT landscape against the Deutschland-Stack.
// No German municipality publishes its IT landscape machine-readably, so authored/musterstadt-
// it-landschaft.fictional.ttl is our best-bet example — modelled in ArchiMate after GEMMA (NL),
// EIRA (EU) and the Saxon municipal reference. The join is dct:conformsTo onto real Landkarte
// elements: each component is Stack-covered, references a standard the Landkarte lacks (a blind
// spot), or is a proprietary island. Each answer runs live and hands you the exact SPARQL.

import { useCase, esc, $ } from "./use-case.js"

const PRE = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX archimate: <https://purl.org/archimate#>
PREFIX ds: <https://deutschland-stack.gov.de/id/>
PREFIX dstack: <https://deutschland-stack.gov.de/vocab#>
PREFIX mus: <https://example.org/musterstadt#>`

const { select, queryLink, runLink, renderGallery } = useCase(PRE)

// --- 1) coverage: each component classified covered / gap / island ----
// Anchored on the landscape resource (mus:it-landschaft dct:hasPart ?c). A component conforms to a
// D-Stack element (dstack:StackElement) = covered, to a referenced standard without a tile
// (dstack:inLandkarte false) = gap, or to nothing at all = a proprietary island.
const COVERAGE_Q = `# Jede Komponente der kommunalen IT (mus:it-landschaft) und der Standard, dem sie folgt: ein
# D-Stack-Element (dstack:StackElement), ein referenzierter Standard ohne D-Stack-Eintrag
# (dstack:inLandkarte false), oder keiner (proprietäre Insellösung).
SELECT ?komponente ?standard ?imStack WHERE {
    mus:it-landschaft dct:hasPart ?c .
    ?c archimate:name ?komponente .
    OPTIONAL {
        ?c dct:conformsTo ?std .
        OPTIONAL { ?std skos:prefLabel ?l1 }   # ds: D-Stack-Element trägt skos:prefLabel
        OPTIONAL { ?std rdfs:label ?l2 }        # referenzierter Standard trägt rdfs:label
        BIND(COALESCE(?l1, ?l2) AS ?standard)
        BIND(EXISTS { ?std a dstack:StackElement } AS ?imStack)
    }
} ORDER BY ?komponente`

// group the components into three clear buckets (matching the summary): fully covered,
// has a gap (uses a standard with no D-Stack entry), or a proprietary island
const renderCoverage = async () => {
    const rows = await select(COVERAGE_Q)
    const comps = new Map()   // name -> [{label, inStack}]
    for (const r of rows) {
        if (!comps.has(r.komponente)) comps.set(r.komponente, [])
        if (r.standard && !comps.get(r.komponente).some(s => s.label === r.standard)) comps.get(r.komponente).push({ label: r.standard, inStack: r.imStack === "true" })
    }
    const usedEls = new Set(), blindEls = new Set()
    const covered = [], gaps = [], islands = []
    for (const [name, standards] of comps) {
        const blind = standards.filter(s => !s.inStack)
        standards.filter(s => s.inStack).forEach(s => usedEls.add(s.label))
        blind.forEach(s => blindEls.add(s.label))
        if (!standards.length) islands.push(name)
        else if (blind.length) gaps.push({ name, missing: blind.map(s => s.label) })
        else covered.push(name)
    }
    const block = (title, html) => html ? `<p class="answer-head">${title}:</p><ul class="answer-list">${html}</ul>` : ""
    const names = (arr) => arr.map(n => `<li>${esc(n)}</li>`).join("")
    const summary = `<p class="answer-head">Musterstadt hat <b>${usedEls.size}</b> D-Stack-Elemente im Einsatz, ` +
        `<b>${blindEls.size}</b> referenzierte Standards ohne D-Stack-Eintrag und <b>${islands.length}</b> Insellösung(en).</p>`
    $("coverage").innerHTML = runLink(COVERAGE_Q) + summary +
        block("Vollständig durch den D-Stack abgedeckt", names(covered)) +
        block("Nutzt einen Standard ohne D-Stack-Eintrag", gaps.map(g => `<li>${esc(g.name)} <span class="muted">→ ${g.missing.map(esc).join(", ")}</span></li>`).join("")) +
        block("Insellösung (kein offener Standard)", names(islands))
}

// --- 2) the used elements, scored by a pickable Konformität criterion (or the overall average),
//        plus how many landscape components each one underpins ---------------------------------
const GESAMT = "Gesamt (Ø aller sechs)"
let CRITERIA = []   // the six dstack:Kriterium prefLabels, loaded from the graph

const loadCriteria = async () => {
    const rows = await select(`SELECT ?label WHERE { ?k a dstack:Kriterium ; skos:prefLabel ?label } ORDER BY ?label`)
    CRITERIA = rows.map(r => r.label)
}

// how many components of the kommunale IT conform to each used D-Stack element (the usage count)
const USAGE_Q = `SELECT ?el (COUNT(DISTINCT ?c) AS ?n) WHERE {
    mus:it-landschaft dct:hasPart ?c .
    ?c dct:conformsTo ?el .
    ?el a dstack:StackElement .
} GROUP BY ?el`

// the drill-down behind each usage count: which components of Musterstadt use this very element
const compQ = (el) => `# Welche Komponenten von Musterstadt nutzen dieses D-Stack-Element?
SELECT ?komponente WHERE {
    mus:it-landschaft dct:hasPart ?c .
    ?c archimate:name ?komponente ;
        dct:conformsTo <${el}> .
} ORDER BY ?komponente`

// score per element the kommunale IT actually uses: anchored on the landscape (mus:it-landschaft
// dct:hasPart ?komponente), then the element's score for one criterion, or the average across all
// six (Gesamt). DISTINCT / GROUP BY collapse the per-component duplicates.
const scoreQ = (crit) => crit === GESAMT
    ? `# Die von der kommunalen IT genutzten D-Stack-Elemente, Gesamt-Durchschnitt über alle sechs Kriterien
SELECT ?el ?element ?kategorie (AVG(?w) AS ?wert) WHERE {
    mus:it-landschaft dct:hasPart ?komponente .            # eine Komponente der kommunalen IT
    ?komponente dct:conformsTo ?el .                       # nutzt das D-Stack-Element ?el
    ?el a dstack:StackElement ; skos:prefLabel ?element ; dct:subject/skos:prefLabel ?kategorie ;
        dstack:konformitaet/dstack:wertProzent ?w .
} GROUP BY ?el ?element ?kategorie ORDER BY ?wert ?element`
    : `# Die von der kommunalen IT genutzten D-Stack-Elemente, bewertet nach "${crit}" (0-100 %)
SELECT DISTINCT ?el ?element ?kategorie ?wert WHERE {
    mus:it-landschaft dct:hasPart ?komponente .            # eine Komponente der kommunalen IT
    ?komponente dct:conformsTo ?el .                       # nutzt das D-Stack-Element ?el
    ?el a dstack:StackElement ; skos:prefLabel ?element ; dct:subject/skos:prefLabel ?kategorie ;
        dstack:konformitaet ?a .
    ?a dstack:kriterium/skos:prefLabel ?crit ; dstack:wertProzent ?wert .
    FILTER(STR(?crit) = "${crit}")
} ORDER BY ?wert ?element`

const renderConformity = async () => {
    const crit = $("kriterium-picker").value
    const q = scoreQ(crit)
    const [rows, usageRows] = await Promise.all([select(q), select(USAGE_Q)])
    const usage = new Map(usageRows.map(r => [r.el, r.n]))
    const items = rows.map(r => {
        const n = usage.get(r.el) || "0"
        const pct = `${crit === GESAMT ? "Ø " : ""}${Math.round(Number(r.wert))} %`
        const wo = `<a href="${queryLink(compQ(r.el))}" target="_blank" rel="noopener">in ${esc(n)} Komponente${n === "1" ? "" : "n"} ↗</a>`
        return `<li><b>${esc(pct)}</b> &nbsp;${esc(r.element)} <span class="muted">· ${esc(r.kategorie)} ·</span> ${wo}</li>`
    }).join("")
    $("sovereignty").innerHTML = runLink(q) +
        `<p class="answer-head">D-Stack-Bewertung der von Musterstadt genutzten Elemente ${crit === GESAMT ? "(Gesamt-Durchschnitt)" : `in "${esc(crit)}"`}:</p>
         <ul class="answer-list">${items}</ul>`
}

const renderConformityControls = () => {
    $("kriterium-picker").innerHTML = [...CRITERIA, GESAMT].map(c => `<option${c === "Souveränität" ? " selected" : ""}>${esc(c)}</option>`).join("")
    $("kriterium-picker").addEventListener("change", renderConformity)
}

// --- 3) a new project (Bürger-Chatbot): the capability -> option recommendation --------------
// The scenario (authored RDF, musterstadt-chatbot.scenario.ttl) lists each capability the project
// needs and the options the city evaluated: Stack elements (ds:) and proprietary alternatives
// (mus:opt-*). Reuse-vs-new is not stored: a Stack candidate the landscape already uses is a
// reuse, the rest are new. So the recommendation and before/after coverage are computed here.
const RECO_Q = `# Jede Fähigkeit des geplanten Bürger-Chatbots mit jeder bewerteten Option: Stack-Elemente
# (ds:, mit Kategorie) und proprietäre Alternativen (mus:opt-*, ohne Stack-Bezug).
SELECT ?faehigkeit ?cand ?stackLabel ?kategorie ?optLabel WHERE {
    mus:projekt-buergerchatbot dstack:benoetigt ?f .
    ?f rdfs:label ?faehigkeit ;
        dstack:kandidat ?cand .
    OPTIONAL { ?cand a dstack:StackElement ; skos:prefLabel ?stackLabel ; dct:subject/skos:prefLabel ?kategorie }
    OPTIONAL { ?cand rdfs:label ?optLabel }
} ORDER BY ?faehigkeit ?stackLabel`

const USED_Q = `# Die D-Stack-Elemente, die die kommunale IT heute schon nutzt (für wiederverwenden vs. neu)
SELECT DISTINCT ?el WHERE {
    mus:it-landschaft dct:hasPart ?c .
    ?c dct:conformsTo ?el .
    ?el a dstack:StackElement .
}`

const renderChatbot = async () => {
    const [reco, usedRows] = await Promise.all([select(RECO_Q), select(USED_Q)])
    const used = new Set(usedRows.map(r => r.el))
    // per capability: the recommended D-Stack option(s) + the proprietary alternative(s) considered
    const caps = new Map()   // capability -> { stack:[{iri,label,reuse}], alt:[label] }
    for (const r of reco) {
        if (!caps.has(r.faehigkeit)) caps.set(r.faehigkeit, { stack: [], alt: [] })
        const c = caps.get(r.faehigkeit)
        if (r.kategorie) c.stack.push({ iri: r.cand, label: r.stackLabel, reuse: used.has(r.cand) })  // a StackElement (has a category)
        else c.alt.push(r.optLabel)                                                                    // a non-Stack option
    }
    const stackEls = new Set()
    let reuse = 0, neu = 0
    for (const c of caps.values()) c.stack.forEach(s => { stackEls.add(s.iri); s.reuse ? reuse++ : neu++ })
    const after = new Set([...used, ...stackEls])
    // a comparison table: one row per capability — the recommended D-Stack option (bold) and its
    // status, against the proprietary alternative the city evaluated (muted). reuse rows first.
    const ordered = [...caps.entries()].sort((a, b) => Number(b[1].stack.some(s => s.reuse)) - Number(a[1].stack.some(s => s.reuse)))
    const row = ([f, c]) => {
        const empf = c.stack.map(s => esc(s.label)).join(", ")
        const status = c.stack.some(s => s.reuse) ? "schon im Bestand" : "neu aus dem Stack"
        const alt = c.alt.length ? c.alt.map(esc).join(", ") : "—"
        return `<tr><td>${esc(f)}</td><td><b>${empf}</b></td><td>${status}</td><td class="alt">${alt}</td></tr>`
    }
    $("chatbot").innerHTML = runLink(RECO_Q) +
        `<p class="answer-head">Für jede der ${caps.size} notwendigen Fähigkeiten des Chatbots empfiehlt der Graph D-Stack-Elemente:</p>` +
        `<div class="uc-table-wrap"><table class="uc-table">
            <thead><tr><th>Fähigkeit</th><th>Empfehlung (D-Stack)</th><th>Status</th><th>Proprietäre Alternative</th></tr></thead>
            <tbody>${ordered.map(row).join("")}</tbody></table></div>`
}

// --- 4) further questions the join unlocks (links to the Query page) ----------
const GALLERY = [
    {
        q: "Welche Standards nutzt die kommunale IT, die der Deutschland-Stack (noch) nicht führt?",
        sparql: `SELECT DISTINCT ?standard ?quelle WHERE {
    mus:it-landschaft dct:hasPart ?c .    # auf Komponenten der kommunalen IT eingrenzen
    ?c dct:conformsTo ?std .
    ?std a dstack:ReferenzierterStandard ;
        rdfs:label ?standard ;
        dstack:inLandkarte false .
    OPTIONAL { ?std dct:source ?quelle }
} ORDER BY ?standard`,
    },
    {
        q: "Welche Komponenten haben gar keinen offenen Standard (Insellösungen)?",
        sparql: `SELECT ?komponente WHERE {
    mus:it-landschaft dct:hasPart ?c .
    ?c archimate:name ?komponente .
    FILTER NOT EXISTS { ?c dct:conformsTo ?any }
} ORDER BY ?komponente`,
    },
    {
        q: "Welches D-Stack-Element trägt die kommunale IT am breitesten (meiste Komponenten)?",
        sparql: `SELECT ?element (COUNT(DISTINCT ?c) AS ?komponenten) WHERE {
    mus:it-landschaft dct:hasPart ?c .
    ?c dct:conformsTo ?el .
    ?el a dstack:StackElement ;
        skos:prefLabel ?element .
} GROUP BY ?element ORDER BY DESC(?komponenten)`,
    },
    {
        // two inline query links: which D-Stack categories the IT already covers, and which it does not
        render: (queryLink) => {
            const covered = `# D-Stack-Kategorien, die die kommunale IT schon abdeckt (mit Anzahl genutzter Elemente)
SELECT ?kategorie (COUNT(DISTINCT ?element) AS ?genutzte_elemente) WHERE {
    mus:it-landschaft dct:hasPart ?c .
    ?c dct:conformsTo ?element .
    ?element a dstack:StackElement ;
        dct:subject/skos:prefLabel ?kategorie .
} GROUP BY ?kategorie ORDER BY DESC(?genutzte_elemente)`
            const uncovered = `# D-Stack-Kategorien, die die kommunale IT noch gar nicht nutzt (z.B. KI)
SELECT DISTINCT ?kategorie WHERE {
    ?el a dstack:StackElement ; dct:subject ?gruppe .
    ?gruppe skos:prefLabel ?kategorie .
    FILTER NOT EXISTS { mus:it-landschaft dct:hasPart ?c . ?c dct:conformsTo/dct:subject ?gruppe . }
} ORDER BY ?kategorie`
            const link = (q, t) => `<a class="run-link" href="${queryLink(q)}" target="_blank" rel="noopener">${t} ↗</a>`
            return `Welche D-Stack-Kategorien deckt die kommunale IT ${link(covered, "schon ab")}, und welche ${link(uncovered, "noch nicht")}?`
        },
    },
]

// --- boot -------------------------------------------------------------------
const init = async () => {
    await loadCriteria()
    renderConformityControls()
    await renderCoverage()
    await renderConformity()
    await renderChatbot()
    renderGallery("gallery", GALLERY)
}
init().catch(e => { $("coverage").innerHTML = `<p class="muted">Der Graph konnte nicht geladen werden: ${esc(e.message || e)}</p>` })
