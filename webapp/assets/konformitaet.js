// Use-case page: scanning openCode repositories for Deutschland-Stack conformance. Each repo
// (authored/opencode-konformitaet.scenario.ttl) carries the dependencies an automated scanner
// would read out of its manifests (package.json, build.gradle, requirements.txt, go.mod,
// Dockerfile, k8s manifests). Each dependency is heuristically mapped (dstack:abgebildetAuf) onto a
// real Landkarte StackElement (konform), a referenced standard without a tile (blinder Fleck), a
// recognised proprietary product (proprietär), or nothing at all (nicht erkannt). The graph already
// holds the D-Stack elements, so the conformance check is
// one query away: the runnable nucleus of the D-Stack's own "weitgehend automatisierten"
// certification (Self-Assessment-Test, Reporting-Dashboard, Vergabe-Kriterien). Every answer runs
// live and hands you the exact SPARQL.

import { useCase, esc, $ } from "./use-case.js"

const PRE = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX schema: <http://schema.org/>
PREFIX ds: <https://deutschland-stack.gov.de/id/>
PREFIX dstack: <https://deutschland-stack.gov.de/vocab#>`

const { select, queryLink, runLink, renderGallery } = useCase(PRE)

// escape a value interpolated into a SPARQL string literal (titles are authored and currently safe,
// but a quote in a title would otherwise break the drill-down query)
const sparqlStr = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')

// --- the scan: every repo, every declared dependency, and the element it maps to ---------------
// One query feeds both the dashboard (aggregated per repo) and the per-repo self-assessment. A
// dependency maps to a D-Stack element (dstack:StackElement) = konform, to a referenced standard
// without a tile (dstack:inLandkarte false) = blinder Fleck, to a dstack:ProprietaeresProdukt =
// proprietär, or to nothing = nicht erkannt.
const SCAN_Q = `# Jede gescannte Abhängigkeit eines openCode-Repositories: das Paket, die Manifest-Datei und das
# Ziel, auf das der Scanner sie abbildet. Vier Befunde: ein Landkarte-Element = konform, ein
# referenzierter Standard ohne Kachel = blinder Fleck, ein proprietäres Produkt = proprietär, oder
# gar keine Zuordnung = nicht erkannt (Grenze des Verfahrens, keine Konformitätsaussage).
SELECT ?repo ?titel ?url ?real ?vollstaendig ?gesamt ?dep ?paket ?manifest ?el ?elLabel ?inStack ?blind ?prop ?hinweis ?alt WHERE {
    ?repo a schema:SoftwareSourceCode ;
        dct:title ?titel ;
        dct:hasPart ?dep .
    ?dep dstack:paket ?paket ;
        dstack:ausManifest ?manifest .
    OPTIONAL { ?repo schema:codeRepository ?url }
    OPTIONAL { ?repo dstack:realesProjekt ?real }
    OPTIONAL { ?repo dstack:vollstaendigGescannt ?vollstaendig }
    OPTIONAL { ?repo dstack:manifesteGesamt ?gesamt }
    OPTIONAL {
        ?dep dstack:abgebildetAuf ?el .
        OPTIONAL { ?el skos:prefLabel ?l1 }
        OPTIONAL { ?el rdfs:label ?l2 }
        OPTIONAL { ?el dct:description ?hinweis }
        OPTIONAL { ?el dstack:offeneAlternative ?alt }
        BIND(COALESCE(?l1, ?l2) AS ?elLabel)
        BIND(EXISTS { ?el a dstack:StackElement } AS ?inStack)
        BIND(EXISTS { ?el dstack:inLandkarte false } AS ?blind)
        BIND(EXISTS { ?el a dstack:ProprietaeresProdukt } AS ?prop)
    }
} ORDER BY ?titel ?manifest ?paket`

// the standards a Beschluss binds (dstack:nenntStandard from a Standardbereich): the verbindlich set
const VERBINDLICH_Q = `SELECT DISTINCT ?el WHERE {
    ?sb a dstack:Standardbereich ;
        dstack:nenntStandard ?el .
}`

// the scanned manifests of each repo, labelled exactly as the dashboard shows them (= dstack:ausManifest)
// and linked to the commit-pinned original on openCode. Only real projects carry these (dct:source).
const MANIFEST_Q = `SELECT ?repo ?label ?url WHERE {
    ?repo a schema:SoftwareSourceCode ;
        dct:source ?m .
    ?m rdfs:label ?label ;
        schema:url ?url .
}`

