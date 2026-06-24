# Modeling notes

How step 4 turns `landscape.yml` into the RDF knowledge graph (`data/1-build-kg/landscape.ttl`), the judgement calls along the way, and a few notes on the source data.

Across all layers, the model uses RDF/RDFS and SKOS; it defines no OWL axioms or SHACL shapes yet.

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

## The governance layer (the Beschlusslage)

The IT-Planungsrat's binding decisions live only as PDF annexes; this layer (`authored/beschlusslage.authored.ttl`) transcribes them — the seven `dstack:Standardbereich`, five `dstack:Basisdienst` and the `dstack:Beschluss` nodes (verified against the two B-2026/03 PDFs). It is **transcription, not assertion**: every modelled node `dct:source`'s a dated `Beschluss` (node-level provenance, not per-statement) — pointing `dct:source` at an internal dated node, not just an external URL, is what makes "what changed between sessions" a query. The one own claim, the products' `dct:conformsTo` → tile links, is flagged as such. M2 stays tiny: `Standardbereich`/`Basisdienst` mirror `Kriterium` (`skos:Concept` subclasses), plus `nenntStandard` and a verbatim `festlegungsbedarf` literal.

`nenntStandard` points uniformly at nodes — a `dstack:StackElement` where the named standard is a tile, else a `dstack:ReferenzierterStandard` (`inLandkarte false`), reusing the FIT-Connect/Musterstadt gap construct, so the sharp finding (SPARQL, OWL and SKOS are binding but absent, and this prototype runs on all three) needs no new term. The gap is modelled completely only for **Semantische Technologien**, where every absentee is a real standard/format; other areas' lists also name practices and frameworks (CI/CD, EVB-IT, NFV, OpenStack) that aren't tiles and aren't nodes here, and `ECC` is left unlinked (its nearest tile, ECIES, is a different scheme).

A Basisdienst `dstack:realisiertDurch` its Produkt (an `archimate:ApplicationComponent`, labelled `archimate:name` so it doesn't displace the Musterstadt components' label). That is the predicate's second use after the assumed PVOG bridge, so it carries no single domain/range — truth-status rides the file and `dct:source`. `schema:funder` sits only on the four Bund-financed products (B-2026/18); its **absence** on ZBDS/ZaPuK is the queryable distinction, so "what does the Bund pay for?" needs no flag.

## The 115 First-Level-Support layer

IT-PLR Beschluss 2023/11 charges the FITKO with a *flächendeckender First-Level-Support für Onlinedienste* (legal basis § 3a OZG-ÄndG), beauskunftet on the FIM-Leistungsbeschreibung. Since an Onlinedienst *is* an Ausprägung of a LeiKa-Leistung, this layer (`authored/115-od-support.scenario.ttl`) needs **no new spine** — it hangs onto the **real** PVOG nodes (`cpsv:PublicService —m8g:hasChannel→ m8g:Channel`). It is a **scenario, not transcription**: the services are real, but every support fact is hand-authored, because the real 115-Wissensdatenbank is **internal** (not openly available). So it carries no `dct:source`; the `.scenario` suffix and header are the honesty marker.

Tiny M2, like the Basisdienst layer: three local properties on the channel — `dstack:betriebsstatus` (→ a `skos:Concept`: verfügbar / gestört / *nur lokal nicht erfasst*), `dstack:hilfeRessource` (→ `schema:CreativeWork`), `dstack:zweitLevelKontakt` (→ `schema:ContactPoint`). Status is the snapshot a **Frühwarnsystem** (DIN SPEC 66336) would feed; the *nicht-erfasst* value makes the 115's recurring blind spot (an Onlinedienst known only locally) **queryable rather than invisible**. The **semantic translation** — the agent's craft — needs no own term either: colloquial Stichworte ride `skos:altLabel`/`skos:hiddenLabel` on the Leistung (reconstructed; really in FIM/XZuFi), and the page matches a caller phrase against them in SPARQL, so the **data**, not the page, resolves it. **Region is fixed by the call** (the local Servicecenter), held in `dct:spatial` as the DCAT-AP.de ARS IRI, hand-labelled for the four keys used.

