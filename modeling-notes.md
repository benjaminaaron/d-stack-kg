# Modeling notes

How step 4 turns `landscape.yml` into the RDF knowledge graph (`data/1-build-kg/landscape.ttl`), the judgement calls along the way, and a few notes on the source data.

## Lift, then transform

1. **Lift**: [SPARQL Anything](https://sparql-anything.cc) triplifies `landscape.yml` into the raw, generic Facade-X model, dumped verbatim (`sparql/lift.sparql`). No interpretation.
2. **Transform**: `CONSTRUCT` queries (`sparql/transform/*.sparql`) navigate that raw model into the graph. They run one after another but are independent, so order makes no difference.

It reuses international vocabularies (**SKOS** for the taxonomy, **Dublin Core** and **schema.org** for item metadata) plus a small `dstack:` namespace where nothing standard fits:

- category/subcategory tree → a SKOS `ConceptScheme` (Schicht → Gruppe)
- each item → a typed `dstack:StackElement`, with `skos:prefLabel`, `dct:description`, `schema:url`, and `dct:subject` → its Gruppe
- the six Konformität scores → `dstack:Konformitaetsbewertung` nodes (level + a normalized 0–100 value) against six `dstack:Kriterium`
- the "root subject" (`ds:landkarte`) carries some self-describing additions

This is the semantic core, not the full Landkarte. Fields left for later enrichment: tags, `summary`/use-case text, maturity dates, audits, and the sparse `cf_overall_value`.

## Choices made along the way

Judgement calls with defensible alternatives; each lives in a single `CONSTRUCT` file, so swapping one is a one-line change.

| Decision | Choice | Note |
|---|---|---|
| IRI namespace | `…deutschland-stack.gov.de/id/<slug>` | Placeholder IRIs, they don't resolve |
| Item IRI | slug of the display name, parentheticals dropped | Collision-free for all 128; full name (incl. AG-UI, MCP, …) stays in `skos:prefLabel`. The `full.json` `id` is a landscape2 build artifact, deliberately unused; revisit before other datasets link in. |
| Item label | `skos:prefLabel` | Alternatives e.g. `rdfs:label` |
| Homepage | `schema:url` | Alternatives e.g. `foaf:homepage` |
| Owner | `dstack:verantwortlicheStelle` | `bs_owner` is the responsible Steckbrief body, not a DCT publisher; kept as a source-faithful literal over `dct:publisher` |
| Version | `schema:version` | Heterogeneous (`RFC 8446`, `v1.34.1`, `Release 18`, …); kept as a loose literal |
| Logo | `dstack:landkarteLogoFile` (filename literal) | Build-projection fact, not domain: the landscape2 logo basename only (image files stay in `…/upstream/logos.zip`, staged at build). `schema:logo` expects a URL/ImageObject, not a bare filename; the `landkarte` prefix marks it build-support. |
| Source order | `dstack:landkartePosition` (`xsd:integer`) | Category/subcategory/item order, read from the Facade-X `rdf:_N` container index. RDF is unordered, so without it the roundtrip couldn't reproduce the layout; the `landkarte` prefix keeps it distinct from domain semantics. |
| Item → category | `dct:subject` → SKOS concept | The standard "topic" link; `dcat:theme` is the DCAT-specific variant |
| Konformität | custom reified node | A domain construct, stated honestly. `schema:Rating` implies a subjective review; [RDF Data Cube](https://www.w3.org/TR/vocab-data-cube/) would be rigorous but heavier |
| Konformität value | `dstack:wertProzent` as `xsd:decimal` (0–100) | Source is inconsistent (`10%`, `33,3%`, bare `63.0`); normalized to one queryable number. `dstack:stufe` (1–5) is the independent level. |
| Konformität annotation key | `dstack:landkarteAnnotationKey` (on the Kriterium) | The landscape2 `cf_*` stem (e.g. `cf_sovereignty`) on each Kriterium, so the roundtrip rebuilds annotations without a hardcoded reverse map. A build-projection fact, like logo/position. |
| Kriterium German names | transcribed from the live site | The one input not in `full.json` (which has only the `cf_*` keys + "N von 5"/% values); read off the live Landkarte's Konformität monitor, documented in `3-konformitaet.sparql`. |
| Vocabulary term names | German | Matches the source and audience |

### Two reconstruction limits

**Official tile links.** The website deep-links each tile as `…/?item=<id>` with the landscape2 build id (e.g. `-plattform---daten--comma-separated-values-csv`). We don't store it: it can't be reconstructed from `landscape.yml` (step 2 normalizes away the leading-whitespace quirk the id bakes in, and landscape2's slugger has special cases: it keeps `+` in `C++` and doubles some separators), and survives only in `full.json`. If we later need the official landing page, we'll read the `id` from there (as `dct:identifier` plus a `foaf:page` link) rather than recompute it.

**Group order within a Schicht.** `dstack:landkartePosition` carries the source order and the roundtrip reproduces it faithfully, but the official group order *within* a Schicht lives only in the original `settings.yml`, which we never had. Step 2's only input, `full.json`, lists groups in a different order (Plattform even appears twice under different leading-whitespace prefixes), so Schicht and item-within-group order come out right but group order within a Schicht does not (Plattform renders KI, LowCode, Daten, Integration instead of the official Daten, Integration, KI, LowCode). Like the tile `id`, the fix is the upstream `settings.yml`; the modeling is forward-compatible once step 2 has it.

## Notes on the source data

A few things surfaced while working with the Landkarte's published artifacts:

- The two CSV files under the site's Download are lossy exports of the build output (default landscape2 behaviour, not a BMDS addition), missing content versus the `landscape.yml`/`settings.yml` they were built from, which probably live in the repo the footer links to (public once, now a 404).
- The data model is inherited from the CNCF landscape and fits its new purpose imperfectly: some fields are repurposed, e.g. license under `summary.release_rate`, operating systems under `summary.personas`.
- Category/subcategory labels carry inconsistent leading whitespace: a normal space (U+0020) mixed with an en-quad (U+2000), so one category splits across several distinct strings; the reconstruction normalizes them back to the four intended categories.

## The administrative layer (the PVOG enrichment)

The enrich phase (`src/2-enrich-kg`) adds a second floor: the public services the state delivers, ingested live from the FITKO PVOG Suchdienst and bridged to the technical layer. The rule is the opposite of the tech layer's tiny `dstack:` namespace: **reuse the standard EU public-service vocabularies directly**, so a CPSV-AP query runs on this data unchanged. It lives in its own files (`pvog-leistungen.ttl` for services, `pvog-dstack-bridge.assumed.ttl` for the bridge), kept separate from `d-stack-kg.ttl` so the three provenances (BMDS Landkarte / FITKO PVOG / our bridge) stay distinct; consumers compose them in-store (the Landkarte roundtrip uses only the technical layer).

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

The local FIM terms (`fim:leikaId`, `fim:Datenfeld`, `fim:Datenfeldgruppe`; FIM publishes no official RDF) are aligned upward to openDVA's **GerPS**, the one published RDF rendering of these concepts. The alignment is **not load-bearing**; we add it to anchor the local terms to an existing standard and let a GerPS-aware consumer reach our instances.

## The kommunale-IT use case

No municipality publishes its IT landscape openly and machine-readably, so this use case invents one (`authored/musterstadt-it-landschaft.fictional.ttl`, "Stadt Musterstadt"). The fiction is the *landscape*; everything it leans on is real: it is modelled in **ArchiMate** (reusing the [ArchiMate Ontology](https://github.com/AlbertoDMendoza/archimate_ontology) by IRI, like cpsv/m8g/GerPS) and joins the technical layer by pointing at **real `ds:` Landkarte elements** via `dct:conformsTo`:

| Situation | Modelling | Reading |
|---|---|---|
| Covered | `dct:conformsTo` a `dstack:StackElement` | follows a real Landkarte element |
| Gap | `dct:conformsTo` a `dstack:ReferenzierterStandard` (`dstack:inLandkarte false`) | follows a real, governed standard the Landkarte does not list (e.g. XMeld, WMS) |
| Island | no `dct:conformsTo` | a proprietary component with no open standard |

The third column is the point the format makes: machine-computable conformance only works if a landscape references standards by **stable IRI**. `mus:it-landschaft` (a `dcat:Dataset`) `dct:hasPart` its components, so queries anchor on the named landscape.

On top sits a **planning layer** (`musterstadt-chatbot.scenario.ttl`): a project (`archimate:WorkPackage`) `dstack:benoetigt` capabilities (`archimate:Capability`), each with `dstack:kandidat` options, a `ds:` StackElement or a non-Stack alternative. Reuse-vs-new and the before/after coverage are not stored; they follow from the landscape via SPARQL.

## The communication layer

Explanations about the Stack normally live *apart* from the model and go stale. This use case (`authored/comms.authored.ttl`) hangs them onto the graph instead, so a finished piece is a **projection of the graph**: only the framing prose is authored, every figure is a live query result.

`dstack:Textbaustein` is the one local term (a 9→1 reuse trim from a first cut); everything else is reused. The defining choice is **`sh:select`** (borrowed from SHACL-SPARQL as a carrier property, no validation implied): each snippet carries *its own* query as a literal, run live by the webapp, so the logic sits in the graph rather than hidden in the page. The two fuller artefacts (per-Leistung Steckbrief, cross-layer footprint) reuse `schema:Report` and carry their `sh:select` the same way.

The Steckbrief shows two audiences without a new property: both registers ride the same `dct:description`, told apart by language tag — **technisch** is the upstream Landkarte text (`@de`, kept verbatim for provenance), **fachlich** an authored `@de-x-fachlich` value (authored only for the bridged elements). And one Blickwinkel, »Lücken«, is the deliberate counter-angle (`dstack:inLandkarte false`), so a graph-rendered piece never reads as pure promotion.
