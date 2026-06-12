/**
 * Pipeline step 1: fetch the Tech-Stack-Landkarte dataset.
 *
 * Every landscape2 site serves its complete compiled dataset at /data/full.json —
 * a strict superset of the CSV downloads offered on the site. Stored verbatim,
 * with retrieval metadata (source, date, checksum) as provenance for everything
 * derived from it.
 */

import { fileURLToPath } from "url"
import { createHash } from "crypto"
import path from "path"
import fs from "fs"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const SOURCE_URL = "https://technologie.deutschland-stack.gov.de/data/full.json"
const UPSTREAM_DIR = path.join(ROOT, "data", "upstream")

const retrievedAt = new Date().toISOString()
const res = await fetch(SOURCE_URL)
if (!res.ok) throw new Error(`${SOURCE_URL} -> HTTP ${res.status}`)
const raw = await res.text()

fs.mkdirSync(UPSTREAM_DIR, { recursive: true })
fs.writeFileSync(path.join(UPSTREAM_DIR, "full.json"), raw)
fs.writeFileSync(path.join(UPSTREAM_DIR, "full.meta.json"), JSON.stringify({
    source: SOURCE_URL,
    retrievedAt,
    sha256: createHash("sha256").update(raw).digest("hex"),
    bytes: Buffer.byteLength(raw),
}, null, 2) + "\n")

console.log(`OK: ${Buffer.byteLength(raw)} bytes -> data/upstream/full.json`)
