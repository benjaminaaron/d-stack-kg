// Section anchors for the use-case pages: every <section> <h2> gets a stable id (slugified
// from its title, with the "1. " numbering stripped so renumbering keeps links working) and a
// copy-link icon that appears left of the title on hover. A click copies the section's direct
// link and sets the URL hash without jumping. Because the ids only exist once this module has
// run, an incoming hash is scrolled to explicitly at the end.

const slugify = (text) => text
    .replace(/^\d+\.\s*/, "")
    .toLowerCase()
    .replaceAll("ä", "ae").replaceAll("ö", "oe").replaceAll("ü", "ue").replaceAll("ß", "ss")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")

// Feather "link" icon (MIT); stroke follows the text colour
const ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`

const ids = new Set()
for (const h2 of document.querySelectorAll("main section > h2")) {
    const base = slugify(h2.textContent) || "abschnitt"
    let id = base, n = 2
    while (ids.has(id)) id = `${base}-${n++}`
    ids.add(id)
    h2.closest("section").id = id

    const a = document.createElement("a")
    a.className = "anchor"
    a.href = "#" + id
    a.setAttribute("aria-label", "Link zu diesem Abschnitt kopieren")
    a.innerHTML = ICON
    a.addEventListener("click", (e) => {
        e.preventDefault()
        history.replaceState(null, "", "#" + id)
        if (!navigator.clipboard) return   // non-secure context: the hash is set, copy from the address bar
        navigator.clipboard.writeText(location.href).then(() => {
            a.classList.add("copied")
            setTimeout(() => a.classList.remove("copied"), 1200)
        }).catch(() => {})
    })
    h2.prepend(a)
}

if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView()
