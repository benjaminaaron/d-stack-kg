// Shared helpers for the use-case pages (PVOG-Leistungen, FIM & FIT-Connect, kommunale
// IT-Landschaft). Each page composes the same in-browser graph store, runs SELECTs against
// it, and turns answers into both live HTML and a deep-link that opens the exact SPARQL on
// the Query page. The only per-page input is the PREFIX preamble, so the query-bound helpers
// (select/queryLink/runLink/renderGallery) are produced by useCase(PRE).

import { graphStore } from "./graph.js"
import { queryEngine } from "@foerderfunke/sem-ops-utils/sparql"

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
export const $ = (id) => document.getElementById(id)

export const useCase = (PRE) => {
    const store = graphStore()
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
    const queryLink = (q) => "../query.html?query=" + encodeURIComponent(PRE + "\n\n" + q)
    const runLink = (q, label = "Diese Abfrage ausführen") =>
        `<p><a class="run-link" href="${queryLink(q)}" target="_blank" rel="noopener">${label} ↗</a></p>`
    // the example gallery shared by every use-case page. Each item is either { q, sparql } (a line
    // with one "Ausführen ↗" link), or { render } where render(queryLink) returns custom inner HTML
    // (e.g. a question with several inline query links).
    const renderGallery = (id, gallery) => {
        $(id).innerHTML = `<ul>${gallery.map(g => `<li>${g.render
            ? g.render(queryLink)
            : `${esc(g.q)} <a class="run-link" href="${queryLink(g.sparql)}" target="_blank" rel="noopener">Ausführen ↗</a>`}</li>`).join("")}</ul>`
    }
    return { store, select, queryLink, runLink, renderGallery }
}
