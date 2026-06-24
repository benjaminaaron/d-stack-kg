import { defineConfig } from "vite"
import { resolve } from "path"

// self-contained: this config, the source pages, the public/ passthrough
// and the dist/ build output all live under webapp/
const root = import.meta.dirname

export default defineConfig({
    root,
    base: "/d-stack-kg/",   // codeberg.page serves the site under this subpath
    appType: "mpa",         // a plain multi-page site, not an SPA - no history fallback
    // 3d-force-graph and three-spritetext each import "three"; force a single instance,
    // else SpriteText (a THREE.Sprite subclass) is built against a different three than the
    // renderer uses and silently fails to draw
    resolve: { dedupe: ["three"] },
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
                graph: resolve(root, "graph.html"),
                vocabulary: resolve(root, "vocabulary.html"),
                query: resolve(root, "query.html"),
                landkarte: resolve(root, "use-case/landkarte.html"),
                leistungen: resolve(root, "use-case/leistungen.html"),
                fachdaten: resolve(root, "use-case/fachdaten.html"),
                kommune: resolve(root, "use-case/kommune.html"),
                kommunikation: resolve(root, "use-case/kommunikation.html"),
                beschlusslage: resolve(root, "use-case/beschlusslage.html"),
                n115: resolve(root, "use-case/115.html"),
                selbstauskunft: resolve(root, "use-case/selbstauskunft.html"),
                ideen: resolve(root, "ideen.html"),
                export: resolve(root, "export.html"),
                ueber: resolve(root, "ueber.html"),
            },
        },
    },
})
