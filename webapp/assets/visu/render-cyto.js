// The Cytoscape renderer — the crisp, layout-flexible 2D alternative to the force views. Same
// controller interface as graph-force.js (highlight/clear/applyFilter/onNodeClick/dispose/resize)
// plus setLayout/setColorMode/setEdgeMode, and it is the one renderer that can dash the "not
// asserted" (.assumed/.fictional/.scenario) edges. Lazy-loaded so its chunk only ships when picked.

import { layerColor, herkunftColor, ERFUNDEN_HERKUNFT, LAYER_META, prefixIRI } from "./graph-data.js"

let libsPromise
const loadLibs = () => (libsPromise ??= Promise.all([
    import("cytoscape"),
    import("cytoscape-fcose"),
]).then(([cy, fcose]) => {
    const cytoscape = cy.default || cy
    const register = fcose.default || fcose        // CJS interop: the registration fn may be either
    try { cytoscape.use(register) } catch {}        // registering twice throws; ignore
    return cytoscape
}))

const LAYOUTS = {
    fcose: { name: "fcose", quality: "default", animate: true, animationDuration: 600, randomize: true, nodeRepulsion: 6000, idealEdgeLength: 48, nodeSeparation: 75 },
    concentric: { name: "concentric", animate: true, animationDuration: 600, concentric: n => n.degree(), levelWidth: () => 2, minNodeSpacing: 14 },
    breadthfirst: { name: "breadthfirst", animate: true, animationDuration: 600, spacingFactor: 1.1, circle: false },
    grid: { name: "grid", animate: true, animationDuration: 500, avoidOverlap: true },
}

