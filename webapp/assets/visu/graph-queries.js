// The predefined "pull-together" queries. Each runs live against the in-browser store and returns
// a set of node IRIs (?n) — the renderer highlights exactly that set and the edges induced among it,
// flows particles along them and eases the camera to frame them. So the animation is not scripted:
// it is the real SPARQL answer. Every query maps to a use-case page for "mehr dazu".
//
// `surfaces` decides where a query's button shows: the landing hero keeps to the legible backbone
// (no FIM Datenfeld trees); the dedicated Graph page ("explorer") includes the data-heavy ones.

export const PRE = `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX cpsv: <http://purl.org/vocab/cpsv#>
PREFIX m8g: <http://data.europa.eu/m8g/>
PREFIX schema: <http://schema.org/>
PREFIX archimate: <https://purl.org/archimate#>
PREFIX fim: <https://deutschland-stack.gov.de/fim#>
PREFIX fitconnect: <https://deutschland-stack.gov.de/fit-connect#>
PREFIX ds: <https://deutschland-stack.gov.de/id/>
PREFIX mus: <https://example.org/musterstadt#>
PREFIX oc: <https://example.org/opencode#>
PREFIX dstack: <https://deutschland-stack.gov.de/vocab#>`

export const QUERIES = [
    {
        id: "oidc",
        label: "Was hängt an OpenID Connect?",
        caption: "Ein einziger Login-Standard — und der Graph zieht zusammen, was an ihm hängt: Onlinedienste, ihre Leistungen, zuständige Behörden und Lebenslagen, der Standardbereich des IT-Planungsrats, die Bundesprodukte eID/EUDI-Wallet und sogar das Servicekonto einer Kommune. Vier Schichten, ein Knoten.",
        page: "use-case/selbstauskunft.html",
        surfaces: ["hero", "explorer"],
        sparql: `SELECT DISTINCT ?n WHERE {
    { VALUES ?n { ds:open-id-connect } }
    UNION { ?n dstack:realisiertDurch ds:open-id-connect }
    UNION { ?od dstack:realisiertDurch ds:open-id-connect . ?l m8g:hasChannel ?od . BIND(?l AS ?n) }
    UNION { ?od dstack:realisiertDurch ds:open-id-connect . ?l m8g:hasChannel ?od ; m8g:hasCompetentAuthority ?n }
    UNION { ?od dstack:realisiertDurch ds:open-id-connect . ?l m8g:hasChannel ?od ; m8g:isGroupedBy ?n }
    UNION { ?n dstack:nenntStandard ds:open-id-connect }
    UNION { ?n dct:conformsTo ds:open-id-connect }
}`,
    },
    {
        id: "wohngeld",
        label: "Worauf ruht der Wohngeld-Antrag?",
        caption: "Eine einzelne Verwaltungsleistung von oben nach unten: der Online-Antrag Wohngeld, die zuständige Behörde, die Lebenslage — und die Technik, auf der er (angenommen) läuft. Die geratenen Brücken-Kanten sind die zur Brücken-Schicht gehörenden.",
        page: "use-case/leistungen.html",
        surfaces: ["hero", "explorer"],
        sparql: `SELECT DISTINCT ?n WHERE {
    { ?n m8g:hasChannel ds:onlinedienst-L100108-OD-L100108_331668 }
    UNION { ?l m8g:hasChannel ds:onlinedienst-L100108-OD-L100108_331668 . ?l m8g:hasChannel ?n }
    UNION { ds:onlinedienst-L100108-OD-L100108_331668 dstack:realisiertDurch ?n }
    UNION { ?l m8g:hasChannel ds:onlinedienst-L100108-OD-L100108_331668 ; m8g:hasCompetentAuthority ?n }
    UNION { ?l m8g:hasChannel ds:onlinedienst-L100108-OD-L100108_331668 ; m8g:isGroupedBy ?n }
}`,
    },
    {
        id: "beschluss",
        label: "Was hat der IT-Planungsrat beschlossen?",
        caption: "Die Governance-Schicht zieht sich zusammen: die Beschlüsse, die sieben Standardbereiche samt den Standards, die sie verbindlich nennen, und die fünf Basisdienste mit den Produkten, die sie realisieren (eID, EUDI-Wallet, FIT-Connect, NOOTS …).",
        page: "use-case/beschlusslage.html",
        surfaces: ["hero", "explorer"],
        sparql: `SELECT DISTINCT ?n WHERE {
    { ?n a dstack:Standardbereich }
    UNION { ?n a dstack:Basisdienst }
    UNION { ?n a dstack:Beschluss }
    UNION { ?area a dstack:Standardbereich ; dstack:nenntStandard ?n }
    UNION { ?bd a dstack:Basisdienst ; dstack:realisiertDurch ?n }
    UNION { ?bd a dstack:Basisdienst ; dstack:realisiertDurch ?p . ?p dct:conformsTo ?n }
}`,
    },
    {
        id: "musterstadt",
        label: "Wie hängt eine Kommune am Stack?",
        caption: "Eine (fiktive) kommunale IT-Landschaft prüft sich gegen den Stack: jede Komponente, die Standards, denen sie folgt — und die Lücken, wo sie auf etwas baut, das die Landkarte noch gar nicht führt (XMeld, WMS).",
        page: "use-case/kommune.html",
        surfaces: ["hero", "explorer"],
        sparql: `SELECT DISTINCT ?n WHERE {
    { VALUES ?n { mus:it-landschaft } }
    UNION { mus:it-landschaft dct:hasPart ?n }
    UNION { mus:it-landschaft dct:hasPart ?c . ?c dct:conformsTo ?n }
    UNION { mus:it-landschaft dct:hasPart ?c . ?c archimate:serving ?n }
}`,
    },
    {
        id: "datenfluss",
        label: "Welche Daten fließen bei einer Leistung?",
        caption: "Von der Leistung bis aufs einzelne Feld: die »Verlust- oder Diebstahlmeldung eines Ausweisdokuments« über ihren FIT-Connect-Zustellpunkt, das Fachdatenschema, dessen Format und den ganzen Baum der FIM-Datenfeldgruppen und -felder, den eine Einreichung füllt.",
        page: "use-case/fachdaten.html",
        surfaces: ["explorer"],
        sparql: `SELECT DISTINCT ?n WHERE {
    { VALUES ?n { ds:leistung-leika-99008001014002 } }
    UNION { ds:leistung-leika-99008001014002 fitconnect:zustellpunkt ?n }
    UNION { ds:leistung-leika-99008001014002 dct:conformsTo ?n }
    UNION { ds:leistung-leika-99008001014002 dct:conformsTo ?s . ?s dstack:serialisiertAls ?n }
    UNION { ds:leistung-leika-99008001014002 dct:conformsTo ?s . ?s fim:datenfeld+ ?n }
}`,
    },
    {
        id: "luecken",
        label: "Wo hat der Stack blinde Flecken?",
        caption: "Standards, die ein Beschluss verbindlich nennt oder die ein realer Dienst nutzt, die die Tech-Stack Landkarte aber nicht als Kachel führt (dstack:inLandkarte false) — und alles, was auf sie verweist. Sichtbar gemachte Lücken, keine Behauptung, dass sie dorthin gehören.",
        page: "use-case/selbstauskunft.html",
        surfaces: ["explorer"],
        sparql: `SELECT DISTINCT ?n WHERE {
    { ?n dstack:inLandkarte false }
    UNION { ?ref dstack:inLandkarte false . ?n dstack:nenntStandard ?ref }
    UNION { ?ref dstack:inLandkarte false . ?n dct:conformsTo ?ref }
    UNION { ?ref dstack:inLandkarte false . ?n dstack:serialisiertAls ?ref }
}`,
    },
    {
        id: "comms",
        label: "Wie erklärt sich der Graph selbst?",
        caption: "Die Kommunikations-Schicht: Textbausteine, die ihre eigene Erklärung tragen, jeweils an dem Graph-Knoten verankert (schema:about), über den sie sprechen — Kommunikation direkt aus dem Graphen statt aus veraltenden Dokumenten.",
        page: "use-case/kommunikation.html",
        surfaces: ["explorer"],
        sparql: `SELECT DISTINCT ?n WHERE {
    { ?n a dstack:Textbaustein }
    UNION { ?tb a dstack:Textbaustein ; schema:about ?n . FILTER(isIRI(?n)) }
}`,
    },
    {
        id: "konformitaet",
        label: "Wie hängt ein openCode-Repo am Stack? (SPARK)",
        caption: "Das reale BMDS-Projekt SPARK zieht zusammen, was in seinen Manifesten steht: jede Abhängigkeit und die D-Stack-Standards, die sie verkörpert (fastapi → REST und OpenAPI, psycopg → PostgreSQL, …) — oder, wo es keinen Anschluss gibt, ein blinder Fleck (Temporal) oder gar nicht erkannt. Die Zuordnung Paket→Standard ist handkuratiert.",
        page: "use-case/konformitaet.html",
        surfaces: ["explorer"],
        sparql: `SELECT DISTINCT ?n WHERE {
    { VALUES ?n { oc:spark } }
    UNION { oc:spark dct:hasPart ?n }
    UNION { oc:spark dct:hasPart ?d . ?d dstack:abgebildetAuf ?n }
}`,
    },
]

export const queriesFor = (surface) => QUERIES.filter(q => q.surfaces.includes(surface))
