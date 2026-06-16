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
import { EXAMPLES } from "./query-examples.js"

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
const yasgui = new Yasgui(document.getElementById("yasgui"), {
    requestConfig: { endpoint: ENDPOINT, method: "POST" },
    copyEndpointOnNewTab: false,
    populateFromUrl: false,
})

// --- Visual query builder (Sparnatural) ------------------------------------
// Sparnatural ships as a heavy prebuilt browser bundle (its own jQuery + an RDF
// stack), so we don't run it through our Vite build — we load it from a CDN, and
// only on first toggle, to keep the default Query page light. It emits SPARQL on
// `queryUpdated`, which we drop straight into the editor; the same fake endpoint
// + Comunica interceptor backs both its value lists and the editor's runs.

// served verbatim from public/ (a real .ttl URL so Sparnatural detects Turtle)
const sparnaturalConfigUrl = import.meta.env.BASE_URL + "dstack.sparnatural.ttl"

const SPARNATURAL_VERSION = "12.2.1"
const cdn = path => `https://cdn.jsdelivr.net/npm/${path}`

const addStylesheet = href => {
    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.href = href
    document.head.append(link)
}

let loading
let stylesAdded = false
const loadSparnatural = () => {
    if (loading) return loading
    if (!stylesAdded) {
        addStylesheet(cdn(`sparnatural@${SPARNATURAL_VERSION}/dist/browser/sparnatural.css`))
        addStylesheet(cdn("@fortawesome/fontawesome-free@6.5.2/css/all.min.css"))
        stylesAdded = true
    }
    loading = new Promise((resolve, reject) => {
        const script = document.createElement("script")
        script.src = cdn(`sparnatural@${SPARNATURAL_VERSION}/dist/browser/sparnatural.js`)
        script.onload = resolve
        script.onerror = () => reject(new Error("could not load Sparnatural from the CDN"))
        document.head.append(script)
    }).then(() => customElements.whenDefined("spar-natural"))
    return loading
}

const yasqe = () => yasgui.getTab().getYasqe()

const SKOS_PREFLABEL = "http://www.w3.org/2004/02/skos/core#prefLabel"
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label"

// List dropdown values come from our own store via Comunica, not the (fake) HTTP
// endpoint. Sparnatural hands the provider the SHACL *shape* IRIs (not the real
// class/predicate), so expandSparql maps them to graph terms before we query — the
// same quirk as the editor query (#454). getListContent is push-based, and items
// must be shaped { term: <SPARQL-JSON term>, label } (12.2.x).
const makeListProvider = (el) => ({
    init() {},
    async getListContent(domain, predicate, range, callback, errorCallback) {
        // match either label property, mirroring the generator's label rule. The config
        // only points list pickers at label-bearing classes (label-less ranges become
        // NonSelectableProperty), so this mainly guards future rdfs:label-only classes.
        const raw = `SELECT DISTINCT ?value ?label WHERE {
    ?s a <${domain}> ; <${predicate}> ?value .
    ?value <${SKOS_PREFLABEL}>|<${RDFS_LABEL}> ?label .
} ORDER BY ?label`
        try {
            const q = el.expandSparql ? el.expandSparql(raw) : raw
            const result = await queryEngine.query(q, { sources: [store] })
            const items = []
            for await (const b of await result.execute()) {
                const value = b.get("value")
                if (!value) continue
                const label = b.get("label")
                items.push({ term: { type: "uri", value: value.value }, label: label?.value || value.value })
            }
            callback(items)
        } catch (err) {
            console.error("[sparnatural] list query failed", err)
            if (errorCallback) errorCallback(err)
        }
    },
})

let sparnatural = null         // the live <spar-natural>, built lazily on first open
let sparnaturalReady = null    // resolves on its `init` — loadQuery() needs the config parsed
let runAfterBuild = false      // auto-run the editor once a loaded example settles
let runTimer = null

