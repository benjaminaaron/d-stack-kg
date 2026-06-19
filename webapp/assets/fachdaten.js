// Use-case page: the FIM + FIT-Connect depth layer. Each Leistung (by LeiKa) is assembled
// live from three federal sources that don't link to each other — FIM Portal (what it is +
// which law), FIT-Connect (which authority receives it digitally, in which Fachdatenschema)
// and XRepository (the data standard). The join key is REAL (the LeiKa-ID), not an assumed
// bridge. The one small bridge is dstack:serialisiertAls: the data FORMAT (XML/JSON) is a
// Landkarte tile, even where the domain standard (XSozial) is not. Every answer runs live and
// hands you the exact SPARQL to run on the Query page.

import { graphStore } from "./graph.js"
import { queryEngine } from "@foerderfunke/sem-ops-utils/sparql"

const store = graphStore()

const PRE = `PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX cpsv: <http://purl.org/vocab/cpsv#>
PREFIX ds: <https://deutschland-stack.gov.de/id/>
PREFIX dstack: <https://deutschland-stack.gov.de/vocab#>
PREFIX fim: <https://deutschland-stack.gov.de/fim#>
PREFIX fitconnect: <https://deutschland-stack.gov.de/fit-connect#>`

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
const $ = (id) => document.getElementById(id)
const queryLink = (q) => "../query.html?query=" + encodeURIComponent(PRE + "\n\n" + q)
const runLink = (q, label = "Diese Abfrage ausführen") => `<p><a class="run-link" href="${queryLink(q)}" target="_blank" rel="noopener">${label} ↗</a></p>`

// --- 1) Leistung picker -> profile assembled from FIM + FIT-Connect (+ XRepository) ----
let leistungen = []

const loadLeistungen = async () => {
    leistungen = await select(`SELECT ?l ?title WHERE {
        ?l fitconnect:zustellpunkt ?zp ; dct:title ?title .
    } ORDER BY ?title`)
}

const baseQuery = (iri) => `# Die Leistung selbst: FIM-Stamminformation, Zustellpunkt-Plattform und empfangende Region (FIT-Connect)
SELECT ?rechtsgrundlage ?themenfeld ?plattform ?region ?regionName WHERE {
    BIND(<${iri}> AS ?l)
    OPTIONAL { ?l cpsv:follows/dct:description ?rechtsgrundlage }
    OPTIONAL { ?l dct:subject/skos:prefLabel ?themenfeld }
    OPTIONAL { ?l fitconnect:zustellpunkt ?zp .
        OPTIONAL { ?zp fitconnect:plattform ?plattform }
        OPTIONAL { ?zp dct:spatial ?region . OPTIONAL { ?region skos:prefLabel ?regionName } }
    }
}`

// a Leistung can carry several Fachdatenschemata — e.g. a bespoke vendor schema via a real
// Zustellpunkt AND the central FIM-library schema for the same Leistung (dct:provenance marks which)
const schemasQuery = (iri) => `# Jedes Fachdatenschema, dem die Einreichung dieser Leistung genügen muss
SELECT ?fds ?fachdatenschema ?format ?provenance ?landkarteFormat ?formatTile ?landkarteItemId WHERE {
    <${iri}> dct:conformsTo ?fds .
    ?fds rdfs:label ?fachdatenschema ; dct:format ?format .
    OPTIONAL { ?fds dct:provenance ?provenance }
    OPTIONAL {
        ?fds dstack:serialisiertAls ?formatTile .
        ?formatTile skos:prefLabel ?landkarteFormat .
        OPTIONAL { ?formatTile dstack:landkarteItemId ?landkarteItemId }
    }
} ORDER BY ?fachdatenschema`

const fieldsQuery = (fds) => `# Der Datenfeldbaum eines Fachdatenschemas — Gruppen, Felder und
# (wo der FIM-Baustein zentral veröffentlicht ist) der Link auf seine FIM-Portal-Seite
SELECT ?node ?parent ?label ?identifier ?baustein ?fimportal ?istGruppe WHERE {
    BIND(<${fds}> AS ?fds)
    ?fds (fim:datenfeld)+ ?node .
    ?parent fim:datenfeld ?node .
    ?node rdfs:label ?label ; dct:identifier ?identifier .
    BIND(EXISTS { ?node a fim:Datenfeldgruppe } AS ?istGruppe)
    OPTIONAL { ?node fim:baustein ?baustein }
    OPTIONAL { ?node rdfs:seeAlso ?fimportal }
} ORDER BY ?label`