Two more Steckbrief dimensions sit on **opposite provenance footings**. The **erforderlichen Unterlagen** reuse `cpsv:hasInput → m8g:Evidence` (no own term) but are hand-authored. The **Gebühren** are real PVOG (`m8g:hasCost`, free-text) — only the Führungszeugnis came back empty, so it gets a **second, own `m8g:Cost` blank node** with the fee as an integer (`m8g:value 13 ; m8g:currency "EUR"`) and its provenance inline (`dct:source` = JVKostG Anlage Nr. 1130, a *hand-added* `rdfs:comment`) — a blank node, not `rdf:Statement`, leaving PVOG's real node untouched.

**Deliberately simplified:** these per-OD fields really travel in the **XZuFi Leistungsbericht** (full field set only in XZuFi 2.3.0+), not ad-hoc `dstack:` terms; and the Second-Level-Support splits into **fachlich**/**technisch**, collapsed here to one technical contact.

## The openCode conformance layer

The D-Stack publishes six conformance criteria ([kriterien](https://deutschland-stack.gov.de/kriterien/)) but defers their *automated* erhebung/use; its [Gesamtbild](https://deutschland-stack.gov.de/gesamtbild/) foresees DevSecOps with SBOM and scanning. This layer (`authored/opencode-konformitaet.scenario.ttl`) is a runnable nucleus of that deferred automation: a scanner reads the dependencies an openCode repository declares in its manifests and maps each onto the D-Stack standards it implements. The reframe that makes it work: a dependency is rarely *itself* a Landkarte tile but *implements* one or more (`fastapi` → **REST** + **OpenAPI**; `psycopg` → **PostgreSQL**), so `dstack:abgebildetAuf` is a **many-to-many** relation with four honest outcomes — a `StackElement` (konform), a `ReferenzierterStandard`/`inLandkarte false` (blinder Fleck), a `ProprietaeresProdukt` (proprietär, open alternative named), or no mapping (*nicht erkannt*, disclosed not scored as a failure).

The mapping is the one heuristic part and is marked as such: a **hand-curated, LLM-assisted** lookup, its own predicate (not `dct:conformsTo`) because it is a guess, not a verified claim. `dstack:realesProjekt true` separates real from illustrative: **SPARK** (BMDS) and the **FIM-Portal** (FITKO) are real, their deps the actually-declared ones; the other two repos are clearly-marked examples, kept because real open-source rarely shows the proprietary/sovereignty findings the Vergabe lens needs. The layer also crosswalks to **openCode's BSI-aligned badge system** (`dstack:OpenCodeBadge`, `skos:closeMatch`/`relatedMatch` to the `Kriterium`s), so the three the D-Stack adds fall out of a query; the proposed sixth carries `dstack:vorgeschlagen true`. The whole layer lives under `oc:` (example.org), so it stays out of the graph projection unless a page opts in.

## Provenance as named graphs (the Selbstauskunft page)

The honesty markers so far are file-level: the `.assumed`/`.fictional`/`.scenario`/`.authored` suffix and a header comment say what a layer *is*, but that knowledge isn't in the graph, so the graph can't answer "which of this answer's edges are guessed?". The fix needs no new data: `webapp/assets/graph.js` loads each layer **twice** — once into the default graph (so every existing query keeps its ordinary semantics, verified unchanged) and once into a **per-layer named graph**. A small meta block in the default graph then describes each named graph with `dstack:herkunft` (the file convention made queryable: *offiziell geliftet / transkribiert / verfasst / angenommen / fiktiv / Szenario*), using only `dstack:` predicates so it never surfaces in ordinary label/type queries. Provenance becomes a `GRAPH ?g { ... } . ?g dstack:herkunft ?h` join, and these queries also run on the Query page, since it shares the same store.

That turns the prototype's apparent weakness into the **Selbstauskunft** page: the graph accounts for itself. Its browser title still names the core topic, **Annahmen & Lücken**. Three views — what it is made of by Herkunft; what a concrete answer rests on (one query shows the **offiziell** endpoints beside the **angenommen** edge, so an answer's trust grade is explicit: "diese Leistungen nutzen OIDC" rides entirely on the assumed bridge); and where the stack has gaps and tensions (standards a Beschluss makes binding but the Landkarte omits, open Festlegungsbedarfe, Basisdienste whose product binds no standard, the FIM-silo's own honesty note). A structural check confirms **no `dstack:` edge dangles**; deeper logical contradiction would need OWL/SHACL, flagged on Über as not yet in use.