let SCAN = []                 // all scan rows (one row per dependency-mapping)
let REPOS = []                // [{iri, titel, url}] in title order
let VERB = new Set()          // IRIs of verbindlich-required elements
let MF = new Map()            // repo IRI -> Map(manifest label -> permalink); real projects only
// four honest outcomes per dependency, taken from its best mapping: maps to a Landkarte element
// (konform), to a standard without a tile (blind), to a recognised proprietary product (prop), or
// to nothing the scanner knows (unbekannt = nicht erkannt). A dependency may carry several mappings
// (a web framework -> REST + OpenAPI), so the verdict is the strongest one present.
const depVerdict = (d) => d.mappings.some(m => m.inStack === "true") ? "konform"
    : d.mappings.some(m => m.blind === "true") ? "blind"
        : d.mappings.some(m => m.prop === "true") ? "prop"
            : "unbekannt"

// group the flat scan rows into repos, each repo into its distinct dependencies (collecting each
// dependency's one-or-more mappings), with per-repo counts and the distinct set of D-Stack standards
// the repo's dependencies exercise (the standard-centric headline).
const aggregate = () => {
    const m = new Map()
    for (const r of SCAN) {
        if (!m.has(r.titel)) m.set(r.titel, { iri: r.repo, titel: r.titel, url: r.url, real: r.real === "true", vollstaendig: r.vollstaendig === "true", gesamt: r.gesamt, depMap: new Map(), manifests: new Set() })
        const a = m.get(r.titel)
        a.manifests.add(r.manifest)
        if (!a.depMap.has(r.dep)) a.depMap.set(r.dep, { dep: r.dep, paket: r.paket, manifest: r.manifest, mappings: [] })
        // a dependency maps to a given element once; multi-language labels (de + en) can otherwise
        // produce duplicate rows for the same mapping
        if (r.el) {
            const dep = a.depMap.get(r.dep)
            if (!dep.mappings.some(mp => mp.el === r.el)) dep.mappings.push({ el: r.el, elLabel: r.elLabel, inStack: r.inStack, blind: r.blind, prop: r.prop, hinweis: r.hinweis, alt: r.alt })
        }
    }
    for (const a of m.values()) {
        a.deps = [...a.depMap.values()]
        a.deps.forEach(d => { d.verdict = depVerdict(d) })
        a.konform = a.deps.filter(d => d.verdict === "konform").length
        a.blind = a.deps.filter(d => d.verdict === "blind").length
        a.prop = a.deps.filter(d => d.verdict === "prop").length
        a.unbekannt = a.deps.filter(d => d.verdict === "unbekannt").length
        const standards = new Set()
        a.deps.forEach(d => d.mappings.forEach(mp => { if (mp.inStack === "true") standards.add(mp.el) }))
        a.standards = standards.size
        a.verbindlich = [...standards].filter(el => VERB.has(el)).length
    }
    return m
}

// a real repo whose manifests were only sampled (a large monorepo): findings still hold, but we issue
// no overall verdict and treat its standards count as a lower bound — a count over a sample is not a score.
const isSample = (a) => a.real && !a.vollstaendig

// the badge a self-assessment portal would print. Only for fully-scanned repos (else "Stichprobe", no
// verdict): a proprietary baustein is the real downgrade (a sovereignty finding); blind spots are softer.
// Reuses the .bl-chip pill, no new styling.
const badge = (a) => {
    if (isSample(a)) return `<span class="bl-chip">Stichprobe</span>`
    // every dependency maps to a Landkarte standard, no findings at all: the constructed Vorbild
    if (a.deps.length && a.blind === 0 && a.prop === 0 && a.unbekannt === 0) return `<span class="bl-chip">Vorbild</span>`
    if (a.blind === 0 && a.prop === 0) return `<span class="bl-chip">konform</span>`
    if (a.prop <= 1) return `<span class="bl-chip">weitgehend konform</span>`
    return `<span class="bl-chip gap">teilkonform</span>`
}

