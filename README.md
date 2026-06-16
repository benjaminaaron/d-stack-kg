# Deutschland-Stack knowledge graph

This unofficial prototype explores possibilities that would arise from modeling the Deutschland-Stack as a knowledge graph. The data it uses is the reconstructed source artifact behind the compiled Landkarte dataset published online. The authoritative source is the official [Tech-Stack Landkarte](https://technologie.deutschland-stack.gov.de/).

- **Live site:** <https://benjaminaaron.codeberg.page/d-stack-kg>
- GitHub mirror (read-only): <https://github.com/benjaminaaron/d-stack-kg>

## The big picture

```mermaid
    flowchart TB
    subgraph sq ["The official Tech-Stack Landkarte"]
        direction LR
        repo["private repo<br/>(extended landscape2 + source artifacts)"] --> site["Tech-Stack-Landkarte<br/>website"] --> json["full.json<br/>(compiled dataset)"]
    end
    subgraph kg ["This project"]
        direction LR
        yml["reconstructed<br/>source artifacts"] --> ttl["landscape.ttl"] --> dstack["<b>d-stack-kg.ttl</b><br/>(enriched)"]
        dstack --> roundtrip["Reconstructed:</br>Tech-Stack Landkarte"]
        dstack --> more["more use cases..."]
    end
    sq -- "full.json" --> kg

    classDef private stroke-dasharray:5 5
    classDef key fill:#ffd24d,stroke:#cc8800,color:#3d2f00,stroke-width:2px
    classDef goal fill:#9ae6b4,stroke:#2f855a,color:#0f2e1f,stroke-width:2px
    class repo private
    class site key
    class roundtrip key
    class dstack goal
```

## Requirements

- Node.js
- Java for the SPARQL Anything lift in build step 4 (the jar auto-downloads)
- the [landscape2](https://github.com/cncf/landscape2) CLI for the roundtrip build/validate/serve (`brew install cncf/landscape2/landscape2`)

The package.json scripts cover only the default path: build the graph → enrich → build the use cases → run the webapp. Everything else (per-stage sub-steps, the roundtrip validation, the standalone landscape2 server) isn't wired up - but you can always run it directly. For the full experience from a fresh clone, run `npm install` and then the scripts in the order they appear in `package.json` (top to bottom) - that walks the whole pipeline end to end, from fetching the upstream dataset to the running webapp. Alternatively, start at `landkarte:prepare` - the enriched graph it consumes (`data/2-enrich-kg/d-stack-kg.ttl`) is committed, so `kg:build` and `kg:enrich` are optional.

## Building the knowledge graph
`src/1-build-kg`

| Step | What it does |
|---|---|
| **1. Fetch dataset** | Fetches [the compiled Landkarte dataset](https://technologie.deutschland-stack.gov.de/data/full.json) and its logos → `data/1-build-kg/upstream/` (`full.json` + metadata, `logos.zip`) |
| **2. Reconstruct source** | Reconstructs the landscape2 source files → `data/1-build-kg/reconstructed/` (`landscape.yml` + a minimal `settings.yml`)                                                               |
| **3. Validate roundtrip** | Structurally compares the rebuilt `full.json` against the authoritative one; to produce it, runs a full `landscape2 build` → `data/scratch/build/`                          |
| **4. Build graph** | Lifts `landscape.yml` to RDF with SPARQL Anything and transforms it via SPARQL queries into a knowledge graph → `data/1-build-kg/landscape.ttl`. More about the modeling choices along the way in [modeling-choices.md](modeling-choices.md) |

`npm run kg:build` chains steps 1, 2 and 4. Step 3 (roundtrip validation) is an optional check, run on its own: `node src/1-build-kg/3-validate-roundtrip.js`.

## Enriching the graph
`src/2-enrich-kg`

_TODO_

```bash
npm run kg:enrich # writes data/2-enrich-kg/d-stack-kg.ttl
```

## Use cases
`src/3-use-cases`

### Landkarte roundtrip
Rebuilds the `landscape2` source files (`landscape.yml` + `settings.yml`) straight from the graph and proves the rebuilt site matches upstream.

```bash
npm run landkarte:prepare  # graph → landscape.yml + settings.yml
npm run landkarte:render   # render it into the webapp (webapp/public/use-case/landkarte/)
```

The [deploy](.forgejo/workflows/deploy.yml) runs `landkarte:prepare` and `landkarte:render` to publish the Landkarte embedded in the [Tech-Stack Landkarte page](webapp/use-case/tech-stack-landkarte.html).

### Query builder
Profiles the graph (one class per `rdf:type`, one facet per predicate actually used on it, widgets inferred from the value types) into the SHACL config that drives the in-browser [Sparnatural](https://github.com/sparna-git/Sparnatural) visual query builder on the Query page. Labels come from the [vocabulary](definitions/vocabulary.ttl); a blocklist in the script drops build-support predicates.

```bash
npm run query-builder:prepare # d-stack-kg.ttl + vocabulary + blocklist → webapp/public/dstack.sparnatural.ttl
```

## Webapp
`webapp/`

```bash
npm run webapp:serve  # dev server
npm run webapp:build  # bundle to webapp/dist/
```

## Data

`data/` mirrors the `src/` folder. Only two artifacts are committed:

- `data/1-build-kg/upstream/`: the fetched artifacts plus provenance
- `data/2-enrich-kg/d-stack-kg.ttl`: the knowledge graph (the deliverable)

The intermediates, the use-case projections and `data/scratch/` are gitignored.

## Vocabulary
`definitions/vocabulary.ttl`

The work-in-progress vocabulary used in the knowledge graph. Rendered on the webapp's vocabulary page.

## Possible future work

A scratchpad of where this could go. Ideas? Please share!

**Vocabularies to wire in**

| Reuse | to |
|---|---|
| **GerPS** ontologies (openDVA / Uni Jena) | lift FIM `XDatenfelder`/`XProzess` into RDF, already aligned to the EU Core Vocabularies |
| **CPSV-AP** + **CCCEV** (EU / SEMIC) | describe public services and their eligibility criteria + evidence the standard way |
| **FIM / XÖV** — **XZuFi**, XDatenfelder, XProzess | add the national standards the D-Stack actually runs on as first-class elements |
| **PVOG** Suchdienst (FITKO) | pull real Leistungen as `cpsv:PublicService` nodes |
| **DCAT-AP.de** | catalogue the registers behind the data fields |
| **Wikidata** | link every responsible body and standard out to the open web |
| **eLexa** / interoperable Rechtsbegriffe (BMF/BMDS) | model deduplicated legal terms |

**Enriching the graph**

- `verantwortlicheStelle` strings (~70 orgs: IETF, W3C, …) → Wikidata-linked entities
- relation edges between the items (`dependsOn`, `implements`, `competesWith`) → connect the 128 currently-isolated items into one graph
- an administrative layer (service, legal term, data field, evidence, register), bridged to the tech layer by a single `dstack:enables` edge

## Observations

A few things surfaced while working with the Landkarte's published artifacts:

- The two CSV files under Download (top right corner) are lossy exports of the build output (default landscape2 behaviour, not a BMDS addition), missing content compared to the `landscape.yml` and `settings.yml` they were built from. Those probably live in the repository the footer links to, which seems to have been public once but now returns a 404.
- The data model is inherited from the CNCF landscape and fits its new purpose imperfectly. Some fields are repurposed: license information appears under `summary.release_rate` and operating systems under `summary.personas`.
- Category and subcategory labels carry inconsistent leading whitespace — a mix of a normal space (U+0020) and an en-quad (U+2000) — so one category is split across several distinct strings. The reconstruction normalizes them to recover the four intended categories.

## Disclaimer

- Not an authoritative source. This is an unofficial reconstruction of official artifacts.
- The Landkarte data (`data/1-build-kg/upstream/full.json`) is content of the BMDS / Datenlabor BMI. No license is stated upstream; `data/1-build-kg/upstream/full.meta.json` is kept as provenance documentation.
- The item logos are kept verbatim in `data/1-build-kg/upstream/logos.zip` only to rebuild the site; no rights to them are claimed.
- Built with the help from AI coding tools; design decisions stay with the author, who reviews, understands and takes responsibility for every change.