// the live Tech-Stack-Landkarte: a tile's deep-link is /?item=<landscape2 item id>
const TECH_LANDKARTE = "https://technologie.deutschland-stack.gov.de/?item="

// each node names the FIM Baukasten block it cites, by the kind its id prefix encodes
// (G… = Datenfeldgruppe, F… = Datenfeld): linked to its FIM Portal page where the id is
// central, else flagged as a block the schema leans on but that isn't centrally published
const fieldId = (f) => {
    if (!f.baustein) return `<code>${esc(f.identifier)}</code>`
    const kind = f.baustein.startsWith("G") ? "FIM-Datenfeldgruppe" : "FIM-Datenfeld"
    const id = `${kind} ${esc(f.baustein)}`
    return f.fimportal
        ? `<a href="${esc(f.fimportal)}" target="_blank" rel="noopener">${id} ↗</a>`
        : `${id} <span class="muted">(nicht zentral)</span>`
}
// rebuild a schema's field tree from its flat (node, parent) rows and render it nested; each
// Datenfeldgruppe is a <details> collapsed by default (the trees get long), leaves are plain
const renderNodes = (fields, parent) => {
    const kids = fields.filter(f => f.parent === parent)
    if (!kids.length) return ""
    return `<ul class="answer-list">${kids.map(f => {
        const meta = `<span class="muted">· ${fieldId(f)}</span>`
        return f.istGruppe === "true"
            ? `<li class="grp"><details><summary><b>${esc(f.label)}</b> ${meta}</summary>${renderNodes(fields, f.node)}</details></li>`
            : `<li>${esc(f.label)} ${meta}</li>`
    }).join("")}</ul>`
}

const renderProfile = async (iri, title) => {
    const [b = {}] = await select(baseQuery(iri))
    const schemas = await select(schemasQuery(iri))
    const ars = (b.region || "").split("/").pop()
    const baseLines = [
        ["Bezeichnung (FIM)", esc(title)],
        b.rechtsgrundlage && ["Rechtsgrundlage (FIM)", esc(b.rechtsgrundlage)],
        b.themenfeld && ["OZG-Themenfeld (FIM)", esc(b.themenfeld)],
        b.plattform && ["Zustellpunkt (FIT-Connect)", esc(b.plattform)],
        b.region && ["Empfangende Region (FIT-Connect)",
            b.regionName ? `${esc(b.regionName)} <span class="muted">(ARS ${esc(ars)})</span>` : `ARS ${esc(ars)}`],
    ].filter(Boolean)
    // one self-contained card per Fachdatenschema. The same Leistung can carry a vendor schema (via a
    // Zustellpunkt) next to the central FIM-library schema: granular both, central-vs-local Bausteine.
    // Each card ends with its own field-query link, so it is clear which query belongs to which schema.
    const cards = []
    for (const s of schemas) {
        const fields = await select(fieldsQuery(s.fds))
        const root = (fields.find(f => f.parent.includes("/fachdatenschema-")) || {}).parent
        const herkunft = s.provenance ? "aus der FIM-Bibliothek" : "über FIT-Connect-Zustellpunkt"
        const format = s.landkarteFormat
            ? (s.landkarteItemId
                ? `<a href="${TECH_LANDKARTE}${esc(s.landkarteItemId)}" target="_blank" rel="noopener">${esc(s.landkarteFormat)} ↗</a>`
                : esc(s.landkarteFormat))
            : esc(s.format)
        const tree = fields.length
            ? `<p class="answer-head">Datenfelder <span class="muted">(Gruppen aufklappen)</span></p>` +
              renderNodes(fields, root) +
              runLink(fieldsQuery(s.fds), "Diese Datenfelder per Abfrage abrufen")
            : `<p class="muted">Generisches Standardschema, kein leistungsspezifisches Feldschema
                 (die Felder stammen aus dem gemeinsamen XSozial-Basis-Baukasten).</p>`
        cards.push(
            `<div class="schema-card">
                <p class="answer-head"><b>Fachdatenschema:</b> ${esc(s.fachdatenschema)}
                    <span class="muted">(${herkunft})</span></p>
                <ul class="answer-list"><li><b>Format in der Tech-Stack-Landkarte:</b> ${format}</li></ul>
                ${tree}
            </div>`)
    }
    $("profile").innerHTML =
        `<ul class="answer-list">${baseLines.map(([k, v]) => `<li><b>${k}:</b> ${v}</li>`).join("")}</ul>` +
        runLink(baseQuery(iri), "Diese Stammdaten per Abfrage abrufen") +
        cards.join("")
}

