import { fileURLToPath } from "url"
import path from "path"

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
export const UPSTREAM = path.join(ROOT, "data", "upstream")            // committed external snapshot
export const RECONSTRUCTED = path.join(ROOT, "data", "reconstructed")  // committed derived source
export const GRAPH = path.join(ROOT, "data", "graph")                  // committed knowledge graph
export const SCRATCH = path.join(ROOT, "data", "scratch")              // gitignored regenerable

// RDF prefixes for serializing the graph. Merged with the sem-ops-utils
// defaults on output, which already cover rdf/rdfs/xsd/schema.
export const PREFIXES = {
    skos: "http://www.w3.org/2004/02/skos/core#",
    dct: "http://purl.org/dc/terms/",
    ds: "https://deutschland-stack.gov.de/id/",
    dstack: "https://deutschland-stack.gov.de/vocab#",
}
