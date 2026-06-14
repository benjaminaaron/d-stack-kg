import { fileURLToPath } from "url"
import path from "path"

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
export const UPSTREAM = path.join(ROOT, "data", "upstream")            // committed external snapshot
export const RECONSTRUCTED = path.join(ROOT, "data", "reconstructed")  // committed derived source
export const GRAPH = path.join(ROOT, "data", "graph")                  // committed knowledge graph
export const SCRATCH = path.join(ROOT, "data", "scratch")              // gitignored regenerable
