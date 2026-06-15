import { ROOT } from "./utils.js"
import path from "path"
import fs from "fs"

const SRC = path.join(ROOT, "definitions", "vocabulary.ttl")
const DEST = path.join(ROOT, "webapp", "definitions", "vocabulary.ttl")

if (!fs.existsSync(SRC)) {
    console.warn(`skip: ${path.relative(ROOT, SRC)} not found`)
    process.exit(0)
}
fs.mkdirSync(path.dirname(DEST), { recursive: true })
fs.copyFileSync(SRC, DEST)
console.log(`staged -> ${path.relative(ROOT, DEST)}`)