const buildSparnatural = (wrap) => {
    const el = document.createElement("spar-natural")
    const attrs = { src: sparnaturalConfigUrl, endpoint: ENDPOINT, lang: "en", defaultLang: "de", distinct: "true", limit: "100" }
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    // fill list dropdowns from our own store rather than the (fake) HTTP endpoint;
    // set both now and on init, since either timing can be the one that's honored
    const listDataProvider = makeListProvider(el)
    const setCustomization = () => { el.customization = { list: { dataProvider: listDataProvider } } }
    setCustomization()
    el.addEventListener("init", setCustomization)
    // mirror the visually-built query into the editor; run it on the play button.
    // Sparnatural emits the raw query with SHACL shape IRIs by design — expandSparql
    // rewrites them to the real sh:targetClass / sh:path terms (see Sparnatural #454).
    el.addEventListener("queryUpdated", e => {
        const raw = e.detail?.queryString
        if (raw) yasqe().setValue(el.expandSparql ? el.expandSparql(raw) : raw)
        if (runAfterBuild) {           // a picked example just loaded — run it once it settles
            clearTimeout(runTimer)
            runTimer = setTimeout(() => { runAfterBuild = false; yasqe().query() }, 150)
        }
    })
    el.addEventListener("submit", () => yasqe().query())
    sparnaturalReady = new Promise(resolve => el.addEventListener("init", resolve, { once: true }))
    wrap.replaceChildren(el)   // also clears any earlier CDN-error message
    return el
}

const toggle = document.getElementById("toggle-visual")
const wrap = document.getElementById("sparnatural-wrap")
const builderHint = document.getElementById("builder-hint")

// load the CDN bundle and build the element once; later calls reuse it
const ensureSparnatural = async () => {
    if (sparnatural) return sparnatural
    toggle.disabled = true
    try {
        await loadSparnatural()
        sparnatural = buildSparnatural(wrap)
        return sparnatural
    } catch (e) {
        wrap.textContent = String(e?.message || e)
        loading = undefined        // let a later open retry the failed CDN load
        throw e
    } finally {
        toggle.disabled = false
    }
}

const showBuilder = async () => {
    wrap.hidden = false
    builderHint.hidden = false
    toggle.setAttribute("aria-expanded", "true")
    return ensureSparnatural()
}
const hideBuilder = () => {
    wrap.hidden = true
    builderHint.hidden = true
    toggle.setAttribute("aria-expanded", "false")
}

toggle.addEventListener("click", () => {
    if (wrap.hidden) showBuilder().catch(() => {})
    else hideBuilder()
})

// --- example queries: into the editor, or into the visual builder -----------
const examples = document.getElementById("examples")
let visualGroup = null
EXAMPLES.forEach((ex, i) => {
    const opt = document.createElement("option")
    opt.value = String(i)
    opt.textContent = ex.name
    if (ex.visual) {
        // group the builder examples under one non-selectable header (replaces the
        // per-item "(visual query builder)" suffix)
        if (!visualGroup) {
            visualGroup = document.createElement("optgroup")
            visualGroup.label = "Visual query builder"
            examples.append(visualGroup)
        }
        visualGroup.append(opt)
    } else {
        examples.append(opt)
    }
})
examples.addEventListener("change", async () => {
    const ex = EXAMPLES[Number(examples.value)]
    if (!ex) return                // the placeholder; the picked example otherwise stays shown
    if (ex.visual) {
        try {
            const el = await showBuilder()
            await sparnaturalReady     // wait for the config to be parsed before loading
            runAfterBuild = true       // run the query once Sparnatural mirrors it to the editor
            el.loadQuery(structuredClone(ex.visual))
        } catch (err) {
            console.error("[examples] could not load the visual query", err)
        }
    } else {
        hideBuilder()              // an editor example replaces the query — collapse the builder
        yasqe().setValue(ex.sparql)
        yasqe().query()
    }
})
