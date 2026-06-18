# Modeling choices

How step 4 turns `landscape.yml` into the RDF knowledge graph (`data/1-build-kg/landscape.ttl`), and the judgement calls along the way.

## Lift, then transform

1. **Lift**: [SPARQL Anything](https://sparql-anything.cc) triplifies `landscape.yml` into the raw, generic Facade-X model, dumped verbatim (`sparql/lift.sparql`). No interpretation.
2. **Transform**: `CONSTRUCT` queries (`sparql/transform/*.sparql`) navigate that raw model into the graph. The queries are applied one after another, but they are independent, so the order makes no difference.

It reuses international vocabularies - **SKOS** (taxonomy), **Dublin Core** and **schema.org** (item metadata) - with a small `dstack:` namespace where nothing standard fits:

- category/subcategory tree → a SKOS `ConceptScheme` (Schicht → Gruppe)
- each item → a typed `dstack:StackElement`, with `skos:prefLabel`, `dct:description`, `schema:url`, and `dct:subject` → its Gruppe
- the six Konformität scores → `dstack:Konformitaetsbewertung` nodes (level + a normalized 0–100 value) against six `dstack:Kriterium`
- the "root subject" (`ds:landkarte`) carries some self-describing additions

This is the semantic core, not the full Landkarte. Source fields left for later enrichment: tags, `summary`/use-case text, maturity dates, audits, and the sparse `cf_overall_value`.

## Choices made along the way

Judgement calls with defensible alternatives; each lives in a single `CONSTRUCT` file, so swapping one is a one-line change:

| Decision | Choice | Note |
|---|---|---|
| IRI namespace | `…deutschland-stack.gov.de/id/<slug>` | Placeholder IRIs, they don't resolve |
| Item IRI | slug of the display name, parentheticals dropped | Collision-free for all 128 items; the full name (incl. AG-UI, MCP, …) stays in `skos:prefLabel`. The `full.json` `id` is a landscape2 build artifact, not in `landscape.yml` — deliberately unused; revisit before other datasets link in. |
| Item label | `skos:prefLabel` | Alternatives e.g. `rdfs:label` |
| Homepage | `schema:url` | Alternatives e.g. `foaf:homepage` |
| Owner | `dstack:verantwortlicheStelle` | `bs_owner` is the responsible Steckbrief body, not a DCT publisher — a source-faithful `dstack:` literal over `dct:publisher` |
| Version | `schema:version` | Heterogeneous (`RFC 8446`, `v1.34.1`, `Release 18`, …); kept as a loose literal |
| Logo | `dstack:landkarteLogoFile` (filename literal) | A Landkarte-projection fact, not a domain one — the `landscape2` logo basename only; the image files stay in `data/1-build-kg/upstream/logos.zip`, staged at build time. `schema:logo` expects a URL/ImageObject, which a bare filename isn't, and the `landkarte` prefix marks it as build-support rather than a universal statement |
| Source order | `dstack:landkartePosition` (`xsd:integer`) | Category/subcategory/item order in the Landkarte projection, read from the Facade-X `rdf:_N` container index. RDF is unordered, so without it the roundtrip couldn't reproduce the original layout; the `landkarte` prefix keeps it distinct from domain semantics |
| Item → category | `dct:subject` → SKOS concept | The standard "topic" link; `dcat:theme` is the DCAT-specific variant |
| Konformität | custom reified node | A domain construct, stated honestly. `schema:Rating` implies a subjective review; [RDF Data Cube](https://www.w3.org/TR/vocab-data-cube/) would be rigorous but heavier |
| Konformität value | `dstack:wertProzent` as `xsd:decimal` (0–100) | Source is inconsistent (`10%`, `33,3%`, bare `63.0`); normalized to one queryable number. `dstack:stufe` (1–5) is the independent level |
| Konformität annotation key | `dstack:landkarteAnnotationKey` (on the Kriterium) | The landscape2 `cf_*` annotation stem (e.g. `cf_sovereignty`), kept on each Kriterium so the roundtrip rebuilds the source annotations without a hardcoded reverse map. A Landkarte-projection fact like logo/position, not a domain statement |
| Kriterium German names | transcribed from the live site | The six category names are the one input not in `full.json` (it has only the `cf_*` keys + "N von 5"/% values); read off the live Landkarte's Konformität monitor. Documented in `3-konformitaet.sparql` |
| Vocabulary term names | German | Matches the source and audience |

### Official tile links, deferred

The website deep-links each tile as `…/?item=<id>`, where `<id>` is the landscape2 build id (e.g. `-plattform---daten--comma-separated-values-csv`). We don't store it for now. It also can't be reconstructed from `landscape.yml`: the id bakes in the upstream leading-whitespace quirk that step 2 normalizes away (it would come out without the leading `-`), and landscape2's slugger has special cases a naive recompute misses (keeps `+` in `C++`, emits a double dash for some separators). The live-matching id only survives in `data/1-build-kg/upstream/full.json`. So if we later need the official landing page, we will read the `id` from there - e.g. as `dct:identifier` plus a `foaf:page` link - rather than recomputing it.

### Group order within a Schicht, only partially recoverable

`dstack:landkartePosition` carries the source order and the roundtrip reproduces it faithfully — landscape2 honours order; the catch is upstream. The official display order lives only in the original `settings.yml`, which we never had. Step 2's only input, `full.json`, lists groups in a different order (it even carries "Plattform" twice under different leading-whitespace prefixes), so Schicht and item-within-group order come out right but group order within a Schicht does not - Plattform renders KI, LowCode, Daten, Integration instead of the official Daten, Integration, KI, LowCode. Like the tile `id` above, the fix is the upstream `settings.yml`, not `full.json`; the modeling is forward-compatible once step 2 has the right order.

## The administrative layer (the PVOG enrichment)

The enrich phase (`src/2-enrich-kg`) adds a second floor: the public services the state delivers, ingested live from the FITKO PVOG Suchdienst and bridged to the technical layer. The rule is the opposite of the tech layer's tiny `dstack:` namespace — **reuse the standard EU public-service vocabularies directly**, so a CPSV-AP query (plain SPARQL over the EU's standard public-service vocabulary) runs on this data unchanged. It lives in its own files — `pvog-leistungen.ttl` (services) and `pvog-dstack-bridge.assumed.ttl` (bridge) — kept separate from `d-stack-kg.ttl` so the three provenances (BMDS Landkarte / FITKO PVOG / our bridge) stay distinct; consumers compose them in-store.

Instances carry the authoritative EU class directly:

| Element | Term |
|---|---|
| Public service | `cpsv:PublicService` (CPSV-AP 3.2.0; GerPS types its "Leistung" the same way) |
| Responsible body | `m8g:PublicOrganisation` + `m8g:hasCompetentAuthority` |
| Life situation | `m8g:LifeEvent` + `m8g:isGroupedBy` (the PVOG `personalMatters` leaf) |
| Online service | `m8g:Channel` + `m8g:hasChannel` (carries the real `schema:url`) |
| Legal basis / cost | `cpsv:follows`→`cpsv:Rule` / `m8g:hasCost`→`m8g:Cost` |
| Name / description / language / validity | `dct:title` / `dct:description` / `dct:language` / `schema:validFrom`+`validThrough` |
| PVOG lbid | `dct:identifier` |

Three identifiers have no off-the-shelf term: **LeiKa-ID** (FIM has no official RDF namespace) becomes a readable local `fim:leikaId`, aligned `rdfs:subPropertyOf` the GerPS "has LeiKa-ID" property; **ARS** points `dct:spatial` at the DCAT-AP.de regional-key IRI; **lbid** is a plain `dct:identifier`.

**The bridge** is a single predicate, `dstack:realisiertDurch` (`m8g:Channel` → `dstack:StackElement`), over **only real Landkarte elements**. No source records which technologies a service runs on, so the edges (`pvog-dstack-bridge.assumed.ttl`) are **assumed**, not derived.

Conversion follows the build-kg idiom: SPARQL Anything lift → `CONSTRUCT` transform (`pvog/sparql/`).

### Frontend channel vs. delivery point

PVOG and FIT-Connect describe the *same* LeiKa-joined service from opposite ends: PVOG the citizen-facing **frontend channel** (`m8g:Channel`, the Onlinedienst with its URL), FIT-Connect the **backend delivery point** (`fitconnect:Zustellpunkt` plus the Fachdatenschema). Each end carries its own link into the technical layer, on a different node and with a different epistemic status: on the channel, no source reveals the runtime stack, so `dstack:realisiertDurch` is **assumed** (standards/protocols only, never products); on the delivery point the running system reveals the schema's serialisation format, so `dstack:serialisiertAls` is **observed**. Holding both on one service is what lets the graph contrast *expected* against *actual*.

### GerPS alignment, deliberate but not load-bearing

The local FIM terms (`fim:leikaId`, `fim:Datenfeld`, `fim:Datenfeldgruppe`; FIM publishes no official RDF) are aligned upward to openDVA's **GerPS**, the one published RDF rendering of these concepts. The alignment is **not load-bearing**. We add it anyway, to anchor the local terms to an existing standard and let a GerPS-aware consumer reach our instances.
