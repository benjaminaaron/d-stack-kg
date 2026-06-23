// The knowledge graph's layers — technical (d-stack-kg) + PVOG services + the FIM
// Steckbrief enrichment + the FIT-Connect Zustellpunkte/Fachdatenschemata + the assumed
// bridge + the fictional municipal IT landscape (Musterstadt) + the communication layer
// (comms snippets, each carrying its own query) + the governance layer (the IT-Planungsrat
// Beschlusslage: Standardbereiche + Basisdienste) + the 115 First-Level-Support layer (per-Onlinedienst
// Betriebsstatus/Hilfe/Eskalation + colloquial Stichworte) — inlined by Vite (?raw) and loaded into one
// in-browser store. That composition is the join the project is about; shared by every page
// that queries it (the Query page and the use-case pages).
//
// Each layer is loaded TWICE: once into the default graph (so every existing query keeps its
// usual default-graph semantics, unchanged) and once into a per-layer named graph. The named
// graphs make provenance queryable — GRAPH ?g { ... } tells you which layer a triple came from,
// and the meta block below describes each named graph (its Herkunft: official, transcribed,
// authored, assumed, fictional, scenario — the file-naming convention, made queryable). This is
// what the Selbstauskunft page rests on; nothing else needs to change because the default
// graph still answers ordinary queries exactly as before (verified: identical counts, no leakage —
// the meta uses only dstack: predicates).

import dstackTtl from "../../data/2-enrich-kg/d-stack-kg.ttl?raw"
import leistungenTtl from "../../data/2-enrich-kg/pvog-leistungen.ttl?raw"
import fimTtl from "../../data/2-enrich-kg/fim-leistungen.ttl?raw"
import fitConnectTtl from "../../data/2-enrich-kg/fit-connect.ttl?raw"
import bridgeTtl from "../../authored/pvog-dstack-bridge.assumed.ttl?raw"
import musterstadtTtl from "../../authored/musterstadt-it-landschaft.fictional.ttl?raw"
import chatbotTtl from "../../authored/musterstadt-chatbot.scenario.ttl?raw"
import commsTtl from "../../authored/comms.authored.ttl?raw"
import beschlusslageTtl from "../../authored/beschlusslage.authored.ttl?raw"
import support115Ttl from "../../authored/115-od-support.scenario.ttl?raw"
import { newStore, parser, getRdf } from "@foerderfunke/sem-ops-utils/core"

const rdf = getRdf()
const GRAPH = "https://deutschland-stack.gov.de/id/graph/"

// the layers in composition order, each with its provenance class (Herkunft) and a label. The
// Herkunft mirrors the file-naming convention: lifted data/ is "offiziell geliftet", the dated
// IT-Planungsrat decisions are "transkribiert", .authored prose is "verfasst", .assumed is
// "angenommen", .fictional is "fiktiv", .scenario is "Szenario".
export const LAYERS = [
    { ttl: dstackTtl,        key: "tech-stack",    datei: "d-stack-kg.ttl",                       herkunft: "offiziell geliftet", label: "Tech-Stack Landkarte" },
    { ttl: leistungenTtl,    key: "pvog",          datei: "pvog-leistungen.ttl",                  herkunft: "offiziell geliftet", label: "Verwaltungsleistungen (PVOG)" },
    { ttl: fimTtl,           key: "fim",           datei: "fim-leistungen.ttl",                   herkunft: "offiziell geliftet", label: "FIM-Steckbriefe & Datenfelder" },
    { ttl: fitConnectTtl,    key: "fit-connect",   datei: "fit-connect.ttl",                      herkunft: "offiziell geliftet", label: "FIT-Connect" },
    { ttl: beschlusslageTtl, key: "beschlusslage", datei: "beschlusslage.authored.ttl",           herkunft: "transkribiert",      label: "Beschlusslage des IT-Planungsrats" },
    { ttl: commsTtl,         key: "comms",         datei: "comms.authored.ttl",                   herkunft: "verfasst",           label: "Kommunikation (Textbausteine & Erklärungen)" },
    { ttl: bridgeTtl,        key: "bridge",        datei: "pvog-dstack-bridge.assumed.ttl",       herkunft: "angenommen",         label: "Brücke Technik ↔ Verwaltung" },
    { ttl: musterstadtTtl,   key: "musterstadt",   datei: "musterstadt-it-landschaft.fictional.ttl", herkunft: "fiktiv",          label: "Kommunale IT-Landschaft (Musterstadt)" },
    { ttl: chatbotTtl,       key: "chatbot",       datei: "musterstadt-chatbot.scenario.ttl",     herkunft: "Szenario",           label: "Chatbot (Musterstadt)" },
    { ttl: support115Ttl,    key: "support115",    datei: "115-od-support.scenario.ttl",          herkunft: "Szenario",           label: "115 First-Level-Support" },
]

const esc = (s) => String(s).replace(/"/g, '\\"')

export const graphStore = () => {
    const store = newStore()
    let meta = `@prefix dstack: <https://deutschland-stack.gov.de/vocab#> .\n`
    for (const L of LAYERS) {
        const g = rdf.namedNode(GRAPH + L.key)
        for (const q of parser.parse(L.ttl)) {
            store.addQuad(q.subject, q.predicate, q.object)        // default graph: ordinary queries, unchanged
            store.addQuad(q.subject, q.predicate, q.object, g)     // named graph: provenance becomes queryable
        }
        meta += `<${GRAPH}${L.key}> a dstack:Schicht ; dstack:herkunft "${esc(L.herkunft)}" ; dstack:schichtLabel "${esc(L.label)}" ; dstack:schichtDatei "${esc(L.datei)}" .\n`
    }
    for (const q of parser.parse(meta)) store.addQuad(q.subject, q.predicate, q.object)   // describe each graph (default graph)
    return store
}
