// <site-nav> — the shared top navigation, reused by every page.
// Renders into the light DOM so it picks up the site-wide assets/styles.css.
// Links resolve against the webapp root derived from this module's own URL,
// so they work locally, at the repo root, or under a deploy subpath alike.

const ROOT = new URL("../", import.meta.url)
const link = path => new URL(path, ROOT).href

const REPO = "https://codeberg.org/benjaminaaron/d-stack-kg"

const ITEMS = [
    { label: "Vocabulary", href: link("vocabulary.html") },
    { label: "Use Cases", children: [
        { label: "Tech-Stack Landkarte", href: link("use-case/tech-stack-landkarte.html") }
    ] }
]

const isActive = href => {
    try {
        return new URL(href).pathname === location.pathname
    } catch {
        return false
    }
}

const current = href => isActive(href) ? ' aria-current="page"' : ""

const renderLink = item =>
    `<a class="navlink" href="${item.href}"${current(item.href)}>${item.label}</a>`

const renderDropdown = item => {
    const active = item.children.some(c => isActive(c.href)) ? " active" : ""
    const menu = item.children.map(c =>
        `<a role="menuitem" class="menuitem" href="${c.href}"${current(c.href)}>${c.label}</a>`
    ).join("")
    return `
        <div class="dropdown">
            <button type="button" class="navlink${active}" aria-haspopup="true" aria-expanded="false">
                ${item.label}<span class="caret" aria-hidden="true"></span>
            </button>
            <div class="menu" role="menu">${menu}</div>
        </div>`
}

class SiteNav extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
            <nav class="bar">
                <a class="brand" href="${link("index.html")}">d-stack-kg</a>
                ${ITEMS.map(i => i.children ? renderDropdown(i) : renderLink(i)).join("")}
                <a class="repo" href="${REPO}" target="_blank" rel="noopener noreferrer">Code</a>
            </nav>`
        this.wire()
    }

    wire() {
        const dropdowns = [...this.querySelectorAll(".dropdown")]
        const close = () => dropdowns.forEach(d => {
            d.classList.remove("open")
            d.querySelector("button").setAttribute("aria-expanded", "false")
        })
        dropdowns.forEach(d => {
            const btn = d.querySelector("button")
            btn.addEventListener("click", event => {
                event.stopPropagation()
                const open = !d.classList.contains("open")
                close()
                if (open) {
                    d.classList.add("open")
                    btn.setAttribute("aria-expanded", "true")
                }
            })
        })
        document.addEventListener("click", event => {
            if (!this.contains(event.target)) close()
        })
        document.addEventListener("keydown", event => {
            if (event.key === "Escape") close()
        })
    }
}

customElements.define("site-nav", SiteNav)