// --- 1) the reporting dashboard: one row per scanned repository ---------------------------------
const renderDashboard = () => {
    // real projects first, then illustrative examples; within each, by title
    const repos = [...aggregate().values()].sort((a, b) => (b.real - a.real) || a.titel.localeCompare(b.titel))
    // a manifest path is shortened to ".../filename" for display; the full path stays in the tooltip + link.
    // a trailing slash (a directory like "helm/") is kept as-is rather than collapsed to "…/"
    const shortMf = (label) => {
        const t = label.replace(/\/$/, "")
        const i = t.lastIndexOf("/")
        return i < 0 ? label : "…/" + t.slice(i + 1)
    }
    const row = (a) => {
        const tag = a.real ? ` <span class="bl-chip">real</span>` : ` <span class="bl-chip">Beispiel</span>`
        const name = (a.real && a.url)
            ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.titel)} ↗</a>`
            : esc(a.titel)
        // real repos list the manifests the scanner actually read (dct:source), linked; examples list their (fictional) ones plain
        const mfMap = MF.get(a.iri)
        const files = (mfMap && mfMap.size)
            ? [...mfMap.entries()].map(([label, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener" title="${esc(label)}">${esc(shortMf(label))}</a>`).join(", ")
            : [...a.manifests].map(m => `<span title="${esc(m)}">${esc(shortMf(m))}</span>`).join(", ")
        const n = mfMap?.size
        const scope = a.real
            ? `<br><span class="muted">${a.vollstaendig
                ? `alle ${n} Manifeste geprüft`
                : `Stichprobe · ${n} von über ${a.gesamt} Manifesten`}</span>`
            : ""
        return `<tr>
            <td>${name}${tag}</td>
            <td class="alt mf-cell">${files}${scope}</td>
            <td>${isSample(a) ? "mind. " : ""}<b>${a.standards}</b> <span class="muted">(davon ${a.verbindlich} verbindlich)</span></td>
            <td>${a.blind || "–"}</td>
            <td>${a.prop || "–"}</td>
            <td>${badge(a)}</td>
        </tr>`
    }
    $("dashboard").innerHTML = runLink(SCAN_Q) +
        `<p class="answer-head">${repos.length} Repositories automatisiert geprüft (reale Projekte zuerst):</p>
         <div class="uc-table-wrap"><table class="uc-table">
            <thead><tr><th>Repository</th><th>Geprüfte Manifeste</th><th>D-Stack-Standards</th><th>Blinde Flecken</th><th>Proprietär</th><th>Bewertung</th></tr></thead>
            <tbody>${repos.map(row).join("")}</tbody></table></div>`
}

// --- 2) the self-assessment of one repository, grouped by manifest file -------------------------
// the drill-down query behind the picked repo (handed to the Query page as-is)
const repoScanQ = (titel) => `# Self-Assessment eines Repositories: jede deklarierte Abhängigkeit und ihr Befund
SELECT ?manifest ?paket ?elLabel ?inStack ?blind ?prop WHERE {
    ?repo a schema:SoftwareSourceCode ;
        dct:title "${sparqlStr(titel)}"@de ;
        dct:hasPart ?dep .
    ?dep dstack:paket ?paket ;
        dstack:ausManifest ?manifest .
    OPTIONAL {
        ?dep dstack:abgebildetAuf ?el .
        OPTIONAL { ?el skos:prefLabel ?l1 }
        OPTIONAL { ?el rdfs:label ?l2 }
        BIND(COALESCE(?l1, ?l2) AS ?elLabel)
        BIND(EXISTS { ?el a dstack:StackElement } AS ?inStack)
        BIND(EXISTS { ?el dstack:inLandkarte false } AS ?blind)
        BIND(EXISTS { ?el a dstack:ProprietaeresProdukt } AS ?prop)
    }
} ORDER BY ?manifest ?paket`

// one mapping's chip (konform / blinder Fleck / proprietär); a dependency lists one or more of these
const mappingChip = (mp) => mp.inStack === "true"
    ? `<b>${esc(mp.elLabel)}</b> <span class="bl-chip ds">D-Stack &check;</span>${VERB.has(mp.el) ? ' <span class="bl-chip">verbindlich</span>' : ""}`
    : mp.blind === "true"
        ? `${esc(mp.elLabel)} <span class="bl-chip gap">blinder Fleck</span>`
        : `${esc(mp.elLabel)} <span class="bl-chip gap"${mp.hinweis ? ` data-tip="${esc(mp.hinweis)}"` : ""}>proprietär</span>${mp.alt ? ` <span class="offen">offene Alternative: <b>${esc(mp.alt)}</b></span>` : ""}`

// one dependency line: the package, then either its mappings (a dep can have several)
// or the honest "nicht erkannt" when the scanner has no mapping
const depLine = (d) => {
    const body = d.mappings.length
        ? "&rarr; " + d.mappings.map(mappingChip).join(" &nbsp;")
        : `<span class="bl-chip gap">nicht erkannt</span> <span class="muted">keine D-Stack-Zuordnung</span>`
    return `<li><code>${esc(d.paket)}</code> ${body}</li>`
}

