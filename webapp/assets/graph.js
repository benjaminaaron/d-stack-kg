// The knowledge graph's layers — technical (d-stack-kg) + PVOG services + the FIM
// Steckbrief enrichment + the FIT-Connect Zustellpunkte/Fachdatenschemata + the assumed
// bridge — inlined by Vite (?raw) and loaded into one in-browser store. That composition
// is the join the project is about; shared by every page that queries it (the Query page
// and the use-case pages).

import dstackTtl from "../../data/2-enrich-kg/d-stack-kg.ttl?raw"
import leistungenTtl from "../../data/2-enrich-kg/pvog-leistungen.ttl?raw"
import fimTtl from "../../data/2-enrich-kg/fim-leistungen.ttl?raw"
import fitConnectTtl from "../../data/2-enrich-kg/fit-connect.ttl?raw"
import bridgeTtl from "../../authored/pvog-dstack-bridge.assumed.ttl?raw"
import { storeFromTurtles } from "@foerderfunke/sem-ops-utils/core"

export const graphStore = () => storeFromTurtles([dstackTtl, leistungenTtl, fimTtl, fitConnectTtl, bridgeTtl])
