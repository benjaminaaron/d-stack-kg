// Pieces shared by both graph surfaces (the landing hero and the dedicated Graph page), so the two
// stay in lock-step: the in-browser store builder, the SPARQL runner that returns a query's ?n node
// ids, and the question-button bar (render + active-state + "click again to unselect"). Each page
// supplies a tiny host ({ run, select, clear }) and keeps only its own extras.

import { storeFromTurtles } from "@foerderfunke/sem-ops-utils/core"
import { queryEngine } from "@foerderfunke/sem-ops-utils/sparql"
import { PRE } from "./graph-queries.js"

export const buildStore = (ttls) => storeFromTurtles(ttls)

// run a predefined query (its body, prefixed) and collect the ?n node IRIs it selects
export async function runQuery(store, sparql) {
    const res = await queryEngine.query(PRE + "\n" + sparql, { sources: [store] })
    const ids = []
    for await (const b of await res.execute()) { const v = b.get("n"); if (v) ids.push(v.value) }
    return ids
}

// the question bar. host = { run(sparql)->Promise<ids>, select(query, ids), clear() }.
// Two ways back to the overview:
//   opts.home (a label, e.g. "Übersicht") → a persistent home item at the top of a single-select
//     group; it is active at rest and clicking it clears. This is the Graph page's model.
//   otherwise → the hero's model: an optional "Auflösen" button (opts.clearButton) plus clicking
//     the already-active question to unselect.
// returns { activate(id), showClear(), home(), reset() } so a page can restore the bar after a
// node click, a background click, etc.
export function mountQueryBar(barEl, captionEl, queries, host, opts = {}) {
    const home = opts.home || null
    const withClear = !home && opts.clearButton !== false
    barEl.innerHTML =
        (home ? `<button type="button" class="qbtn qbtn--home" data-id="__home">${home}</button>` : "") +
        queries.map(q => `<button type="button" class="qbtn" data-id="${q.id}">${q.label}</button>`).join("") +
        (withClear ? `<button type="button" class="qbtn qbtn--clear" data-id="__clear" hidden>Auflösen ✕</button>` : "")
    const clearBtn = barEl.querySelector('[data-id="__clear"]')
    const homeBtn = barEl.querySelector('[data-id="__home"]')
    const btnById = (id) => [...barEl.querySelectorAll(".qbtn")].find(b => b.dataset.id === id)
    const mark = (btn) => barEl.querySelectorAll(".qbtn").forEach(b => b.classList.toggle("active", b === btn))
    const reset = () => { mark(null); if (clearBtn) clearBtn.hidden = true; if (captionEl) captionEl.hidden = true }
    const markHome = () => { mark(homeBtn); if (captionEl) captionEl.hidden = true }
    if (homeBtn) markHome()   // resting state: the overview item is the active one

    barEl.addEventListener("click", async (ev) => {
        const btn = ev.target.closest("button")
        if (!btn) return
        // back to the overview: the home item, the Auflösen button, or (hero mode) the active question
        if (btn.dataset.id === "__home") { host.clear(); markHome(); return }
        if (btn.dataset.id === "__clear" || (!home && btn.classList.contains("active"))) { host.clear(); reset(); return }
        if (btn.classList.contains("active")) return   // home mode: re-clicking the active question is a no-op
        const q = queries.find(x => x.id === btn.dataset.id)
        if (!q) return
        mark(btn)
        try {
            const ids = await host.run(q.sparql)
            host.select(q, ids)
            if (clearBtn) clearBtn.hidden = false
            if (captionEl) { captionEl.innerHTML = `${q.caption} <a href="${q.page}">mehr dazu →</a>`; captionEl.hidden = false }
        } catch {
            if (captionEl) { captionEl.textContent = "Diese Abfrage konnte nicht ausgeführt werden."; captionEl.hidden = false }
        }
    })

    return {
        activate(id) { const b = btnById(id); if (b) { mark(b); if (clearBtn) clearBtn.hidden = false } },
        showClear() { if (clearBtn) clearBtn.hidden = false },
        home() { if (homeBtn) markHome() },
        reset,
    }
}