const renderAssessment = () => {
    const titel = $("repo-picker").value
    const a = aggregate().get(titel)
    // one block per manifest file, each listing its dependencies and their mappings
    const byManifest = new Map()
    for (const d of a.deps.slice().sort((x, y) => x.manifest.localeCompare(y.manifest) || x.paket.localeCompare(y.paket))) {
        if (!byManifest.has(d.manifest)) byManifest.set(d.manifest, [])
        byManifest.get(d.manifest).push(d)
    }
    const blocks = [...byManifest.entries()].map(([file, deps]) => {
        // link the manifest header to its commit-pinned original on openCode (real projects only)
        const u = MF.get(a.iri)?.get(file)
        const head = u ? `<a href="${esc(u)}" target="_blank" rel="noopener"><code>${esc(file)}</code></a>` : `<code>${esc(file)}</code>`
        return `<p class="answer-head">${head}</p><ul class="answer-list">` +
            deps.map(depLine).join("") + `</ul>`
    }).join("")
    const sample = isSample(a)
    const nMf = MF.get(a.iri)?.size ?? a.manifests.size
    const scope = a.real
        ? (a.vollstaendig ? `alle ${nMf} Manifeste` : `Stichprobe (${nMf} von über ${a.gesamt})`)
        : "alle Manifeste"
    const flecken = `${a.blind} ${a.blind === 1 ? "blinder Fleck" : "blinde Flecken"}`
    const summary = `<p class="answer-head">Geprüft: ${scope} · ${sample ? "mind. " : ""}<b>${a.standards}</b> D-Stack-Standard${a.standards === 1 ? "" : "s"} (${a.verbindlich} verbindlich) · ${flecken} · ${a.prop} proprietär</p>` +
        (a.real && a.vollstaendig && a.unbekannt ? `<p class="muted">Allgemeine Bibliotheken ohne D-Stack-Bezug sind unten nicht einzeln aufgeführt.</p>` : "")
    $("assessment").innerHTML = runLink(repoScanQ(titel)) + summary + blocks
}

// --- 3) Vergabe-Kriterium: how the D-Stack scores the elements actually in use ------------------
const GESAMT = "Gesamt (Ø aller sechs)"
let CRITERIA = []   // [{label, iri}]

const loadCriteria = async () => {
    const rows = await select(`SELECT ?k ?label WHERE { ?k a dstack:Kriterium ; skos:prefLabel ?label } ORDER BY ?label`)
    CRITERIA = rows.map(r => ({ label: r.label, iri: r.k }))
}

// the D-Stack elements ONE repository uses, scored on one criterion (bound by IRI, not label, for
// speed), or the average across all six (Gesamt). Anchored on the picked repo's title.
const scoreQ = (titel, crit) => crit.label === GESAMT
    ? `# Die von diesem Repository genutzten D-Stack-Elemente, Gesamt-Durchschnitt über alle sechs Kriterien
SELECT ?el ?element ?kategorie (AVG(?w) AS ?wert) WHERE {
    ?repo a schema:SoftwareSourceCode ;
        dct:title "${sparqlStr(titel)}"@de ;
        dct:hasPart ?dep .
    ?dep dstack:abgebildetAuf ?el .
    ?el a dstack:StackElement ;
        skos:prefLabel ?element ;
        dct:subject/skos:prefLabel ?kategorie ;
        dstack:konformitaet/dstack:wertProzent ?w .
} GROUP BY ?el ?element ?kategorie ORDER BY ?wert ?element`
    : `# Die von diesem Repository genutzten D-Stack-Elemente, bewertet nach "${crit.label}" (0-100 %)
SELECT DISTINCT ?el ?element ?kategorie ?wert WHERE {
    ?repo a schema:SoftwareSourceCode ;
        dct:title "${sparqlStr(titel)}"@de ;
        dct:hasPart ?dep .
    ?dep dstack:abgebildetAuf ?el .
    ?el a dstack:StackElement ;
        skos:prefLabel ?element ;
        dct:subject/skos:prefLabel ?kategorie ;
        dstack:konformitaet ?a .
    ?a dstack:kriterium <${crit.iri}> ;
        dstack:wertProzent ?wert .
} ORDER BY ?wert ?element`

