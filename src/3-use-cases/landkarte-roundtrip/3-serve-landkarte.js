/**
 * Use case · Landkarte roundtrip — step 3: render and serve the Landkarte
 *
 * Takes the graph-derived sources from 1-build-sources.js and runs the official
 * landscape2 build over them (logo files restored from data/1-build-kg/upstream/logos.zip),
 * then serves the result so the Landkarte rebuilt from the knowledge graph can
 * be viewed in the browser. Requires the landscape2 CLI.
 *
 * Run: npm run 3-landkarte:serve   (then open the printed http://127.0.0.1:8000)
 */

import { ROOT, UPSTREAM, SCRATCH, USE_CASES } from "../../common/utils.js"
import { requireFiles, renderSite } from "../../common/landscape2.js"
import { execFileSync } from "child_process"
import path from "path"

const OUT_DIR = path.join(USE_CASES, "landkarte-roundtrip")
const DATA_FILE = path.join(OUT_DIR, "landscape.yml")
const SETTINGS_FILE = path.join(OUT_DIR, "settings.yml")
const BUILD_DIR = path.join(SCRATCH, "roundtrip-build")

requireFiles([DATA_FILE, SETTINGS_FILE], ROOT, "run npm run 3-landkarte first")
renderSite({
    dataFile: DATA_FILE, settingsFile: SETTINGS_FILE,
    scratch: SCRATCH, logosZip: path.join(UPSTREAM, "logos.zip"),
    buildDir: BUILD_DIR, cacheDir: path.join(SCRATCH, "landscape2-cache"),
})
console.log("built -> data/scratch/roundtrip-build/  (Ctrl-C to stop the server)")

// Serve it — blocks until interrupted; landscape2 prints the local URL.
execFileSync("landscape2", ["serve", "--landscape-dir", BUILD_DIR], { stdio: "inherit" })
