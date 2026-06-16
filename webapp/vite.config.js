import { defineConfig } from "vite"
import { resolve } from "path"

// self-contained: this config, the source pages, the public/ passthrough
// and the dist/ build output all live under webapp/
const root = import.meta.dirname

export default defineConfig({
    root,
    base: "/d-stack-kg/",   // codeberg.page serves the site under this subpath
    appType: "mpa",         // a plain multi-page site, not an SPA - no history fallback
    plugins: [{
        // dev server serves no directory index for public/ subdirs; map the Landkarte's
        // directory URL to its index.html so the iframe renders as it does when deployed
        name: "landkarte-dev-index",
        configureServer(server) {
            server.middlewares.use((req, _res, next) => {
                if (req.url?.endsWith("/use-case/landkarte/")) req.url += "index.html"
                next()
            })
        },
    }],
    build: {
        outDir: "dist",
        emptyOutDir: true,
        // multi-page site: Vite would build only index.html on its own, so the
        // other pages are registered as entry points here
        rollupOptions: {
            input: {
                index: resolve(root, "index.html"),
                vocabulary: resolve(root, "vocabulary.html"),
                query: resolve(root, "query.html"),
                landkarte: resolve(root, "use-case/tech-stack-landkarte.html"),
                verwaltungsleistungen: resolve(root, "use-case/verwaltungsleistungen.html"),
            },
        },
    },
})
