# Deutschland-Stack knowledge graph

Unofficial prototype: the Deutschland-Stack as a knowledge graph.

The authoritative source is the official [Tech-Stack Landkarte](https://technologie.deutschland-stack.gov.de/).

## Building the knowledge graph
`src/0-build-kg`

| Step | What it does |
|---|---|
| **1. Fetch dataset** | Fetches [the compiled Landkarte dataset](https://technologie.deutschland-stack.gov.de/data/full.json) and its logos → `data/upstream/` (`full.json` + metadata, `logos.zip`) |
| **2. Reconstruct source** | Reconstructs the landscape2 source files → `data/reconstructed/` (`landscape.yml` + a minimal `settings.yml`) |
| **3. Validate roundtrip** | Structurally compares the rebuilt `full.json` against the authoritative one; to produce it, runs a full `landscape2 build` → `data/scratch/build/` |

## Running

```bash
npm install

npm run fetch # step 1
npm run reconstruct # step 2

# step 3
brew install cncf/landscape2/landscape2 # landscape2 CLI is required
npm run validate
landscape2 serve --landscape-dir data/scratch/build # optional: view the built site
```

## Observations

A few things surfaced while working with the Landkarte's published artifacts:

- The two CSV files under Download (top right corner) are lossy exports of the build output (default landscape2 behaviour, not a BMDS addition), missing content compared to the `landscape.yml` and `settings.yml` they were built from. Those probably live in the repository the footer links to, which seems to have been public once but now returns a 404.
- The data model is inherited from the CNCF landscape and fits its new purpose imperfectly. Some fields are repurposed: license information appears under `summary.release_rate` and operating systems under `summary.personas`.
- Category and subcategory labels carry inconsistent leading whitespace — a mix of a normal space (U+0020) and an en-quad (U+2000) — so one category is split across several distinct strings. The reconstruction normalizes them to recover the four intended categories.

## Disclaimer

- Not an authoritative source. This is an unofficial reconstruction of official artifacts.
- The Landkarte data (`data/upstream/full.json`) is content of the BMDS / Datenlabor BMI. No license is stated upstream; `data/upstream/full.meta.json` is kept as provenance documentation.
- The item logos are kept verbatim in `data/upstream/logos.zip` only to rebuild the site; no rights to them are claimed.
- Built with the help from AI coding tools; design decisions stay with the author, who reviews, understands and takes responsibility for every change.
