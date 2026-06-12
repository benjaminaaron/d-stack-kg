# d-stack-kg

Unofficial prototype: the Deutschland-Stack as a knowledge graph

## Status

- **Pipeline step 1** (`pipeline/1_fetch.js`): fetches the Landkarte dataset.

## The preparation pipeline

| Step | Script | Produces |
|---|---|---|
| 1. Fetch | `pipeline/1_fetch.js` | `data/upstream/full.json` + retrieval metadata |

## Running

```bash
npm install
npm run fetch
```

## Observations

Working with the Landkarte's published artifacts surfaced a few observations that are documented here:

- The two CSV files under Download (top right corner) are lossy exports of the build output. It is missing content compared to the `landscape.yml` and `setting.yml` which must exist in a private repository.
- The data model is inherited from the CNCF landscape and fits its new purpose imperfectly. Some fields are repurposed: license information appears under `summary.release_rate` and operating systems under `summary.personas`.

## Disclaimer

- Not an authoritative source. This is an unofficial reconstruction of official artifacts.
- The Landkarte data (`data/upstream/full.json` and everything derived from it) is content of the BMDS / Datenlabor BMI. No license is stated upstream; these files are kept as provenance-documented snapshots (source URL, retrieval date, checksum in `data/upstream/full.meta.json`).
- Built with the help from AI coding tools; design decisions stay with the author, who reviews, understands and takes responsibility for every change.
