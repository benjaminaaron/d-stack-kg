// Export page: download the composed knowledge graph — all layers, or a chosen subset — as Turtle
// or JSON-LD, entirely in the browser (no server). It inlines the very same ?raw artefacts the rest
// of the app queries (see graph.js). Pattern adapted from directory-builder-core's Download.jsx,
// reduced to our case: whole-layer checkboxes + a TTL/JSON-LD switch.

import dstackTtl from "../../data/2-enrich-kg/d-stack-kg.ttl?raw"
import leistungenTtl from "../../data/2-enrich-kg/pvog-leistungen.ttl?raw"
import fimTtl from "../../data/2-enrich-kg/fim-leistungen.ttl?raw"
import fitConnectTtl from "../../data/2-enrich-kg/fit-connect.ttl?raw"
import bridgeTtl from "../../authored/pvog-dstack-bridge.assumed.ttl?raw"
import vocabTtl from "../../authored/vocabulary.ttl?raw"
import { turtleToJsonLdObj } from "@foerderfunke/sem-ops-utils/jsonld"

// the downloadable artefacts, in composition order — all checked by default
const ARTEFACTS = [
    { file: "d-stack-kg.ttl",                 label: "Technische Ebene (Tech-Stack Landkarte)", ttl: dstackTtl },
    { file: "pvog-leistungen.ttl",            label: "Verwaltungsleistungen (PVOG)",            ttl: leistungenTtl },
    { file: "fim-leistungen.ttl",             label: "FIM-Steckbriefe & Datenfelder",           ttl: fimTtl },
    { file: "fit-connect.ttl",                label: "FIT-Connect",                             ttl: fitConnectTtl },
    { file: "pvog-dstack-bridge.assumed.ttl", label: "Angenommene Brücke",                      ttl: bridgeTtl },
    { file: "vocabulary.ttl",                 label: "Vokabular",                               ttl: vocabTtl },
]

const FORMATS = {
    ttl:    { ext: "ttl",    mime: "text/turtle" },
    jsonld: { ext: "jsonld", mime: "application/ld+json" },
}

// Turtle: faithful concatenation — keeps each artefact's provenance header, and no artefact uses
// labelled blank nodes, so there is nothing to collide. JSON-LD: parse that combined Turtle and
// reframe it (the combination is one coherent graph).
const buildContent = async (ttls, format) => {
    const combined = ttls.join("\n\n")
    if (format === "ttl") return combined
    return JSON.stringify(await turtleToJsonLdObj(combined), null, 2)
}

const triggerDownload = (content, mime, filename) => {
    const url = URL.createObjectURL(new Blob([content], { type: mime }))
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
}

const app = document.getElementById("export-app")
app.innerHTML = `
    <ul class="export-list">${ARTEFACTS.map((a, i) => `
        <li><label><input type="checkbox" data-i="${i}" checked> <b>${a.label}</b> <code>${a.file}</code></label></li>`).join("")}</ul>
    <div class="export-controls">
        <label>Format:
            <select id="export-format">
                <option value="ttl">Turtle (.ttl)</option>
                <option value="jsonld">JSON-LD (.jsonld)</option>
            </select>
        </label>
        <button id="export-btn" type="button">Herunterladen</button>
        <span id="export-status" class="muted"></span>
    </div>`

const boxes = [...app.querySelectorAll('input[type="checkbox"]')]
const btn = app.querySelector("#export-btn")
const status = app.querySelector("#export-status")

const refresh = () => { btn.disabled = boxes.every(b => !b.checked) }
boxes.forEach(b => b.addEventListener("change", refresh))

// one artefact → its own name; a subset → _bundle; everything → _all (extension follows the format)
const filenameFor = (selected, ext) => {
    const base = selected.length === 1 ? selected[0].file.replace(/\.ttl$/, "")
        : selected.length === ARTEFACTS.length ? "d-stack-kg_all"
        : "d-stack-kg_bundle"
    return `${base}.${ext}`
}

btn.addEventListener("click", async () => {
    const format = app.querySelector("#export-format").value
    const selected = boxes.filter(b => b.checked).map(b => ARTEFACTS[+b.dataset.i])
    if (!selected.length) return
    btn.disabled = true
    status.textContent = "wird erzeugt…"
    try {
        const content = await buildContent(selected.map(a => a.ttl), format)
        triggerDownload(content, FORMATS[format].mime, filenameFor(selected, FORMATS[format].ext))
        status.textContent = ""
    } catch (e) {
        status.textContent = "Fehler: " + (e.message || e)
    } finally {
        refresh()
    }
})
