# Modeling choices

How step 4 turns `landscape.yml` into the RDF knowledge graph (`data/graph/landscape.ttl`), and the judgement calls along the way.

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
| Logo | `dstack:logo` (filename literal) | The basename only; the image files stay in `data/upstream/logos.zip`, staged at build time. `schema:logo` expects a URL/ImageObject, which a bare filename isn't |
| Source order | `dstack:position` (`xsd:integer`) | Category/subcategory/item order, read from the Facade-X `rdf:_N` container index. RDF is unordered, so without it the roundtrip couldn't reproduce the original layout |
| Item → category | `dct:subject` → SKOS concept | The standard "topic" link; `dcat:theme` is the DCAT-specific variant |
| Konformität | custom reified node | A domain construct, stated honestly. `schema:Rating` implies a subjective review; [RDF Data Cube](https://www.w3.org/TR/vocab-data-cube/) would be rigorous but heavier |
| Konformität value | `dstack:wertProzent` as `xsd:decimal` (0–100) | Source is inconsistent (`10%`, `33,3%`, bare `63.0`); normalized to one queryable number. `dstack:stufe` (1–5) is the independent level |
| `cf_actuality` → "Zukunftsfähigkeit" | inferred | The other five criteria are literal name matches; this one is a guess (methodology unpublished) |
| Vocabulary term names | German | Matches the source and audience |

### Official tile links, deferred

The website deep-links each tile as `…/?item=<id>`, where `<id>` is the landscape2 build id (e.g. `-plattform---daten--comma-separated-values-csv`). We don't store it for now. It also can't be reconstructed from `landscape.yml`: the id bakes in the upstream leading-whitespace quirk that step 2 normalizes away (it would come out without the leading `-`), and landscape2's slugger has special cases a naive recompute misses (keeps `+` in `C++`, emits a double dash for some separators). The live-matching id only survives in `data/upstream/full.json`. So if we later need the official landing page, we will read the `id` from there - e.g. as `dct:identifier` plus a `foaf:page` link - rather than recomputing it.