// some FIM titles run ~140 chars (the Bildung-und-Teilhabe ones differ only at the very end),
// which blows the native dropdown out to full width. Shorten with a middle ellipsis — keep the
// head and the distinguishing tail — for the option label only; the full name shows in the profile.
const shortLabel = (s) => {
    if (s.length <= 70) return s
    const head = s.slice(0, 40).replace(/\s+\S*$/, "")
    const tail = s.slice(-32).replace(/^\S*\s+/, "")
    return `${head} … ${tail}`
}

const renderPicker = () => {
    $("leistung-picker").innerHTML = leistungen.map(l => `<option value="${esc(l.l)}" title="${esc(l.title)}">${esc(shortLabel(l.title))}</option>`).join("")
    $("leistung-picker").addEventListener("change", e => {
        const l = leistungen.find(x => x.l === e.target.value)
        renderProfile(l.l, l.title)
    })
}

// --- 2) Zustellpunkte, two data philosophies, joined with the FIM OZG-Themenfeld -----
const PHILOSOPHY_Q = `# Je Zustellpunkt: wie viele Leistungen teilen sich wie viele Fachdatenschemata,
# und in welchem OZG-Themenfeld (aus dem FIM-Steckbrief) liegen sie? (FIM × FIT-Connect)
SELECT ?zustellpunkt ?plattform ?region ?regionName (COUNT(DISTINCT ?l) AS ?leistungen) (COUNT(DISTINCT ?fds) AS ?schemata)
       (GROUP_CONCAT(DISTINCT ?label; separator=" · ") AS ?fachdatenschemata)
       (GROUP_CONCAT(DISTINCT ?themenfeld; separator=" · ") AS ?themenfelder) WHERE {
    ?l fitconnect:zustellpunkt ?zustellpunkt ; dct:conformsTo ?fds .
    ?fds rdfs:label ?label .
    FILTER NOT EXISTS { ?fds dct:provenance ?p }   # nur über den Zustellpunkt deklarierte Schemata, nicht die FIM-Vergleichsschemata
    OPTIONAL { ?l dct:subject/skos:prefLabel ?themenfeld }   # OZG-Themenfeld aus dem FIM-Steckbrief (fehlt, wo keine LeiKa)
    OPTIONAL { ?zustellpunkt fitconnect:plattform ?plattform } # Plattform/Standard hinter dem Zustellpunkt (aus der Schema-URI)
    OPTIONAL { ?zustellpunkt dct:spatial ?region . OPTIONAL { ?region skos:prefLabel ?regionName } }  # Region (ARS) + Klarname
} GROUP BY ?zustellpunkt ?plattform ?region ?regionName ORDER BY DESC(?leistungen)`

const renderPhilosophies = async () => {
    const rows = await select(PHILOSOPHY_Q)
    const card = (r) => {
        const verdict = Number(r.leistungen) > Number(r.schemata)
            ? "<b>ein generischer Standard</b> für alle Leistungen"
            : "<b>je Leistung ein eigenes Schema</b>"
        const themenfeld = r.themenfelder
            ? `OZG-Themenfeld (FIM): ${esc(r.themenfelder.split(" · ").join(", "))}`
            : "ohne OZG-Themenfeld (keine LeiKa, kein FIM-Steckbrief)"
        const list = r.fachdatenschemata.split(" · ")
        const schemata = (list.length === 1 ? "Fachdatenschema: " : "Fachdatenschemata: ") + list.map(esc).join(", ")
        const destId = (r.zustellpunkt || "").split("zustellpunkt-").pop()
        const ars = (r.region || "").split("/").pop()
        const region = r.regionName ? `${esc(r.regionName)} (ARS ${esc(ars)})` : (ars ? `Region ARS ${esc(ars)}` : "")
        const head = r.plattform ? esc(r.plattform) : "Zustellpunkt"
        return `<li class="phil-card"><b>${head}</b>${region ? ` <span class="muted">· ${region}</span>` : ""}
            <div><b>${esc(r.leistungen)}</b> Leistung(en), <b>${esc(r.schemata)}</b> Fachdatenschema(ta): ${verdict}</div>
            <div class="muted">${themenfeld}</div>
            <div class="muted">${schemata}</div>
            <div class="muted">Zustellpunkt <code>${esc(destId)}</code></div></li>`
    }
    $("philosophies").innerHTML = runLink(PHILOSOPHY_Q) +
        `<p class="answer-head">Reale Zustellpunkte, ihre zwei gegensätzlichen Modellierungs-Philosophien und ihr OZG-Themenfeld:</p>
         <ul class="answer-list">${rows.map(card).join("")}</ul>`
}