const renderScores = async () => {
    const titel = $("repo-picker").value
    const crit = CRITERIA.find(c => c.label === $("kriterium-picker").value) || { label: GESAMT }
    const q = scoreQ(titel, crit)
    const rows = await select(q)
    const items = rows.map(r => {
        const pct = `${crit.label === GESAMT ? "Ø " : ""}${Math.round(Number(r.wert))} %`
        return `<li><b>${esc(pct)}</b> &nbsp;${esc(r.element)} <span class="muted">· ${esc(r.kategorie)}</span></li>`
    }).join("")
    $("scores").innerHTML = runLink(q) + (items
        ? `<p class="answer-head">Die genutzten D-Stack-Bausteine ${crit.label === GESAMT ? "im Gesamt-Durchschnitt" : `nach "${esc(crit.label)}"`} bewertet:</p>
           <ul class="answer-list">${items}</ul>`
        : `<p class="muted">Dieses Repository nutzt keine bewertbaren D-Stack-Elemente (nur proprietäre oder nicht erkannte Bausteine).</p>`)
}

// --- 4) how this slots into openCode's live badge system + the crosswalk to the D-Stack criteria ---
// openCode already badges repos in five dimensions (BSI/ZenDiS); each is crosswalked to a D-Stack
// Kriterium, so the three the D-Stack adds (Souveränität / Interoperabilität / Zukunftsfähigkeit)
// fall out of the data. The sixth badge is a clearly-marked proposal of this prototype.
const BADGES_Q = `# Die fünf bestehenden openCode-Badges (je mit einem D-Stack-Kriterium verknüpft) plus der
# vorgeschlagene sechste. So wird abfragbar, wo sich die beiden Systeme überschneiden.
SELECT ?badge ?label ?vorschlag ?krit ?matchTyp WHERE {
    ?badge a dstack:OpenCodeBadge ;
        rdfs:label ?label .
    OPTIONAL { ?badge dstack:vorgeschlagen ?vorschlag }
    OPTIONAL {
        { ?badge skos:closeMatch ?k . BIND("entspricht" AS ?matchTyp) }
        UNION { ?badge skos:relatedMatch ?k . BIND("verwandt mit" AS ?matchTyp) }
        ?k skos:prefLabel ?krit .
    }
}`

// each D-Stack criterion: is it already covered by an openCode badge (skos:closeMatch)?
const AXES_Q = `SELECT ?kriterium ?abgedeckt WHERE {
    ?k a dstack:Kriterium ;
        skos:prefLabel ?kriterium .
    BIND(EXISTS { ?b a dstack:OpenCodeBadge ; skos:closeMatch ?k } AS ?abgedeckt)
} ORDER BY ?kriterium`

const renderEinbettung = async () => {
    const [badgeRows, axesRows] = await Promise.all([select(BADGES_Q), select(AXES_Q)])
    // one entry per badge (each carries at most one crosswalk)
    const badges = new Map()
    for (const r of badgeRows) {
        if (!badges.has(r.badge)) badges.set(r.badge, { label: r.label, vorschlag: r.vorschlag === "true", krit: r.krit, matchTyp: r.matchTyp })
    }
    const ordered = [...badges.values()].sort((a, b) => a.vorschlag - b.vorschlag)   // real first, proposal last
    const badgeItem = (b) => {
        const tag = b.vorschlag ? ` <span class="bl-chip ds">Vorschlag</span>` : ` <span class="bl-chip">openCode</span>`
        const cross = b.krit ? `<span class="muted">${esc(b.matchTyp)} D-Stack-Kriterium „${esc(b.krit)}"</span>`
            : b.vorschlag ? `<span class="muted">ergänzt die Achsen, die openCode (noch) nicht badged</span>`
                : `<span class="muted">keine direkte Kriterien-Entsprechung</span>`
        return `<li><b>${esc(b.label)}</b>${tag}<br>${cross}</li>`
    }
    const abgedeckt = axesRows.filter(r => r.abgedeckt === "true").map(r => r.kriterium)
    const neu = axesRows.filter(r => r.abgedeckt !== "true").map(r => r.kriterium)
    $("einbettung").innerHTML = runLink(BADGES_Q) +
        `<p class="answer-head">Die fünf bestehenden openCode-Badges und der vorgeschlagene sechste:</p>
         <ul class="answer-list">${ordered.map(badgeItem).join("")}</ul>
         <p class="answer-head">Überschneidung mit den sechs D-Stack-Kriterien:</p>
         <p class="answer-list"><b>${abgedeckt.length}</b> badged openCode schon (${abgedeckt.map(esc).join(", ")}); die anderen <b>${neu.length}</b> (${neu.map(esc).join(", ")}) sind genau das, was der D-Stack-Badge ergänzt.</p>`
}

