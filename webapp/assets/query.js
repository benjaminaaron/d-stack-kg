// Query page: a Yasgui SPARQL editor wired to an in-browser n3 store (no server).
// A fetch interceptor routes Yasgui's fake endpoint through Comunica, so every
// query runs in the browser against the graph — the same engine the pipeline
// uses (sem-ops-utils / Comunica), bundled by Vite. The graph is imported
// directly: Vite's ?raw inlines data/2-enrich-kg/d-stack-kg.ttl as a string, so
// there is nothing to fetch or stage.

import dstackTtl from "../../data/2-enrich-kg/d-stack-kg.ttl?raw"
import { storeFromTurtles, getWriter } from "@foerderfunke/sem-ops-utils/core"
import { queryEngine } from "@foerderfunke/sem-ops-utils/sparql"
import "@zazuko/yasgui/build/yasgui.min.css"
import Yasgui from "@zazuko/yasgui"

// Yasgui talks to a SPARQL endpoint over HTTP. We have none — queries run against
// this in-memory store. So we point Yasgui at a fake URL and intercept fetches to
// it, routing them through Comunica.
const ENDPOINT = "http://local/sparql"
const store = storeFromTurtles([dstackTtl])

const INITIAL_QUERY = `PREFIX dstack: <https://deutschland-stack.gov.de/vocab#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX dct: <http://purl.org/dc/terms/>

# Stack elements with their Landkarte group and responsible body
SELECT ?label ?gruppe ?stelle WHERE {
    ?el a dstack:StackElement ;
        skos:prefLabel ?label ;
        dct:subject/skos:prefLabel ?gruppe ;
        dstack:verantwortlicheStelle ?stelle .
}
ORDER BY ?gruppe ?label
LIMIT 100`

const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string"
const termToJson = (term) => {
    if (term.termType === "Literal") {
        const v = { type: "literal", value: term.value }
        if (term.language) v["xml:lang"] = term.language
        else if (term.datatype && term.datatype.value !== XSD_STRING) v.datatype = term.datatype.value
        return v
    }
    if (term.termType === "BlankNode") return { type: "bnode", value: term.value }
    return { type: "uri", value: term.value }
}

const collectBindings = async (stream) => {
    const bindings = []
    for await (const b of stream) {
        const row = {}
        for (const [k, v] of b) {
            row[k.value] = termToJson(v)
        }
        bindings.push(row)
    }
    return bindings
}

const collectQuadsAsTurtle = async (stream) => {
    const writer = getWriter({})
    for await (const q of stream) {
        writer.addQuad(q)
    }
    return new Promise((resolve, reject) => {
        writer.end((err, ttl) => err ? reject(err) : resolve(ttl))
    })
}

// Yasqe calls `fetch(new Request(url, opts))` rather than `fetch(url, opts)`,
// so we normalise both forms into one shape.
const requestParts = async (input, init) => {
    if (input instanceof Request) {
        return { url: input.url, method: input.method, headers: input.headers, body: input.method !== "GET" ? await input.text() : "" }
    }
    const headers = new Headers(init?.headers || {})
    const body = init?.body != null ? (typeof init.body === "string" ? init.body : String(init.body)) : ""
    const url = input instanceof URL ? input.href : (typeof input === "string" ? input : input?.url || "")
    return { url, method: init?.method || "GET", headers, body }
}

// Pull the query string out of a GET (?query=) or POST (sparql-query body, or
// form-encoded query/update) request — the shapes Yasqe sends.
const extractQuery = ({ url, method, headers, body }) => {
    if (method !== "GET" && body) {
        if ((headers.get("Content-Type") || "").includes("application/sparql-query")) return body
        const params = new URLSearchParams(body)
        const query = params.get("query") || params.get("update")
        if (query) return query
    }
    return new URL(url, window.location.origin).searchParams.get("query")
}

const json = (body) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/sparql-results+json" } })

// Run a query and shape the result the way Yasr expects: SPARQL-JSON for
// SELECT/ASK, Turtle for CONSTRUCT/DESCRIBE.
const handleSparql = async (parts) => {
    const query = extractQuery(parts)
    if (!query) return new Response("missing query", { status: 400 })
    try {
        const result = await queryEngine.query(query, { sources: [store] })
        if (result.resultType === "bindings") {
            const metadata = await result.metadata()
            const vars = metadata.variables.map(v => v.value)
            const bindings = await collectBindings(await result.execute())
            return json({ head: { vars }, results: { bindings } })
        }
        // Yasr 4.6.1's JSON parser reads results.bindings unguarded, so a bare
        // {boolean} ASK body throws there — an empty bindings list sidesteps it.
        if (result.resultType === "boolean") return json({ head: {}, boolean: await result.execute(), results: { bindings: [] } })
        if (result.resultType === "quads") {
            const ttl = await collectQuadsAsTurtle(await result.execute())
            return new Response(ttl, { headers: { "Content-Type": "text/turtle" } })
        }
        return new Response("")
    } catch (e) {
        return new Response(String(e?.message || e), { status: 400 })
    }
}

// Route requests to the fake endpoint through Comunica; everything else (CDN
// assets, prefix autocompletion) hits the real network.
const nativeFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
    let url = ""
    if (input instanceof Request) {
        url = input.url
    } else if (input instanceof URL) {
        url = input.href
    } else if (typeof input === "string") {
        url = input
    } else if (input && typeof input === "object" && "url" in input) {
        url = input.url
    }

    if (!url || !url.startsWith(ENDPOINT)) return nativeFetch(input, init)
    return handleSparql(await requestParts(input, init))
}

Yasgui.Yasqe.defaults.value = INITIAL_QUERY
new Yasgui(document.getElementById("yasgui"), {
    requestConfig: { endpoint: ENDPOINT, method: "POST" },
    copyEndpointOnNewTab: false,
    populateFromUrl: false,
})
