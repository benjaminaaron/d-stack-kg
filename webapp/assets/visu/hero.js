// The landing-page hero: an ambient, slowly-orbiting cloud of the backbone graph. This module is a
// deliberately tiny shell — it imports nothing heavy at the top level, so the landing page ships only
// a few KB. Once the page is idle it dynamically pulls in the layer TTL, the in-browser SPARQL engine,
// the projection and the 3D renderer (each its own lazy chunk, none modulepreloaded by index.html), so
// they never sit in the landing bundle. Degrades silently to nothing if projection, store or WebGL
// fail. The question bar and SPARQL runner are shared with the dedicated Graph page (graph-shared.js).

// the legible backbone: everything except the FIM Datenfeld trees (their own layers) and the 768
// reified Konformitaetsbewertung nodes — those live on the dedicated Graph page behind filters
const HERO_LAYERS = ["tech-stack", "pvog", "beschlusslage", "comms", "bridge", "musterstadt", "chatbot", "support115"]

const el = (id) => document.getElementById(id)
const container = el("hero-graph")
if (container) boot().catch(() => container.classList.add("hero-graph--off"))

async function boot() {
    await new Promise(r => (window.requestIdleCallback || ((f) => setTimeout(f, 80)))(r))

    // pulled in only now (after idle): none of this — including the ~2 MB SPARQL engine + layer TTL —
    // is in the landing bundle or modulepreloaded; it loads lazily once the page is interactive
    const [{ LAYERS }, { projectGraph }, { createForceGraph }, { queriesFor }, { buildStore, runQuery, mountQueryBar }] =
        await Promise.all([
            import("../graph.js"),
            import("./graph-data.js"),
            import("./graph-force.js"),
            import("./graph-queries.js"),
            import("./graph-shared.js"),
        ])

    const layers = LAYERS.filter(L => HERO_LAYERS.includes(L.key))
    const data = projectGraph(layers, { onlyLayers: HERO_LAYERS, excludeTypes: ["Konformitaetsbewertung"] })
    data.nodes = data.nodes.filter(n => n.degree > 0)
    const store = buildStore(layers.map(L => L.ttl))

    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches
    const fg = await createForceGraph(container, data, {
        autoRotate: !reduce, autoRotateSpeed: 0.5, intro: true, pull: true,
        nodeRelSize: 3.5, maxLabels: 20, ambientMinDegree: 4, fitPadding: 12,
    })
    container.classList.add("hero-graph--on")

    if (!el("hero-controls")) return
    mountQueryBar(el("hero-controls"), null, queriesFor("hero"), {
        run: (sparql) => runQuery(store, sparql),
        select: (_q, ids) => fg.highlight(ids),
        clear: () => fg.clear(),
    }, { clearButton: false })   // on the hero, clicking the active question unselects — no separate button, no caption
}