// --- 5) further questions the scan unlocks (links to the Query page, or the visual Erkunden view) ---
const GALLERY = [
    {
        // a deep-link into the Erkunden page, which pre-selects this question and lights up the subgraph
        render: () => `Wie ein reales Repository am Stack hängt, zeigt die <a class="run-link" href="../graph.html?frage=konformitaet" target="_blank" rel="noopener">visuelle Erkundung ↗</a>: die Abhängigkeiten des BMDS-Projekts SPARK und die D-Stack-Standards, die sie verkörpern, konform bis in die Landkarte oder ohne Anschluss.`,
    },
    {
        q: "Welche genutzten Bausteine sind verbindlich gefordert (von einem Standardbereich des IT-Planungsrats)?",
        sparql: `SELECT DISTINCT ?repo ?element WHERE {
    ?r a schema:SoftwareSourceCode ;
        dct:title ?repo ;
        dct:hasPart ?dep .
    ?dep dstack:abgebildetAuf ?el .
    ?sb a dstack:Standardbereich ;
        dstack:nenntStandard ?el .
    ?el skos:prefLabel ?element .
} ORDER BY ?repo ?element`,
    },
    {
        q: "Welche realen Standards nutzen die Repositories, die die Landkarte (noch) nicht führt?",
        sparql: `SELECT DISTINCT ?standard ?quelle WHERE {
    ?dep dstack:abgebildetAuf ?std .
    ?std a dstack:ReferenzierterStandard ;
        rdfs:label ?standard ;
        dstack:inLandkarte false .
    OPTIONAL { ?std dct:source ?quelle }
} ORDER BY ?standard`,
    },
    {
        q: "Welche Repositories sind frei von proprietären und blinden Befunden?",
        sparql: `SELECT ?repo WHERE {
    ?r a schema:SoftwareSourceCode ;
        dct:title ?repo .
    FILTER NOT EXISTS { ?r dct:hasPart/dstack:abgebildetAuf ?p . ?p a dstack:ProprietaeresProdukt }
    FILTER NOT EXISTS { ?r dct:hasPart/dstack:abgebildetAuf ?b . ?b dstack:inLandkarte false }
} ORDER BY ?repo`,
    },
]

// --- boot ---------------------------------------------------------------------------------------
const init = async () => {
    const [scan, verb, mf] = await Promise.all([select(SCAN_Q), select(VERBINDLICH_Q), select(MANIFEST_Q)])
    SCAN = scan
    VERB = new Set(verb.map(r => r.el))
    MF = new Map()
    for (const r of mf) {
        if (!MF.has(r.repo)) MF.set(r.repo, new Map())
        MF.get(r.repo).set(r.label, r.url)
    }
    // real projects first, so the picker defaults to a real project
    REPOS = [...new Map(SCAN.map(r => [r.titel, r])).values()]
        .map(r => ({ titel: r.titel, real: r.real === "true" }))
        .sort((a, b) => (b.real - a.real) || a.titel.localeCompare(b.titel))
    await loadCriteria()

    renderDashboard()

    // value stays the plain title (the lookup key); the visible text gets the real/Beispiel marker
    $("repo-picker").innerHTML = REPOS.map((r, i) => `<option value="${esc(r.titel)}"${i === 0 ? " selected" : ""}>${esc(r.titel)} [${r.real ? "real" : "Beispiel"}]</option>`).join("")
    // the repo picker drives the whole Steckbrief: both the findings and the per-repo Vergabe scores
    $("repo-picker").addEventListener("change", () => { renderAssessment(); renderScores() })
    renderAssessment()

    $("kriterium-picker").innerHTML = [...CRITERIA.map(c => c.label), GESAMT]
        .map(c => `<option${c === "Digitale Souveränität" || c === "Souveränität" ? " selected" : ""}>${esc(c)}</option>`).join("")
    $("kriterium-picker").addEventListener("change", renderScores)
    await renderScores()

    await renderEinbettung()
    renderGallery("gallery", GALLERY)
}
init().catch(e => { $("dashboard").innerHTML = `<p class="muted">Der Graph konnte nicht geladen werden: ${esc(e.message || e)}</p>` })