export async function createCytoscape(container, data, opts = {}) {
    const cytoscape = await loadLibs()
    const dark = matchMedia("(prefers-color-scheme: dark)").matches
    const FG = dark ? "#eef1f6" : "#0e141c"
    const OUT = dark ? "#0a0c11" : "#f6f7f9"
    const ACCENT = dark ? "#ffd24d" : "#cc8800"
    const hubDeg = opts.hubMinDegree ?? 6
    const nodeById = new Map(data.nodes.map(n => [n.id, n]))
    let colorMode = opts.colorMode ?? "layer"
    let edgeMode = "all"

    const colorOf = (ele) => colorMode === "herkunft" ? herkunftColor(ele.data("herkunft")) : layerColor(ele.data("layer"))
    const sid = (e) => (typeof e === "object" ? e.id : e)   // defensive: a force renderer may have run first

    const elements = [
        ...data.nodes.map(n => ({ data: { id: n.id, label: n.label, layer: n.layer, herkunft: n.herkunft, deg: n.degree || 0, size: 12 + Math.cbrt(n.degree || 0) * 9 }, classes: (n.degree || 0) >= hubDeg ? "hub" : "" })),
        ...data.links.map((l, i) => ({ data: { id: "e" + i, source: sid(l.source), target: sid(l.target), layer: l.layer, herkunft: l.herkunft, cross: l.crossLayer ? "1" : "0", erf: ERFUNDEN_HERKUNFT.has(l.herkunft) ? "1" : "0" } })),
    ]

    const cy = cytoscape({
        container,
        elements,
        wheelSensitivity: 0.3,
        style: [
            { selector: "node", style: {
                "background-color": colorOf,
                "width": "data(size)", "height": "data(size)", "label": "",
                "font-size": "10px", "font-weight": 600, "color": FG,
                "text-outline-width": 2.4, "text-outline-color": OUT,
                "text-valign": "top", "text-halign": "center", "text-margin-y": -2,
                "text-wrap": "ellipsis", "text-max-width": "120px", "min-zoomed-font-size": 7,
            } },
            { selector: "node.hub, node.hl, node.hl1, node:selected", style: { "label": "data(label)" } },
            { selector: "edge", style: {
                "width": 1, "line-color": colorOf, "opacity": 0.32, "curve-style": "straight",
            } },
            { selector: 'edge[erf = "1"]', style: { "line-style": "dashed" } },   // not asserted
            { selector: ".dim", style: { "opacity": 0.07, "text-opacity": 0 } },
            { selector: "edge.dim", style: { "opacity": 0.03 } },
            { selector: "node.hl", style: { "opacity": 1, "border-width": 2.5, "border-color": ACCENT, "label": "data(label)" } },
            { selector: "edge.hl", style: { "opacity": 0.95, "width": 2.6 } },
            { selector: ".hidden, .xhide", style: { "display": "none" } },
        ],
    })

    let layoutName = opts.layout || "fcose"
    // the overview frame: fit, then zoom in past the plain fit so the cluster fills the canvas rather
    // than floating small inside it (the sparse FIM/FIT tails otherwise stretch the bounding box). Tunable.
    const OVERVIEW_BOOST = 1.5
    const fitOverview = (animate = false) => {
        const from = animate ? { zoom: cy.zoom(), pan: { ...cy.pan() } } : null
        cy.fit(cy.elements(":visible"), 15)
        cy.zoom({ level: cy.zoom() * OVERVIEW_BOOST, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } })
        if (from) {
            const to = { zoom: cy.zoom(), pan: { ...cy.pan() } }
            cy.viewport(from); cy.animate({ zoom: to.zoom, pan: to.pan }, { duration: 600 })
        }
    }
    const runLayout = () => { const lay = cy.layout({ ...LAYOUTS[layoutName], fit: false }); lay.one("layoutstop", () => fitOverview(true)); lay.run() }
    runLayout()

    // hover tooltip: the node's IRI in prefixed form (so a node whose visible label is only a
    // derived local name stays identifiable). Lives inside the container, cleared on dispose.
    const tip = document.createElement("div")
    tip.className = "cy-tip"; tip.hidden = true
    container.appendChild(tip)
    const moveTip = (ev) => {
        const p = ev.renderedPosition || ev.target.renderedPosition()
        tip.style.left = (p.x + 14) + "px"; tip.style.top = (p.y + 14) + "px"
    }
    cy.on("mouseover", "node", (ev) => { tip.textContent = prefixIRI(ev.target.id()); tip.hidden = false; moveTip(ev) })
    cy.on("mousemove", "node", moveTip)
    cy.on("mouseout", "node", () => { tip.hidden = true })

    let nodeFilter = null
    const refreshVis = () => cy.batch(() => {
        cy.nodes().forEach(n => n.toggleClass("hidden", !!nodeFilter && !nodeFilter(nodeById.get(n.id()))))
        cy.edges().forEach(e => {
            e.toggleClass("hidden", e.source().hasClass("hidden") || e.target().hasClass("hidden"))
            e.toggleClass("xhide", edgeMode === "cross" && e.data("cross") !== "1")
        })
    })

    return {
        // highlight a set of node ids: dim the whole graph (it stays visible as faint context) and
        // light the answer nodes + the edges among them. opts.fit zooms to the answer (used for a node
        // click); without it the camera holds the overview so the whole graph stays in view.
        highlight(sel, opts = {}) {
            const ids = sel instanceof Map ? [...sel.keys()] : (sel || [])
            let lit = cy.collection()
            for (const id of ids) { const n = cy.getElementById(id); if (n.nonempty()) lit = lit.union(n) }
            const inner = lit.edgesWith(lit)
            cy.batch(() => {
                cy.elements().addClass("dim").removeClass("hl")
                lit.removeClass("dim").addClass("hl")
                inner.removeClass("dim").addClass("hl")
            })
            if (opts.fit && lit.nonempty()) cy.animate({ fit: { eles: lit, padding: 60 } }, { duration: 600 })
        },
        clear() {
            cy.elements().removeClass("dim hl").style("opacity", null).style("width", null)
            fitOverview(true)
        },
        applyFilter(fn) { nodeFilter = fn; refreshVis() },
        setEdgeMode(mode) { edgeMode = mode; refreshVis() },
        setColorMode(mode) { colorMode = mode; cy.nodes().style("background-color", colorOf); cy.edges().style("line-color", colorOf) },
        setLayout(name) { if (LAYOUTS[name]) { layoutName = name; cy.elements().removeClass("dim hl"); runLayout() } },
        onNodeClick(cb) { cy.on("tap", "node", ev => cb(ev.target.id())) },
        onBackgroundClick(cb) { cy.on("tap", ev => { if (ev.target === cy) cb() }) },
        focus(id) { const n = cy.getElementById(id); if (n.nonempty()) cy.animate({ fit: { eles: n.closedNeighborhood(), padding: 80 } }, { duration: 600 }) },
        resize() { cy.resize() },
        dispose() { try { cy.destroy() } catch {} container.replaceChildren() },
    }
}

export const cytoLayouts = () => Object.keys(LAYOUTS)
export const layoutLabel = { fcose: "Kräftebasiert", concentric: "Konzentrisch", breadthfirst: "Hierarchisch", grid: "Raster" }
