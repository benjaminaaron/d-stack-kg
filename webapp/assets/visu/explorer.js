// The dedicated Graph page, reduced to a reliable core: the whole projected graph in ONE static
// Cytoscape net (layout switchable) — no renderer switch, no camera cinema. Pick a layout, toggle
// Schichten on and off, ask one of the example questions (the graph highlights exactly its answer),
// or click a node to light its neighbourhood and open it in the Query console. Click empty space (or
// the Auflösen button) to return to the overview. The richer controls (2D/3D force views, shortest
// path, node search, Herkunft colouring, per-node suggestions, deep-link URL state) were pulled back
// out on purpose, to be rebuilt deliberately later — this keeps one thing that works.

import { projectGraph, LAYER_META, HERKUNFT_META, ERFUNDEN_LAYERS } from "./graph-data.js"
import { createCytoscape, cytoLayouts, layoutLabel } from "./render-cyto.js"
import { buildStore, runQuery, mountQueryBar } from "./graph-shared.js"
import { PRE, queriesFor } from "./graph-queries.js"
import { LAYERS } from "../graph.js"

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
const sid = (e) => (typeof e === "object" ? e.id : e)
const isDatenfeld = (n) => n.types.includes("Datenfeld") || n.types.includes("Datenfeldgruppe")

const container = $("ex-graph")
if (container) boot().catch(e => { container.innerHTML = `<p class="muted" style="padding:2rem">Der Graph konnte nicht geladen werden: ${esc(e.message || e)}</p>` })

async function boot() {
    const data = projectGraph(LAYERS, { excludeTypes: ["Konformitaetsbewertung"] })
    data.nodes = data.nodes.filter(n => n.degree > 0)
    const store = buildStore(LAYERS.map(L => L.ttl))
    const nodeById = new Map(data.nodes.map(n => [n.id, n]))
    const queries = queriesFor("explorer")

    // adjacency (undirected), so a node click can light its immediate neighbourhood
    const adj = new Map()
    const link = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b) }
    data.links.forEach(l => { link(sid(l.source), sid(l.target)); link(sid(l.target), sid(l.source)) })

    // the ~500 FIM Datenfelder stay hidden unless a selection explicitly pulls them in (override)
    const layerOn = Object.fromEntries(Object.keys(LAYER_META).map(k => [k, true]))
    let override = new Set()
    const visible = (n) => !!n && (override.has(n.id) || (layerOn[n.layer] && !isDatenfeld(n)))

    const ctrl = await createCytoscape(container, data, { hubMinDegree: 6, layout: "fcose", colorMode: "layer" })

    const applyFilters = () => ctrl.applyFilter(visible)

    // --- selection ------------------------------------------------------------------------------
    const selectIds = (ids, opts) => { override = new Set(ids); applyFilters(); ctrl.highlight(ids, opts) }

    // --- the shared question bar. "Übersicht" sits at the top as the persistent way back to the
    //     whole graph (active at rest); picking a question filters, picking Übersicht returns. No
    //     bottom caption — the active question in the list is signal enough -------------------------
    const bar = mountQueryBar($("ex-queries"), null, queries, {
        run: (sparql) => runQuery(store, sparql),
        select: (_q, ids) => selectIds(ids),
        clear: () => clearSelection(),
    }, { home: "Übersicht" })
    const clearSelection = () => {
        override = new Set(); applyFilters(); ctrl.clear(); hideDetail(); bar.home()
    }

    // --- layout picker --------------------------------------------------------------------------
    const layoutSel = $("ex-layout")
    layoutSel.innerHTML = cytoLayouts().map(n => `<option value="${n}">${esc(layoutLabel[n] || n)}</option>`).join("")
    layoutSel.addEventListener("change", () => { clearSelection(); ctrl.setLayout(layoutSel.value) })

    // --- Schicht toggles ------------------------------------------------------------------------
    $("ex-layers").innerHTML = Object.entries(LAYER_META).map(([key, m]) =>
        `<label class="ex-layer${ERFUNDEN_LAYERS.has(key) ? " ex-layer--erf" : ""}"><input type="checkbox" data-layer="${key}"${layerOn[key] ? " checked" : ""}>
            <span class="ex-sw" style="background:${m.color}"></span>${esc(m.label)}</label>`).join("")
    $("ex-layers").addEventListener("change", (ev) => {
        const cb = ev.target.closest("input[data-layer]"); if (!cb) return
        layerOn[cb.dataset.layer] = cb.checked; applyFilters()
    })

    // --- click a node: light its neighbourhood + inspect it; empty space returns to overview -----
    const detailWrap = $("ex-detail-wrap"), detail = $("ex-detail")
    const hideDetail = () => { if (detailWrap) detailWrap.hidden = true }
    const nodeQuery = (iri) => `# Alles, was im Graphen über diesen Knoten steht
SELECT ?eigenschaft ?wert WHERE { <${iri}> ?eigenschaft ?wert } LIMIT 200`
    const showDetail = (id) => {
        const n = nodeById.get(id); if (!n || !detail) return
        const deep = "query.html?query=" + encodeURIComponent(PRE + "\n\n" + nodeQuery(id))
        detail.innerHTML = `<p class="ex-d-label">${esc(n.label)}</p>
            <p class="ex-d-meta"><span class="ex-sw" style="background:${LAYER_META[n.layer]?.color}"></span>${esc(LAYER_META[n.layer]?.label || n.layer)} <span class="ex-erf">${esc(HERKUNFT_META[n.herkunft]?.label || n.herkunft)}</span></p>
            ${n.types.length ? `<p class="ex-d-types">${n.types.map(t => `<span class="bl-chip">${esc(t)}</span>`).join(" ")}</p>` : ""}
            <p class="ex-d-deg muted">${n.degree} ${n.degree === 1 ? "Verbindung" : "Verbindungen"}</p>
            <p><a class="run-link" href="${deep}" target="_blank" rel="noopener">In der Query-Konsole öffnen ↗</a></p>`
        detailWrap.hidden = false
    }
    ctrl.onNodeClick((id) => {
        bar.reset()
        selectIds([id, ...(adj.get(id) || [])], { fit: true })   // a node click focuses on its neighbourhood
        showDetail(id)
    })
    ctrl.onBackgroundClick(clearSelection)

    applyFilters()   // initial render

    // deep-link: ?frage=<id> pre-selects that question on load (e.g. linked from a use-case page),
    // running and highlighting it exactly as a click would. Unknown/failing ids fall back to the overview.
    const frageId = new URLSearchParams(location.search).get("frage")
    if (frageId) {
        const q = queries.find(x => x.id === frageId)
        if (q) try { selectIds(await runQuery(store, q.sparql)); bar.activate(q.id) } catch { /* keep the overview */ }
    }
}
