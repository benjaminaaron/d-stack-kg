/**
 * Serve the static webapp/ locally with plain Node. Run: npm run webapp
 * (override the port with: PORT=1234 npm run webapp)
 */

import { createServer } from "http"
import { join, extname } from "path"
import { ROOT } from "./utils.js"
import fs from "fs"

const DIR = join(ROOT, "webapp")
const PORT = process.env.PORT || 8000
const TYPE = { html: "text/html", js: "text/javascript", css: "text/css", json: "application/json", ttl: "text/turtle", svg: "image/svg+xml", png: "image/png", woff2: "font/woff2" }

createServer((req, res) => {
    let f = join(DIR, decodeURIComponent(req.url.split("?")[0]))
    if (!f.startsWith(DIR)) return res.writeHead(403).end()
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = join(f, "index.html")
    fs.readFile(f, (err, body) => err
        ? res.writeHead(404).end()
        : res.writeHead(200, { "content-type": TYPE[extname(f).slice(1)] || "application/octet-stream" }).end(body))
}).listen(PORT, () => console.log(`webapp -> http://127.0.0.1:${PORT}`))
