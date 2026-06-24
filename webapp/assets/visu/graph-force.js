// The force renderer (vasturiano's 3d-force-graph + three-spritetext), lazy-loaded via dynamic
// import() so the heavy three.js chunk only downloads when a force canvas actually mounts. It drives
// three things: the cinematic landing hero (3D, auto-orbit, intro fly-in, pull-together), and — on
// the dedicated Graph page — a plain 3D and a flattened 2D view (rotation locked) with no cinema.
// All renderers (here and render-cyto.js) expose the same controller interface so the page is
// renderer-agnostic: highlight(ids) · clear() · applyFilter(fn) · onNodeClick(cb) · dispose() · resize().

import { layerColor, herkunftColor, ERFUNDEN_LAYERS, LAYER_META } from "./graph-data.js"

let libsPromise
const loadLibs = () => (libsPromise ??= Promise.all([
    import("3d-force-graph"),
    import("three-spritetext"),
]).then(([fg, st]) => ({ ForceGraph3D: fg.default, SpriteText: st.default })))

const DIM_NODE = "rgba(130,140,155,0.06)"
const DIM_LINK = "rgba(130,140,155,0.03)"
const sid = (e) => (typeof e === "object" ? e.id : e)
// labels come from dataset literals (incl. lifted external data); escape before building tooltip HTML
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))

