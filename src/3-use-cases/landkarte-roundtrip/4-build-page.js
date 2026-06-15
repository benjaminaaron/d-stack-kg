/**
 * Use case · Landkarte roundtrip — step 4: build the page for the webapp
 *
 * Same render as 3-serve-landkarte.js — the official landscape2 build over the
 * graph-derived sources (output of 1-build-sources.js, logos from
 * data/1-build-kg/upstream/logos.zip) — but the output goes into the webapp's
 * public dir at webapp/public/use-case/landkarte/, which Vite passes through to
 * the build so the deploy can publish the rebuilt Landkarte embedded in the
 * Tech-Stack Landkarte page. That directory is gitignored and regenerated at
 * deploy time; nothing built here is committed.
 *
 * Run: npm run 3-landkarte && npm run 3-landkarte:page
 *
 * Requires the landscape2 CLI (no npm package): brew install cncf/landscape2/landscape2
 */

import { ROOT, UPSTREAM, SCRATCH, USE_CASES } from "../../common/utils.js"
import { requireFiles, renderSite } from "../../common/landscape2.js"
import path from "path"
import fs from "fs"

const OUT_DIR = path.join(USE_CASES, "landkarte-roundtrip")
const DATA_FILE = path.join(OUT_DIR, "landscape.yml")
const SETTINGS_FILE = path.join(OUT_DIR, "settings.yml")
const PAGE_DIR = path.join(ROOT, "webapp", "public", "use-case", "landkarte")

requireFiles([DATA_FILE, SETTINGS_FILE], ROOT, "run npm run 3-landkarte first")
renderSite({
    dataFile: DATA_FILE, settingsFile: SETTINGS_FILE,
    scratch: SCRATCH, logosZip: path.join(UPSTREAM, "logos.zip"),
    buildDir: PAGE_DIR, cacheDir: path.join(SCRATCH, "landscape2-cache"),
})

// landscape2's SPA routes (and resolves its data/logo URLs) against an absolute
// base_path that defaults to "", so served from a subpath it 404s. It reads
// window.baseDS.base_path, so inject one derived from the page's own location —
// adapts to any depth, local or on codeberg.page, with no hardcoded path. The
// iframe loads the directory URL (trailing slash) so the path matches the home route.
const indexFile = path.join(PAGE_DIR, "index.html")
const marker = `<script type="module"`
const inject = `<script>if(window.baseDS){var p=location.pathname;if(p.slice(-11)==="/index.html")p=p.slice(0,-11);if(p.slice(-1)==="/")p=p.slice(0,-1);window.baseDS.base_path=p}</script>`
const html = fs.readFileSync(indexFile, "utf8")
if (!html.includes(marker)) throw new Error(`base_path inject failed: ${marker} not found in ${path.relative(ROOT, indexFile)}`)
fs.writeFileSync(indexFile, html.replace(marker, `${inject}\n      ${marker}`))

console.log(`built -> ${path.relative(ROOT, PAGE_DIR)}/  (embedded by webapp/use-case/tech-stack-landkarte.html)`)