// --- 3) further questions the join unlocks (links to the Query page) ----------
const GALLERY = [
    {
        q: "Jede eingepflegte Leistung mit ihrem Gesetz und ihrem Fachdatenschema",
        sparql: `SELECT ?leistung ?gesetz ?fachdatenschema WHERE {
    ?l dct:title ?leistung ;
        cpsv:follows/dct:description ?gesetz ;
        dct:conformsTo/rdfs:label ?fachdatenschema .
} ORDER BY ?leistung`,
    },
    {
        q: "Welche Datenfelder müssen für welche Leistung eingereicht werden?",
        sparql: `SELECT ?leistung ?datenfeld ?fimBaustein ?fimPortalSeite WHERE {
    ?l dct:title ?leistung ;
        dct:conformsTo/(fim:datenfeld)+ ?df .
    ?df a fim:Datenfeld ; rdfs:label ?datenfeld .
    OPTIONAL { ?df fim:baustein ?fimBaustein }
    OPTIONAL { ?df rdfs:seeAlso ?fimPortalSeite }
} ORDER BY ?leistung ?datenfeld`,
    },
    {
        q: "Welche FIM-Bausteine, auf die sich ein reales Schema stützt, fehlen im zentralen FIM-Baukasten und sind damit weder auflösbar noch wiederverwendbar?",
        sparql: `SELECT ?leistung ?baustein ?feld WHERE {
    ?l dct:title ?leistung ;
        dct:conformsTo/(fim:datenfeld)+ ?node .
    ?node fim:baustein ?baustein ; rdfs:label ?feld .
    FILTER NOT EXISTS { ?node rdfs:seeAlso ?seite }
} ORDER BY ?leistung ?feld`,
    },
    {
        q: "Welche zentralen FIM-Bausteine teilen sich mehrere Leistungen?",
        sparql: `SELECT ?baustein ?bezeichnung (COUNT(DISTINCT ?l) AS ?leistungen) WHERE {
    ?l dct:conformsTo/(fim:datenfeld)+ ?node .
    ?node fim:baustein ?baustein ; rdfs:seeAlso ?seite .
    {   # eine echte Bezeichnung wählen, nicht die bloße Baustein-ID (manche Schemata geben dem Feld keinen Titel)
        SELECT ?baustein (SAMPLE(?lbl) AS ?bezeichnung) WHERE {
            ?n fim:baustein ?baustein ; rdfs:label ?lbl .
            FILTER(STR(?lbl) != STR(?baustein))
        } GROUP BY ?baustein
    }
} GROUP BY ?baustein ?bezeichnung HAVING (COUNT(DISTINCT ?l) > 1) ORDER BY DESC(?leistungen)`,
    },
    {
        q: "Welche Leistungen und welche Regionen hingen an einem Fachdatenschema, wenn es geändert werden müsste?",
        sparql: `SELECT ?fachdatenschema
    (COUNT(DISTINCT ?l) AS ?betroffene_leistungen)
    (GROUP_CONCAT(DISTINCT ?regionLabel; separator=", ") AS ?regionen) WHERE {
    ?l dct:conformsTo ?fds ;
        fitconnect:zustellpunkt ?zp .
    ?fds rdfs:label ?fachdatenschema .
    FILTER NOT EXISTS { ?fds dct:provenance ?p }   # nur über den Zustellpunkt deklarierte Schemata
    ?zp dct:spatial ?region .
    OPTIONAL { ?region skos:prefLabel ?regionName }   # Klarname der Region (Land/Kreis/Gemeinde), Fallback: ARS
    BIND(COALESCE(?regionName, REPLACE(STR(?region), "^.*/", "")) AS ?regionLabel)
} GROUP BY ?fachdatenschema ORDER BY DESC(?betroffene_leistungen)`,
    },
]

const renderGallery = () => {
    $("gallery").innerHTML = `<ul>${GALLERY.map(g => `<li>${esc(g.q)}
        <a class="run-link" href="${queryLink(g.sparql)}" target="_blank" rel="noopener">Ausführen ↗</a></li>`).join("")}</ul>`
}

// --- boot -------------------------------------------------------------------
const init = async () => {
    await loadLeistungen()
    renderPicker()
    if (leistungen[0]) await renderProfile(leistungen[0].l, leistungen[0].title)
    await renderPhilosophies()
    renderGallery()
}
init().catch(e => { $("profile").innerHTML = `<p class="muted">Der Graph konnte nicht geladen werden: ${esc(e.message || e)}</p>` })
