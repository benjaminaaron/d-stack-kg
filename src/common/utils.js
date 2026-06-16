import { fileURLToPath } from "url"
import path from "path"

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

// data/ mirrors src/'s phase folders: each artefact sits under the phase that
// produces it. All committed except scratch.
const DATA = path.join(ROOT, "data")
export const BUILD_KG = path.join(DATA, "1-build-kg")                   // 1-build-kg outputs
export const UPSTREAM = path.join(BUILD_KG, "upstream")                // external snapshot (1-fetch)
export const RECONSTRUCTED = path.join(BUILD_KG, "reconstructed")      // derived landscape2 source (2-reconstruct)
export const LANDSCAPE_TTL = path.join(BUILD_KG, "landscape.ttl")      // lifted graph (4-build-graph)
export const ENRICH_KG = path.join(DATA, "2-enrich-kg")                // 2-enrich-kg outputs
export const DSTACK_TTL = path.join(ENRICH_KG, "d-stack-kg.ttl")       // the technical graph (kg:enrich)
export const PVOG_LEISTUNGEN_TTL = path.join(ENRICH_KG, "pvog-leistungen.ttl")    // administrative services (pvog:fetch)
export const USE_CASES = path.join(DATA, "3-use-cases")                // use-case derived artefacts
export const SCRATCH = path.join(DATA, "scratch")                      // gitignored regenerable

// authored/ holds the project's hand-written RDF (not generated/fetched): the
// vocabulary it mints and the assumed bridge it proposes
export const AUTHORED = path.join(ROOT, "authored")
export const VOCABULARY_TTL = path.join(AUTHORED, "vocabulary.ttl")
export const PVOG_DSTACK_BRIDGE_TTL = path.join(AUTHORED, "pvog-dstack-bridge.assumed.ttl") // the assumed bridge layer

// RDF prefixes for serializing the graph. Merged with the sem-ops-utils
// defaults on output, which already cover rdf/rdfs/xsd/schema.
export const PREFIXES = {
    skos: "http://www.w3.org/2004/02/skos/core#",
    dct: "http://purl.org/dc/terms/",
    ds: "https://deutschland-stack.gov.de/id/",
    dstack: "https://deutschland-stack.gov.de/vocab#",
    // the EU public-service vocabularies the administrative layer reuses, plus the
    // local namespace for the FIM identifiers that have no standard RDF term
    cpsv: "http://purl.org/vocab/cpsv#",
    m8g: "http://data.europa.eu/m8g/",
    fim: "https://deutschland-stack.gov.de/fim#",
}