// createForceGraph(container, data, opts) → controller
//   opts: { dim:3|2, intro, pull, autoRotate, autoRotateSpeed, nodeRelSize, maxLabels, ambientMinDegree, fitPadding }
export async function createForceGraph(container, data, opts = {}) {
    const { ForceGraph3D, SpriteText } = await loadLibs()
    const dark = matchMedia("(prefers-color-scheme: dark)").matches
    const LABEL_FG = dark ? "#eef1f6" : "#0e141c"
    const LABEL_BG = dark ? "rgba(12,14,18,0.62)" : "rgba(244,245,247,0.76)"
    const is2D = (opts.dim ?? 3) === 2
    const introEnabled = opts.intro !== false && !is2D   // the cinematic arc is a 3D-hero thing
    const pullEnabled = opts.pull !== false
    const nodeRelSize = opts.nodeRelSize ?? 3.5
    const maxLabels = opts.maxLabels ?? 22
    const ambientMinDeg = opts.ambientMinDegree ?? 4
    const labelMinDeg = opts.labelMinDegree ?? 2

    const nodeById = new Map(data.nodes.map(n => [n.id, n]))
    let forced = null            // active selection: Map<id, hopLevel> (0 = primary), or null = ambient
    let nodeFilter = null        // active node-visibility predicate, or null = all visible
    let edgeMode = "all"         // "all" | "cross" (only edges that join two Schichten)
    let colorMode = opts.colorMode ?? "layer"   // "layer" | "herkunft"
    const labelEntries = []

    // graded highlight: a selected node's colour fades toward a neutral as its hop distance grows,
    // so a node-click reads as an "impact radius" (centre bright, 1-hop strong, 2-hop faint)
    const INTENSITY = [1, 0.7, 0.42]
    const intensity = (lvl) => INTENSITY[lvl] ?? 0.3
    const NEUTRAL = dark ? [34, 38, 46] : [223, 226, 231]
    const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
    const lit = (hex, lvl) => { const c = hexRgb(hex), t = 1 - intensity(lvl); return `rgb(${c.map((v, i) => Math.round(v + (NEUTRAL[i] - v) * t)).join(",")})` }

    const colorOf = (n) => colorMode === "herkunft" ? herkunftColor(n.herkunft) : layerColor(n.layer)
    const linkBase = (l) => colorMode === "herkunft" ? herkunftColor(l.herkunft) : layerColor(l.layer)
    const nodeColor = (n) => !forced ? colorOf(n) : forced.has(n.id) ? lit(colorOf(n), forced.get(n.id)) : DIM_NODE
    const linkLevel = (l) => { if (!forced) return null; const a = sid(l.source), b = sid(l.target); return forced.has(a) && forced.has(b) ? Math.max(forced.get(a), forced.get(b)) : null }
    const linkColor = (l) => { const lv = linkLevel(l); return lv == null ? (forced ? DIM_LINK : linkBase(l)) : lit(linkBase(l), lv) }
    const linkWidth = (l) => { const lv = linkLevel(l); return lv == null ? 0 : Math.max(0.6, 1.8 - lv * 0.55) }

    const buildLabel = (n) => {
        if ((n.degree || 0) < labelMinDeg) return null
        const s = new SpriteText(n.label.length > 38 ? n.label.slice(0, 36) + "…" : n.label)
        s.color = LABEL_FG
        s.backgroundColor = LABEL_BG
        s.padding = 2
        s.borderRadius = 2
        s.fontWeight = "700"
        s.textHeight = 5
        s.material.depthWrite = false
        s.center.set(0.5, 0)
        s.position.set(0, nodeRelSize + 2.5, 0)
        s.renderOrder = 12
        s.visible = false
        labelEntries.push({ node: n, sprite: s })
        return s
    }

    const Graph = ForceGraph3D({ controlType: "orbit" })(container)
        .numDimensions(opts.dim ?? 3)
        // a clone: 3d-force-graph rewrites link.source/target to node refs in place, which would
        // corrupt the shared projection for the other renderers and the page's stats
        .graphData({ nodes: data.nodes.map(n => ({ ...n })), links: data.links.map(l => ({ ...l })) })
        .backgroundColor("rgba(0,0,0,0)")
        .showNavInfo(false)
        .nodeRelSize(nodeRelSize)
        .nodeVal(n => 1 + Math.cbrt(n.degree || 0))
        .nodeColor(nodeColor)
        .nodeOpacity(0.95)
        .nodeResolution(10)
        .nodeThreeObjectExtend(true)
        .nodeThreeObject(buildLabel)
        .nodeLabel(n => `<div class="fg-tip"><b>${esc(n.label)}</b><br><span>${esc(LAYER_META[n.layer]?.label || n.layer)}</span></div>`)
        .linkColor(linkColor)
        .linkWidth(linkWidth)
        .linkOpacity(0.3)
        .linkDirectionalParticles(0)

    // when a question is active, the answer nodes repel each other harder and their links lengthen, so
    // the pulled-together answer spreads out enough to read instead of clumping into a dense blob (tunable)
    const CHARGE_BASE = -11, CHARGE_HOT = -42
    const chargeStrength = (n) => (forced && forced.has(n.id)) ? CHARGE_HOT : CHARGE_BASE
    const linkDistance = (l) => {
        const base = ERFUNDEN_LAYERS.has(l.layer) ? 26 : 14
        return (forced && forced.has(sid(l.source)) && forced.has(sid(l.target))) ? base * 2.6 : base
    }
    Graph.d3Force("link")?.distance(linkDistance)
    Graph.d3Force("charge")?.strength(chargeStrength)

    const controls = Graph.controls()
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.minDistance = 0.5
    controls.maxDistance = 6000
    let autoRotate = (opts.autoRotate ?? false) && !is2D
    controls.autoRotate = autoRotate
    controls.autoRotateSpeed = opts.autoRotateSpeed ?? 0.5
    if (is2D) {
        controls.enableRotate = false
        try { controls.mouseButtons = { LEFT: 2, MIDDLE: 1, RIGHT: 2 } } catch {}   // left/right = pan, wheel = zoom
    }
    let resumeTimer
    controls.addEventListener?.("start", () => { controls.autoRotate = false; clearTimeout(resumeTimer) })
    controls.addEventListener?.("end", () => { resumeTimer = setTimeout(() => { controls.autoRotate = autoRotate }, 2500) })

    // frame the dense core at a close distance (75th-percentile radius, so outliers don't push back)
    const frameCore = (duration, swing = 0) => {
        const ns = Graph.graphData().nodes.filter(n => (n.degree || 0) >= 2 && n.x != null)
        if (!ns.length) return
        let cx = 0, cy = 0, cz = 0
        for (const n of ns) { cx += n.x; cy += n.y; cz += n.z }
        cx /= ns.length; cy /= ns.length; cz /= ns.length
        const dists = ns.map(n => Math.hypot(n.x - cx, n.y - cy, n.z - cz)).sort((a, b) => a - b)
        const r = dists[Math.floor(dists.length * 0.75)] || dists[dists.length - 1] || 80
        const cam = Graph.camera()
        let dx = cam.position.x - cx, dz = cam.position.z - cz
        const dy = cam.position.y - cy
        if (swing) { const a = Math.atan2(dx, dz) + swing, h = Math.hypot(dx, dz); dx = h * Math.sin(a); dz = h * Math.cos(a) }
        const len = Math.hypot(dx, dy, dz) || 1
        const dist = r * 1.6 + 26
        controls.target.set(cx, cy, cz)
        Graph.cameraPosition({ x: cx + dx / len * dist, y: cy + dy / len * dist, z: cz + dz / len * dist }, { x: cx, y: cy, z: cz }, duration)
    }

    // framing. For the hero we do NOT wait for the layout to settle (that looked like the cloud forming
    // far away, then a late zoom-in): we start easing the camera in right away and re-frame a couple of
    // times as the cloud expands, so the zoom-in happens *while* it forms. Plain fit-on-settle otherwise.
    let framed = false
    const onSettle = () => {
        if (framed || forced) return
        framed = true
        frameCore(700, 0)
    }
    if (introEnabled) {
        framed = true                 // we drive the intro ourselves; keep onEngineStop from reframing
        controls.autoRotate = false
        const steps = [300, 1400, 2700]
        steps.forEach((t, i) => setTimeout(() => {
            if (forced) return
            frameCore(i === 0 ? 1600 : 1300, i === 0 ? Math.PI * 0.3 : 0)
            if (i === steps.length - 1) controls.autoRotate = autoRotate
        }, t))
    } else {
        Graph.onEngineStop(onSettle)
        setTimeout(onSettle, 4000)
    }

    const refresh = () => Graph.nodeColor(nodeColor).linkColor(linkColor).linkWidth(linkWidth)

    const clusterForce = (set, k = 0.085) => {
        let ns = []
        const f = (alpha) => {
            let cx = 0, cy = 0, cz = 0, c = 0
            for (const n of ns) if (set.has(n.id)) { cx += n.x; cy += n.y; cz += n.z; c++ }
            if (!c) return
            cx /= c; cy /= c; cz /= c
            const kk = k * alpha
            for (const n of ns) if (set.has(n.id)) { n.vx += (cx - n.x) * kk; n.vy += (cy - n.y) * kk; n.vz += (cz - n.z) * kk }
        }
        f.initialize = (nodes) => { ns = nodes }
        return f
    }

    // re-centre on a node set and move in to frame it (zoom + centre in 2D)
    const flyTo = (set) => {
        const ns = Graph.graphData().nodes.filter(n => set.has(n.id) && n.x != null)
        if (!ns.length) return
        let cx = 0, cy = 0, cz = 0
        for (const n of ns) { cx += n.x; cy += n.y; cz += n.z }
        cx /= ns.length; cy /= ns.length; cz /= ns.length
        let r = 0
        for (const n of ns) r = Math.max(r, Math.hypot(n.x - cx, n.y - cy, n.z - cz))
        const cam = Graph.camera()
        let dx = cam.position.x - cx, dy = cam.position.y - cy, dz = cam.position.z - cz
        const len = Math.hypot(dx, dy, dz) || 1
        const dist = Math.max(r * 2.1 + 24, 42)
        // let cameraPosition tween the look-at over the duration rather than snapping controls.target
        // (that instant snap is what made the centring feel abrupt); a longer move reads gentler
        Graph.cameraPosition({ x: cx + dx / len * dist, y: cy + dy / len * dist, z: cz + dz / len * dist }, { x: cx, y: cy, z: cz }, 1800)
    }

    // per-frame: show only the labels nearest the camera (among the current candidates)
    let raf
    const tick = () => {
        const cam = Graph.camera()
        if (cam && labelEntries.length) {
            const vis = []
            for (const e of labelEntries) {
                const parentVisible = !e.sprite.parent || e.sprite.parent.visible !== false
                const eligible = parentVisible && (forced ? forced.has(e.node.id) : (e.node.degree || 0) >= ambientMinDeg)
                if (!eligible || e.node.x == null) { e.sprite.visible = false; continue }
                vis.push([(e.node.x - cam.position.x) ** 2 + (e.node.y - cam.position.y) ** 2 + (e.node.z - cam.position.z) ** 2, e.sprite])
            }
            vis.sort((a, b) => a[0] - b[0])
            for (let i = 0; i < vis.length; i++) vis[i][1].visible = i < maxLabels
        }
        raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    let ro
    const controller = {
        highlight(sel) {
            forced = sel instanceof Map ? sel : new Map((sel || []).map(id => [id, 0]))
            const keys = new Set(forced.keys())
            framed = true
            autoRotate = false; controls.autoRotate = false
            refresh()
            Graph.d3Force("charge")?.strength(chargeStrength)   // re-evaluate now that `forced` changed:
            Graph.d3Force("link")?.distance(linkDistance)       // spread the active answer apart
            if (pullEnabled) Graph.d3Force("cluster", clusterForce(keys, 0.05))   // looser gather, so spacing wins
            Graph.d3ReheatSimulation()
            setTimeout(() => flyTo(keys), pullEnabled ? 700 : 60)
        },
        clear() {
            forced = null
            Graph.d3Force("cluster", null)
            Graph.d3Force("charge")?.strength(chargeStrength)   // back to the ambient spacing
            Graph.d3Force("link")?.distance(linkDistance)
            refresh()
            Graph.d3ReheatSimulation()
            autoRotate = (opts.autoRotate ?? false) && !is2D
            controls.autoRotate = autoRotate
            setTimeout(() => frameCore(1100, 0), 200)
        },
        applyFilter(fn) {
            nodeFilter = fn
            const ok = (n) => !nodeFilter || nodeFilter(n)
            Graph.nodeVisibility(ok)
            Graph.linkVisibility(l => ok(typeof l.source === "object" ? l.source : nodeById.get(l.source))
                && ok(typeof l.target === "object" ? l.target : nodeById.get(l.target))
                && (edgeMode !== "cross" || l.crossLayer))
        },
        setEdgeMode(mode) { edgeMode = mode; this.applyFilter(nodeFilter) },
        setColorMode(mode) { colorMode = mode; Graph.nodeColor(nodeColor).linkColor(linkColor) },
        onNodeClick(cb) { Graph.onNodeClick(n => cb(n.id)) },
        focus(id) { flyTo(new Set([id])) },
        resize() { Graph.width(container.clientWidth).height(container.clientHeight) },
        dispose() { cancelAnimationFrame(raf); ro?.disconnect(); try { Graph._destructor?.() } catch {} container.replaceChildren() },
    }
    controller.resize()
    ro = new ResizeObserver(() => controller.resize())
    ro.observe(container)
    return controller
}

// the legend rows (layer swatch + label), shared by both surfaces
export const legendItems = () => Object.entries(LAYER_META).map(([key, m]) => ({ key, ...m, erfunden: ERFUNDEN_LAYERS.has(key) }))
