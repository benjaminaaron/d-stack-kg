/**
 * Step 1: fetch the Tech-Stack-Landkarte dataset and its logos.
 *
 * Every landscape2 site serves its compiled dataset at /data/full.json — a strict
 * superset of the site's CSV downloads. It is stored verbatim with retrieval
 * metadata (source, date, checksum) as provenance for everything derived from it.
 * The per-item logos are bundled into the committed data/upstream/logos.zip; the
 * unzipped copies live in gitignored data/scratch/.
 */

import { UPSTREAM, SCRATCH } from "../common/utils.js"
import { execFileSync } from "child_process"
import { createHash } from "crypto"
import path from "path"
import fs from "fs"

const SITE = "https://technologie.deutschland-stack.gov.de"
const SOURCE_URL = `${SITE}/data/full.json`
const LOGO_DIR = path.join(SCRATCH, "logos")
const LOGOS_ZIP = path.join(UPSTREAM, "logos.zip")

const res = await fetch(SOURCE_URL)
if (!res.ok) throw new Error(`${SOURCE_URL} -> HTTP ${res.status}`)
const raw = await res.text()
const bytes = Buffer.byteLength(raw)

fs.mkdirSync(UPSTREAM, { recursive: true })
fs.writeFileSync(path.join(UPSTREAM, "full.json"), raw)
fs.writeFileSync(path.join(UPSTREAM, "full.meta.json"), JSON.stringify({
    source: SOURCE_URL,
    retrievedAt: new Date().toISOString(),
    sha256: createHash("sha256").update(raw).digest("hex"),
    bytes,
}, null, 2) + "\n")
console.log(`OK: ${bytes} bytes -> data/upstream/full.json`)

// Logos are referenced as logos/<hash>.png on the same host; fetch each once.
// Existing files are left untouched, so reruns stay cheap (and the zip stable).
const logos = [...new Set(JSON.parse(raw).items.map(it => it.logo))]
fs.mkdirSync(LOGO_DIR, { recursive: true })
let fetched = 0
for (const rel of logos) {
    const dest = path.join(LOGO_DIR, path.basename(rel))
    if (fs.existsSync(dest)) continue
    const r = await fetch(`${SITE}/${rel}`)
    if (!r.ok) throw new Error(`${SITE}/${rel} -> HTTP ${r.status}`)
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
    fetched++
}
console.log(`OK: ${fetched} fetched, ${logos.length - fetched} present -> data/scratch/logos/`)

// Zip the referenced set (not the directory listing, so stray files never leak
// in); sorted + -X keep the archive byte-stable across reruns.
const names = logos.map(rel => path.basename(rel)).sort()
fs.rmSync(LOGOS_ZIP, { force: true })
execFileSync("zip", ["-X", "-q", LOGOS_ZIP, ...names.map(n => path.join("logos", n))], { cwd: SCRATCH })
console.log(`OK: ${names.length} logos -> data/upstream/logos.zip`)
