// Use-case page: the 115 as a graph-fed Wissensbasis. The 115 beauskunftet Verwaltungsanliegen on
// the FIM-Leistungsbeschreibung — who is responsible (location-dependent!), what a service is — and,
// as the new IT-PLR-mandated layer (Beschluss 2023/11), the First-Level-Support für Onlinedienste.
// The Leistungen, zuständige Stellen, Lebenslagen, Gebühren (m8g:hasCost) and Onlinedienste are real
// (PVOG); the OD-support facts (Betriebsstatus, Hilfe-Ressourcen, Eskalation), the colloquial Stich-
// worte and the erforderlichen Unterlagen are a hand-authored stand-in (115-od-support.scenario.ttl)
// for the internal 115-Wissensdatenbank. Three moves: translate a caller's words
// into a Leistung, read the Auskunft, and let the graph name its own blind spots. Every answer hands
// you the exact SPARQL for the Query page.

import { useCase, esc, $ } from "./use-case.js"

const PRE = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX schema: <http://schema.org/>
PREFIX cpsv: <http://purl.org/vocab/cpsv#>
PREFIX m8g: <http://data.europa.eu/m8g/>
PREFIX fim: <https://deutschland-stack.gov.de/fim#>
PREFIX ds: <https://deutschland-stack.gov.de/id/>
PREFIX dstack: <https://deutschland-stack.gov.de/vocab#>`

const { select, queryLink, renderGallery } = useCase(PRE)

// status word -> the contextual note the agent would act on
const STATUS_NOTE = {
    "verfügbar": "Der Onlinedienst ist erreichbar; die 115 kann direkt darauf verweisen.",
    "gestört": "Aktuell gestört. Ein Frühwarnsystem (DIN SPEC 66336) meldet der 115 solche Ausfälle idealerweise schon, bevor der erste Bürger deswegen anruft. Der Agent bestätigt es dann sofort und übergibt an den technischen Second-Level-Support.",
    "nur lokal, nicht in der Wissensdatenbank": "Der 115 liegt zu diesem Dienst nichts vor (nur lokal bekanntgemacht). Sie kann nur beauskunften, was in der Wissensdatenbank steht.",
}

const runLinkP = (q, label = "Diese Abfrage ausführen") =>
    `<p><a class="run-link" href="${queryLink(q)}" target="_blank" rel="noopener">${label} ↗</a></p>`

const shorten = (t, n = 220) => t.length > n ? `${t.slice(0, t.lastIndexOf(" ", n)).trim()} …` : t

// --- 1) caller's words -> Leistung (the semantic translation) ----------------
// match the phrase against the Leistung's own labels: official title, synonym (skos:altLabel) or
// the misnomer people actually say (skos:hiddenLabel). The match is "the phrase contains a stored
// label", so it is the hinterlegte Stichwort that does the resolving, not the page.
const EXAMPLES = [
    "Ich fange einen neuen Job an und brauche ein polizeiliches Führungszeugnis.",
    "Ich würde mich gern selbstständig machen und ein Kleingewerbe anmelden.",
    "Wo kann ich online Mietzuschuss beantragen?",
    "Ich brauche einen Anwohnerparkausweis.",
]

const resolveQuery = (phrase) => `# Aus den Worten des Anrufers die passende Leistung und ihren Onlinedienst finden
SELECT DISTINCT ?l ?leistung ?art ?stichwort ?dienst ?url ?status ?ort WHERE {
    ?l a cpsv:PublicService ;
        dct:title ?leistung ;
        m8g:hasChannel ?od .
    { ?l dct:title ?stichwort . BIND("offizieller Titel" AS ?art) }
    UNION { ?l skos:altLabel ?stichwort . BIND("Synonym" AS ?art) }
    UNION { ?l skos:hiddenLabel ?stichwort . BIND("Volksmund" AS ?art) }
    FILTER(CONTAINS(LCASE("${phrase}"), LCASE(STR(?stichwort))))
    ?od dct:title ?dienst .
    OPTIONAL { ?od schema:url ?url }
    OPTIONAL { ?od dstack:betriebsstatus/skos:prefLabel ?status }
    OPTIONAL { ?l dct:spatial ?gebiet . ?gebiet rdfs:label ?ort }
} ORDER BY ?leistung`

// one Leistung can match several stored labels (e.g. a title that is a substring of a synonym);
// keep the most telling hit per Leistung: a synonym/Volksmund over the plain title, then the longest.
const bestPerLeistung = (rows) => {
    const rank = (r) => (r.art === "offizieller Titel" ? 0 : 1000) + r.stichwort.length
    const byL = new Map()
    for (const r of rows) { const c = byL.get(r.l); if (!c || rank(r) > rank(c)) byL.set(r.l, r) }
    return [...byL.values()]
}

const renderAnliegen = async (phrase) => {
    $("anliegen-out").innerHTML = `<p class="muted">Wird aus dem Graphen gesucht …</p>`
    const q = resolveQuery(phrase)
    const hits = bestPerLeistung(await select(q))
    if (!hits.length) {
        $("anliegen-out").innerHTML = `<p class="answer-head">Kein Stichwort-Treffer für »${esc(phrase)}«.</p>
            ${runLinkP(q, "Abfrage ansehen")}`
        return
    }
    const items = hits.map(r => `<li><b>${esc(r.leistung)}</b>${r.ort ? ` <span class="muted">(${esc(r.ort)})</span>` : ""} &mdash; gefunden über das hinterlegte Stichwort »${esc(r.stichwort)}« (${esc(r.art)}).<br>
        Onlinedienst: ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.dienst)}</a>` : esc(r.dienst)}
        ${r.status ? ` &middot; Status: <b>${esc(r.status)}</b>` : ""}</li>`).join("")
    $("anliegen-out").innerHTML = `<p class="answer-head">Anliegen: »${esc(phrase)}«</p>
        <ul class="answer-list">${items}</ul>
        ${runLinkP(q, "Diese Abfrage ausführen")}`
}

const renderExampleButtons = () => {
    $("anliegen-buttons").innerHTML = EXAMPLES.map((e, i) =>
        `<button class="elbtn" data-i="${i}">${esc(e)}</button>`).join("")
    $("anliegen-buttons").querySelectorAll(".elbtn").forEach(b => b.addEventListener("click", () => {
        $("anliegen-buttons").querySelectorAll(".elbtn").forEach(x => x.classList.toggle("active", x === b))
        renderAnliegen(EXAMPLES[b.dataset.i])
    }))
}

// --- 2) the Auskunft for one Leistung ----------------------------------------
// general Beauskunftung (real: description, Lebenslagen, Gebühren via m8g:hasCost) + the new
// Onlinedienst layer and the erforderlichen Unterlagen (scenario: status, Hilfe, Eskalation,
// cpsv:hasInput). Zuständigkeit is fetched separately (a Leistung can have dozens of Stellen, one
// per Bezirk) so it doesn't multiply the card rows. Cost comes in two shapes: PVOG's free-text
// dct:description (empties filtered) or, for the hand-added Führungszeugnis fee, a structured
// m8g:value + m8g:currency (reified for provenance); the card prefers the structured amount.
const karteQuery = (iri) => `# Die 115-Auskunft zu einer Leistung: Beschreibung, Lebenslage, Gebühren, Unterlagen und der Onlinedienst (Status, Hilfe, Eskalation)
SELECT ?leistung ?beschreibung ?dienst ?url ?status ?leika ?ort ?lebenslage ?kosten ?kostenWert ?kostenWaehrung ?unterlage ?hilfeTyp ?hilfeLabel ?hilfeUrl ?slsTyp ?slsLabel WHERE {
    BIND(<${iri}> AS ?l)
    ?l dct:title ?leistung ;
        m8g:hasChannel ?od .
    ?od dct:title ?dienst .
    OPTIONAL { ?l dct:description ?beschreibung }
    OPTIONAL { ?l fim:leikaId ?leika }
    OPTIONAL { ?l dct:spatial ?gebiet . ?gebiet rdfs:label ?ort }
    OPTIONAL { ?l m8g:isGroupedBy/dct:title ?lebenslage }
    OPTIONAL { ?l m8g:hasCost ?c .
        OPTIONAL { ?c dct:description ?kosten . FILTER(STR(?kosten) != "") }
        OPTIONAL { ?c m8g:value ?kostenWert ; m8g:currency ?kostenWaehrung }
    }
    OPTIONAL { ?l cpsv:hasInput ?ev . ?ev dct:title ?unterlage }
    OPTIONAL { ?od schema:url ?url }
    OPTIONAL { ?od dstack:betriebsstatus/skos:prefLabel ?status }
    OPTIONAL { ?od dstack:hilfeRessource ?h . ?h dct:type ?hilfeTyp ; rdfs:label ?hilfeLabel . OPTIONAL { ?h schema:url ?hilfeUrl } }
    OPTIONAL { ?od dstack:zweitLevelKontakt ?k . ?k schema:contactType ?slsTyp ; rdfs:label ?slsLabel }
}`

const stellenQuery = (iri) => `# Wer ist für diese Leistung zuständig? (Die 115 grenzt nach dem Wohnort des Anrufers ein.)
SELECT ?stelle WHERE {
    <${iri}> m8g:hasCompetentAuthority ?o .
    ?o skos:prefLabel ?stelle .
} ORDER BY ?stelle`

let services = []

const loadServices = async () => {
    services = await select(`SELECT DISTINCT ?l ?leistung WHERE {
        ?l a cpsv:PublicService ;
            dct:title ?leistung ;
            m8g:hasChannel ?od .
        ?od dstack:betriebsstatus ?st .
    } ORDER BY ?leistung`)
}

const renderKarteControls = () => {
    $("karte-picker").innerHTML = services.map(s => `<option value="${esc(s.l)}">${esc(s.leistung)}</option>`).join("")
    $("karte-picker").addEventListener("change", () => renderKarte($("karte-picker").value))
}

const zustaendigkeitBlock = (stellen, qStellen, ort) => {
    if (!stellen.length) return ""
    const names = stellen.map(s => s.stelle)
    const shown = names.slice(0, 4).map(n => `<li>${esc(n)}</li>`).join("")
    const rest = names.length > 4 ? `<li class="muted">… und ${names.length - 4} weitere</li>` : ""
    const hint = names.length > 1
        ? `<p class="comms-hinweis">${names.length} zuständige Stellen; die 115 grenzt anhand des Wohnorts ein.</p>`
        : ""
    return `<div class="reach-group">
        <p class="reach-head">Zuständigkeit${ort ? ` <span class="reach-src">${esc(ort)}</span>` : ""}</p>
        ${hint}
        <ul class="reach-list">${shown}${rest}</ul>
        ${runLinkP(qStellen, "Zuständigkeiten abfragen")}
    </div>`
}

const renderKarte = async (iri) => {
    const q = karteQuery(iri), qS = stellenQuery(iri)
    const [rows, stellen] = await Promise.all([select(q), select(qS)])
    if (!rows.length) { $("karte-out").innerHTML = `<p class="muted">Keine Daten zu dieser Leistung.</p>`; return }
    const r0 = rows[0]
    const uniq = (key, keep) => [...new Map(rows.filter(r => r[key]).map(r => [r[key], keep(r)])).values()]
    const lebenslagen = [...new Set(rows.filter(r => r.lebenslage).map(r => r.lebenslage))].join(" · ")
    const unterlagen = uniq("unterlage", r => `<li>${esc(r.unterlage)}</li>`)
    // a Leistung can carry two m8g:Cost (PVOG's free-text one + the hand-added structured one),
    // so scan all rows rather than trusting r0; the structured amount wins.
    const kostenWertRow = rows.find(r => r.kostenWert)
    const kostenTextRow = rows.find(r => r.kosten)
    const kosten = kostenWertRow
        ? `${esc(kostenWertRow.kostenWert)} ${esc(kostenWertRow.kostenWaehrung || "EUR")}`
        : (kostenTextRow ? esc(shorten(kostenTextRow.kosten, 140)) : "")
    const hilfen = uniq("hilfeLabel", r => r.hilfeUrl
        ? `<li>${esc(r.hilfeTyp)}: <a href="${esc(r.hilfeUrl)}" target="_blank" rel="noopener">${esc(r.hilfeLabel)}</a></li>`
        : `<li>${esc(r.hilfeTyp)}: ${esc(r.hilfeLabel)}</li>`)
    const sls = uniq("slsLabel", r => `<li>${esc(r.slsTyp)}: ${esc(r.slsLabel)}</li>`)
    const note = STATUS_NOTE[r0.status] || ""
    $("karte-out").innerHTML = `
        <p class="bericht-title">Steckbrief zu »${esc(r0.leistung)}«</p>
        ${r0.beschreibung ? `<p class="bericht-intro">${esc(shorten(r0.beschreibung))}</p>` : ""}
        ${zustaendigkeitBlock(stellen, qS, r0.ort)}
        ${lebenslagen ? `<div class="reach-group"><p class="reach-head">Lebenslage</p><p>${esc(lebenslagen)}</p></div>` : ""}
        ${kosten ? `<div class="reach-group"><p class="reach-head">Gebühren</p><p>${kosten}</p></div>` : ""}
        ${unterlagen.length ? `<div class="reach-group"><p class="reach-head">Erforderliche Unterlagen <span class="reach-src">Szenario</span></p><ul class="reach-list">${unterlagen.join("")}</ul></div>` : ""}
        <div class="reach-group">
            <p class="reach-head">Onlinedienst <span class="reach-src">neue Schicht</span></p>
            <p>${r0.url ? `<a href="${esc(r0.url)}" target="_blank" rel="noopener">${esc(r0.dienst)}</a>` : esc(r0.dienst)}${r0.leika ? ` &middot; LeiKa-ID ${esc(r0.leika)}` : ""} &middot; Status: <b>${esc(r0.status || "unbekannt")}</b></p>
            ${note ? `<p class="comms-hinweis">${esc(note)}</p>` : ""}
            ${hilfen.length ? `<ul class="reach-list">${hilfen.join("")}</ul>` : ""}
        </div>
        ${sls.length ? `<div class="reach-group"><p class="reach-head">Eskalation</p><ul class="reach-list">${sls.join("")}</ul></div>` : ""}
        <p class="comms-foot"><a class="run-link" href="${queryLink(q)}" target="_blank" rel="noopener">Diese Abfrage ausführen ↗</a></p>`
}

// --- 3) the graph naming its own blind spots ---------------------------------
const GESTOERT_Q = `# Welche Onlinedienste sind gerade gestört? (das, was ein Frühwarnsystem meldet)
SELECT ?leistung ?dienst ?url WHERE {
    ?l a cpsv:PublicService ;
        dct:title ?leistung ;
        m8g:hasChannel ?od .
    ?od dstack:betriebsstatus ds:status-gestoert ;
        dct:title ?dienst .
    OPTIONAL { ?od schema:url ?url }
} ORDER BY ?leistung`

const NICHT_ERFASST_Q = `# Welche Leistungen kann die 115 nicht beauskunften, weil ihr Onlinedienst nur lokal bekannt ist?
SELECT ?leistung ?dienst WHERE {
    ?l a cpsv:PublicService ;
        dct:title ?leistung ;
        m8g:hasChannel ?od .
    ?od dstack:betriebsstatus ds:status-nicht-erfasst ;
        dct:title ?dienst .
} ORDER BY ?leistung`

const renderLuecken = async () => {
    const [gestoert, fehlt] = await Promise.all([select(GESTOERT_Q), select(NICHT_ERFASST_Q)])
    const list = (rows, fmt) => rows.length
        ? `<ul class="reach-list">${rows.map(fmt).join("")}</ul>`
        : `<p class="muted">Aktuell keine.</p>`
    $("luecken-out").innerHTML = `
        <div class="reach-group">
            <p class="reach-head">Gerade gestört <span class="reach-src">Frühwarnsystem</span></p>
            <p class="comms-hinweis">Den Ausfall kennt die 115 über ein Frühwarnsystem idealerweise schon, bevor der erste Bürger deswegen anruft; sie bestätigt ihn dann sofort und verweist auf den analogen Weg oder eskaliert.</p>
            ${list(gestoert, r => `<li><b>${esc(r.leistung)}</b> &mdash; ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.dienst)}</a>` : esc(r.dienst)}</li>`)}
            ${runLinkP(GESTOERT_Q, "Abfrage ausführen")}
        </div>
        <div class="reach-group">
            <p class="reach-head">Nur lokal, der 115 nicht bekannt <span class="reach-src">blinder Fleck</span></p>
            <p class="comms-hinweis">Hier kann die 115 nichts sagen: der Onlinedienst hat es nie in die Wissensdatenbank geschafft.</p>
            ${list(fehlt, r => `<li><b>${esc(r.leistung)}</b> &mdash; ${esc(r.dienst)}</li>`)}
            ${runLinkP(NICHT_ERFASST_Q, "Abfrage ausführen")}
        </div>`
}

// --- 4) more questions the join unlocks --------------------------------------
const GALLERY = [
    {
        q: "Wie viele Stellen sind je Leistung zuständig? (Warum der Wohnort zählt.)",
        sparql: `SELECT ?leistung (COUNT(DISTINCT ?o) AS ?zustaendige_stellen) WHERE {
    ?l a cpsv:PublicService ;
        dct:title ?leistung ;
        m8g:hasCompetentAuthority ?o .
} GROUP BY ?l ?leistung ORDER BY DESC(?zustaendige_stellen)`,
    },
    {
        q: "Über welche Stichworte würde ein Agent das Führungszeugnis finden?",
        sparql: `SELECT ?stichwort WHERE {
    ds:leistung-B100019-LB-577649 dct:title|skos:altLabel|skos:hiddenLabel ?stichwort
}`,
    },
    {
        q: "Welche Unterlagen verlangt welche Leistung? (Erforderliche Unterlagen, Szenario.)",
        sparql: `SELECT ?leistung ?unterlage WHERE {
    ?l a cpsv:PublicService ;
        dct:title ?leistung ;
        cpsv:hasInput ?ev .
    ?ev dct:title ?unterlage .
} ORDER BY ?leistung`,
    },
    {
        q: "Was kostet welche Leistung? (Gebühren über alle Leistungen, als PVOG-Freitext oder strukturierter Betrag.)",
        sparql: `SELECT ?leistung ?gebuehr WHERE {
    ?l a cpsv:PublicService ;
        dct:title ?leistung ;
        m8g:hasCost ?c .
    { ?c dct:description ?gebuehr . FILTER(STR(?gebuehr) != "") }
    UNION
    { ?c m8g:value ?betrag ; m8g:currency ?waehrung . BIND(CONCAT(STR(?betrag), " ", ?waehrung) AS ?gebuehr) }
} ORDER BY ?leistung`,
    },
    {
        q: "Welche Kostenangabe ist von Hand ergänzt, und mit welcher Quelle? (selbst-belegte m8g:Cost)",
        sparql: `SELECT ?leistung ?betrag ?waehrung ?quelle ?hinweis WHERE {
    ?l a cpsv:PublicService ;
        dct:title ?leistung ;
        m8g:hasCost ?c .
    ?c m8g:value ?betrag ;
        dct:source ?quelle ;
        rdfs:comment ?hinweis .
    OPTIONAL { ?c m8g:currency ?waehrung }
} ORDER BY ?leistung`,
    },
    {
        q: "Welche Hilfe-Ressourcen sind je Onlinedienst hinterlegt (Handbuch, FAQ, Anleitung)?",
        sparql: `SELECT ?dienst ?typ ?ressource WHERE {
    ?od dstack:hilfeRessource ?h ;
        dct:title ?dienst .
    ?h dct:type ?typ ;
        rdfs:label ?ressource .
} ORDER BY ?dienst`,
    },
    {
        q: "An welchen Second-Level-Support eskaliert welcher Onlinedienst?",
        sparql: `SELECT ?dienst ?kontakttyp ?kontakt WHERE {
    ?od dstack:zweitLevelKontakt ?k ;
        dct:title ?dienst .
    ?k schema:contactType ?kontakttyp ;
        rdfs:label ?kontakt .
} ORDER BY ?dienst`,
    },
]

// --- boot --------------------------------------------------------------------
const init = async () => {
    renderExampleButtons()
    $("anliegen-buttons").querySelector(".elbtn")?.classList.add("active")
    await renderAnliegen(EXAMPLES[0])
    await loadServices()
    if (services[0]) { renderKarteControls(); await renderKarte(services[0].l) }
    await renderLuecken()
    renderGallery("gallery", GALLERY)
}
init().catch(e => { $("anliegen-out").innerHTML = `<p class="muted">Der Graph konnte nicht geladen werden: ${esc(e.message || e)}</p>` })
