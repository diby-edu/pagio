// Génère, à partir de outils.mjs : une page par outil en français (/<slug>/) et en anglais (/en/<slug>/), les pages
// « tous les outils » (/outils/, /en/tools/), sitemap.xml, robots.txt, et met à jour le catalogue et le nombre d'outils
// de la page d'accueil (index.html, entre les repères /*CATALOGUE*/). Lancer depuis la racine du projet :
//   node server/deploy/site-src/generer.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAMILLES, OUTILS } from './outils.mjs';

const ici = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(ici, '..', 'site');
const RACINE = path.resolve(ici, '..', '..', '..');
const BASE = 'https://pagio.site';
const AUJOURDHUI = new Date().toISOString().slice(0, 10);

// Outils utilisables dans le navigateur (lus dans l'application web) : bouton « Utiliser maintenant ».
const web = fs.readFileSync(path.join(RACINE, 'web', 'src', 'tools.ts'), 'utf8');
const EN_LIGNE = new Set([...web.matchAll(/\{ id: '([a-z_]+)'/g)].map((m) => m[1]));
// Outils récents (étoile sur la page d'accueil), comme dans l'application.
const NOUVEAUX = new Set(['ocr', 'html_to_pdf', 'txt_to_pdf', 'header_footer', 'redact', 'strip_metadata', 'digital_sign', 'verify_sign',
  'assistant', 'translate', 'invoice', 'tables', 'classify']);
const NB = OUTILS.length;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
const url = (o, l) => (l === 'fr' ? `/${o.fr.slug}/` : `/en/${o.en.slug}/`);
const listeUrl = (l) => (l === 'fr' ? '/outils/' : '/en/tools/');
const lienOutil = (o) => (EN_LIGNE.has(o.id) ? `/app/#/outil/${o.id}` : null);

const T = {
  fr: {
    outils: 'Outils', confid: 'Confidentialité', ia: 'Assistant IA', connexion: 'Se connecter', compte: 'Mon compte', telecharger: 'Télécharger',
    tous: 'Tous les outils', utiliser: 'Utiliser maintenant', appli: "Télécharger l'application Android", gratuit: 'Gratuit',
    gratuitDetail: 'Gratuit, avec une limite par jour ; illimité avec Premium.', premium: 'Premium',
    premiumDetail: "Inclus dans l'offre Premium, avec des crédits IA chaque mois.", android: 'Sur Android', enLigne: 'En ligne',
    telSeul: "Réservé à l'application : il utilise l'appareil photo du téléphone.",
    bientot: "Disponible dans l'application Android ; la version en ligne arrive bientôt.",
    comment: 'Comment faire', faq: 'Questions fréquentes', proches: 'Outils proches', famille: 'Famille',
    estGratuit: (o) => `${o.fr.nom} est-il gratuit ?`, prive: 'Mes documents sont-ils en sécurité ?',
    priveRep: "Oui : la plupart des traitements se font sur votre téléphone ou dans votre navigateur. Quand un document passe par le serveur Pagio, il est effacé juste après.",
    titreListe: `Tous les outils PDF de Pagio (${NB})`, descListe: `Les ${NB} outils PDF de Pagio : fusionner, diviser, compresser, convertir, signer, protéger, OCR et assistant IA. Gratuits sur Android et en ligne.`,
    introListe: `${NB} outils pour tout faire avec vos PDF, sur votre téléphone Android et de plus en plus dans votre navigateur.`,
    legal: [['/confidentialite/', 'Confidentialité'], ['/conditions/', "Conditions d'utilisation"], ['/suppression-compte/', 'Suppression de compte'], ['/mentions-legales/', 'Mentions légales']],
    langue: 'Langue', fil: "Fil d'Ariane",
  },
  en: {
    outils: 'Tools', confid: 'Privacy', ia: 'AI assistant', connexion: 'Sign in', compte: 'My account', telecharger: 'Download',
    tous: 'All tools', utiliser: 'Use it now', appli: 'Download the Android app', gratuit: 'Free',
    gratuitDetail: 'Free, with a daily limit; unlimited with Premium.', premium: 'Premium',
    premiumDetail: 'Included in Premium, with AI credits every month.', android: 'On Android', enLigne: 'Online',
    telSeul: "App only: it uses the phone's camera.",
    bientot: 'Available in the Android app; the online version is coming soon.',
    comment: 'How to do it', faq: 'Frequently asked questions', proches: 'Related tools', famille: 'Family',
    estGratuit: (o) => `Is ${o.en.nom} free?`, prive: 'Are my documents safe?',
    priveRep: 'Yes: most processing happens on your phone or in your browser. When a document goes through the Pagio server, it is deleted right after.',
    titreListe: `All Pagio PDF tools (${NB})`, descListe: `Pagio's ${NB} PDF tools: merge, split, compress, convert, sign, protect, OCR and AI assistant. Free on Android and online.`,
    introListe: `${NB} tools to do everything with your PDFs, on your Android phone and more and more in your browser.`,
    legal: [['/confidentialite/?lang=en', 'Privacy'], ['/conditions/?lang=en', 'Terms of use'], ['/suppression-compte/?lang=en', 'Account deletion'], ['/mentions-legales/?lang=en', 'Legal notice']],
    langue: 'Language', fil: 'Breadcrumb',
  },
};

// Les trois étapes, selon ce que l'utilisateur fournit.
const ETAPES = {
  fr: {
    pdf: ['Choisissez votre PDF.', 'Réglez les options si besoin.', 'Enregistrez ou partagez le résultat.'],
    pdfs: ['Choisissez un ou plusieurs PDF.', 'Réglez l\'ordre et les options.', 'Enregistrez ou partagez le résultat.'],
    images: ['Choisissez vos images (JPG, PNG, WEBP…).', 'Réglez l\'ordre, le format de page et les marges.', 'Enregistrez le PDF.'],
    office: ['Choisissez votre fichier Word, Excel ou PowerPoint.', 'Lancez la conversion.', 'Récupérez le PDF.'],
    html: ['Choisissez un fichier HTML ou collez l\'adresse d\'une page.', 'Lancez la conversion.', 'Récupérez le PDF.'],
    text: ['Choisissez un ou plusieurs fichiers texte.', 'Choisissez la taille du texte et la police.', 'Enregistrez le PDF.'],
    doc: ['Choisissez un PDF ou une photo de document.', 'Lancez l\'analyse.', 'Copiez, enregistrez ou partagez le résultat.'],
    none: ['Ouvrez l\'outil dans l\'application.', 'Suivez les indications à l\'écran.', 'Enregistrez ou partagez le document.'],
  },
  en: {
    pdf: ['Choose your PDF.', 'Adjust the options if needed.', 'Save or share the result.'],
    pdfs: ['Choose one or more PDFs.', 'Set the order and options.', 'Save or share the result.'],
    images: ['Choose your images (JPG, PNG, WEBP…).', 'Set the order, page size and margins.', 'Save the PDF.'],
    office: ['Choose your Word, Excel or PowerPoint file.', 'Start the conversion.', 'Get the PDF.'],
    html: ['Choose an HTML file or paste a page address.', 'Start the conversion.', 'Get the PDF.'],
    text: ['Choose one or more text files.', 'Choose text size and font.', 'Save the PDF.'],
    doc: ['Choose a PDF or a photo of a document.', 'Start the analysis.', 'Copy, save or share the result.'],
    none: ['Open the tool in the app.', 'Follow the on-screen instructions.', 'Save or share the document.'],
  },
};

function entete(l, autreUrl) {
  const t = T[l];
  const acc = l === 'fr' ? '/' : '/?lang=en'; // page d'accueil dans la même langue
  return `<header class="top"><div class="wrap nav">
  <a class="brand" href="${l === 'fr' ? '/' : '/?lang=en'}"><img src="/favicon.svg" alt="" width="30" height="30">Pagio</a>
  <nav aria-label="Sections">
    <a href="${acc}#outils">${t.outils}</a><a href="${acc}#confidentialite">${t.confid}</a><a href="${acc}#ia">${t.ia}</a>
    <a class="nav-signin" href="/app/#/connexion" data-compte="${esc(t.compte)}">${t.connexion}</a>
  </nav>
  <div class="lang" role="group" aria-label="${t.langue}"><a href="${l === 'fr' ? '#' : autreUrl}" hreflang="fr"${l === 'fr' ? ' aria-current="true"' : ''}>FR</a><a href="${l === 'en' ? '#' : autreUrl}" hreflang="en"${l === 'en' ? ' aria-current="true"' : ''}>EN</a></div>
  <a class="btn" href="${acc}#telecharger">${t.telecharger}</a>
</div></header>`;
}

function pied(l) {
  const t = T[l];
  return `<footer><div class="wrap">
  <nav><a href="${listeUrl(l)}">${t.tous}</a>${t.legal.map(([h, n]) => `<a href="${h}">${n}</a>`).join('')}</nav>
  © ${new Date().getFullYear()} KODY BUSINESS · <a href="mailto:contact@pagio.site">contact@pagio.site</a>
</div></footer>
<script src="/outil.js"></script>`;
}

function page({ l, titre, description, chemin, autreChemin, corps, jsonld }) {
  return `<!doctype html>
<html lang="${l}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titre)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${BASE}${chemin}">
<link rel="alternate" hreflang="${l}" href="${BASE}${chemin}">
<link rel="alternate" hreflang="${l === 'fr' ? 'en' : 'fr'}" href="${BASE}${autreChemin}">
<link rel="alternate" hreflang="x-default" href="${BASE}${l === 'fr' ? chemin : autreChemin}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Pagio">
<meta property="og:title" content="${esc(titre)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${BASE}${chemin}">
<meta property="og:locale" content="${l === 'fr' ? 'fr_FR' : 'en_US'}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#4535C9">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/legal.css">
<link rel="stylesheet" href="/outil.css">
${jsonld.map((j) => `<script type="application/ld+json">${json(j)}</script>`).join('\n')}
</head>
<body>
${entete(l, autreChemin)}
<main class="wrap">
${corps}
</main>
${pied(l)}
</body>
</html>
`;
}

function pageOutil(o, l) {
  const t = T[l]; const d = o[l];
  const fam = FAMILLES.find((f) => f.id === o.famille);
  const chemin = url(o, l); const autreChemin = url(o, l === 'fr' ? 'en' : 'fr');
  const enLigne = lienOutil(o);
  const etapes = ETAPES[l][o.entree];
  const faq = [...d.faq, [t.estGratuit(o), o.ia ? t.premiumDetail : t.gratuitDetail], [t.prive, t.priveRep]];
  const proches = OUTILS.filter((x) => x.famille === o.famille && x.id !== o.id);
  // Titre court (Google en affiche environ 60 caractères), l'expression recherchée en premier.
  const ou = l === 'fr'
    ? (o.ia ? "avec l'IA" : enLigne ? 'gratuit en ligne et sur Android' : 'gratuit sur Android')
    : (o.ia ? 'with AI' : enLigne ? 'free online and on Android' : 'free on Android');
  // Outils IA : la recherche la plus courante (« Résumer PDF avec l'IA ») plutôt que le nom (« Assistant IA avec l'IA »).
  const expression = o.ia ? (d.mots[0][0].toUpperCase() + d.mots[0].slice(1)).replace(/\bpdf\b/g, 'PDF') : d.nom;
  const titre = `${expression} ${ou} | Pagio`;
  // Description : environ 155 caractères au plus, sans couper un mot.
  const brut = `${d.intro} ${o.ia ? t.premiumDetail : t.gratuitDetail}`;
  const description = brut.length <= 158 ? brut : `${brut.slice(0, 155).replace(/\s+\S*$/, '')}…`;
  const badges = [`<span class="badge ${o.ia ? 'prem' : 'free'}">${o.ia ? t.premium : t.gratuit}</span>`, `<span class="badge">${t.android}</span>`];
  if (enLigne) badges.push(`<span class="badge">${t.enLigne}</span>`);
  const actions = enLigne
    ? `<a class="cta" href="${enLigne}">${t.utiliser}</a><a class="cta alt" href="/telecharger/pagio.apk">${t.appli}</a>`
    : `<a class="cta" href="/telecharger/pagio.apk">${t.appli}</a>`;
  const note = enLigne ? '' : `<p class="note">${o.telephoneSeulement ? t.telSeul : t.bientot}</p>`;
  const corps = `<nav class="crumbs" aria-label="${t.fil}"><a href="${l === 'fr' ? '/' : '/?lang=en'}">Pagio</a> › <a href="${listeUrl(l)}">${t.outils}</a> › <span>${esc(fam[l])}</span></nav>
<article>
  <h1>${esc(d.nom)}</h1>
  <p class="lead">${esc(d.intro)}</p>
  <p class="badges">${badges.join('')}</p>
  <p class="actions">${actions}</p>
  ${note}
  <h2>${t.comment}</h2>
  <ol class="steps">${etapes.map((e) => `<li>${esc(e)}</li>`).join('')}</ol>
  <h2>${t.faq}</h2>
  ${faq.map(([qq, r]) => `<details><summary>${esc(qq)}</summary><p>${esc(r)}</p></details>`).join('\n  ')}
  <h2>${t.proches}</h2>
  <ul class="related">${proches.map((x) => `<li><a href="${url(x, l)}">${esc(x[l].nom)}</a><span>${esc(x[l].court)}</span></li>`).join('')}</ul>
</article>`;
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: `Pagio — ${d.nom}`, description: d.intro, applicationCategory: 'BusinessApplication',
      operatingSystem: enLigne ? 'Android, Web' : 'Android', url: `${BASE}${chemin}`, inLanguage: l, keywords: d.mots.join(', '),
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'XOF' }, publisher: { '@type': 'Organization', name: 'KODY BUSINESS' } },
    { '@context': 'https://schema.org', '@type': 'HowTo', name: `${t.comment} : ${d.nom}`, step: etapes.map((e, i) => ({ '@type': 'HowToStep', position: i + 1, text: e })) },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([qq, r]) => ({ '@type': 'Question', name: qq, acceptedAnswer: { '@type': 'Answer', text: r } })) },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Pagio', item: `${BASE}/` },
      { '@type': 'ListItem', position: 2, name: t.outils, item: `${BASE}${listeUrl(l)}` },
      { '@type': 'ListItem', position: 3, name: d.nom, item: `${BASE}${chemin}` }] },
  ];
  return page({ l, titre, description, chemin, autreChemin, corps, jsonld });
}

function pageListe(l) {
  const t = T[l];
  const chemin = listeUrl(l); const autreChemin = listeUrl(l === 'fr' ? 'en' : 'fr');
  const corps = `<article>
  <h1>${esc(t.titreListe)}</h1>
  <p class="lead">${esc(t.introListe)}</p>
  ${FAMILLES.map((f) => `<h2>${esc(f[l])}</h2>
  <ul class="related">${OUTILS.filter((o) => o.famille === f.id).map((o) => `<li><a href="${url(o, l)}">${esc(o[l].nom)}</a><span>${esc(o[l].court)}</span></li>`).join('')}</ul>`).join('\n  ')}
</article>`;
  const jsonld = [{ '@context': 'https://schema.org', '@type': 'ItemList', name: t.titreListe,
    itemListElement: OUTILS.map((o, i) => ({ '@type': 'ListItem', position: i + 1, name: o[l].nom, url: `${BASE}${url(o, l)}` })) }];
  return page({ l, titre: `${t.titreListe} | Pagio`, description: t.descListe, chemin, autreChemin, corps, jsonld });
}

function ecrire(chemin, contenu) {
  const f = path.join(SITE, chemin, 'index.html');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, contenu);
}

// Adresses réservées : une page d'outil ne doit jamais écraser une page existante du site.
const RESERVEES = new Set(['app', 'telecharger', 'confidentialite', 'conditions', 'suppression-compte', 'mentions-legales', 'outils', 'en', 'api', 'reinitialiser', 'verifier']);
for (const o of OUTILS) {
  if (RESERVEES.has(o.fr.slug)) throw new Error(`Adresse réservée : ${o.fr.slug}`);
}
const slugs = OUTILS.flatMap((o) => [o.fr.slug, `en/${o.en.slug}`]);
if (new Set(slugs).size !== slugs.length) throw new Error('Deux outils ont la même adresse');

// Pages générées précédemment (liste tenue à jour) : retirées avant de régénérer, pour ne pas laisser d'anciennes pages.
const LISTE = path.join(ici, 'pages-generees.json');
for (const ancien of fs.existsSync(LISTE) ? JSON.parse(fs.readFileSync(LISTE, 'utf8')) : []) {
  fs.rmSync(path.join(SITE, ancien), { recursive: true, force: true });
}
const generees = [];
for (const o of OUTILS) for (const l of ['fr', 'en']) { ecrire(url(o, l), pageOutil(o, l)); generees.push(url(o, l).replace(/^\/|\/$/g, '')); }
for (const l of ['fr', 'en']) { ecrire(listeUrl(l), pageListe(l)); generees.push(listeUrl(l).replace(/^\/|\/$/g, '')); }
fs.writeFileSync(LISTE, JSON.stringify(generees, null, 1) + '\n');

// Plan du site : accueil, pages légales, listes et pages d'outils, avec leur équivalent dans l'autre langue.
const paire = (fr, en) => [fr, en].map((u) => `  <url><loc>${BASE}${u}</loc><lastmod>${AUJOURDHUI}</lastmod>
    <xhtml:link rel="alternate" hreflang="fr" href="${BASE}${fr}"/><xhtml:link rel="alternate" hreflang="en" href="${BASE}${en}"/></url>`).join('\n');
const simples = ['/', '/confidentialite/', '/conditions/', '/mentions-legales/', '/suppression-compte/'];
fs.writeFileSync(path.join(SITE, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${simples.map((u) => `  <url><loc>${BASE}${u}</loc><lastmod>${AUJOURDHUI}</lastmod></url>`).join('\n')}
${paire('/outils/', '/en/tools/')}
${OUTILS.map((o) => paire(url(o, 'fr'), url(o, 'en'))).join('\n')}
</urlset>
`);
fs.writeFileSync(path.join(SITE, 'robots.txt'), `User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${BASE}/sitemap.xml
`);

// Page d'accueil : catalogue (chaque outil cliquable) et nombre d'outils.
const accueil = path.join(SITE, 'index.html');
let html = fs.readFileSync(accueil, 'utf8');
const catalogue = (l) => FAMILLES.map((f) => [f[l], OUTILS.filter((o) => o.famille === f.id)
  .map((o) => ({ n: o[l].nom, h: lienOutil(o) || url(o, l), s: NOUVEAUX.has(o.id) ? 1 : 0 }))]);
const bloc = `/*CATALOGUE*/const CATALOGUE = ${json({ nb: NB, fr: catalogue('fr'), en: catalogue('en') })};/*FIN CATALOGUE*/`;
if (!/\/\*CATALOGUE\*\/[\s\S]*?\/\*FIN CATALOGUE\*\//.test(html)) throw new Error("Repère /*CATALOGUE*/ absent d'index.html");
html = html.replace(/\/\*CATALOGUE\*\/[\s\S]*?\/\*FIN CATALOGUE\*\//, bloc);
html = html.replace(/\b\d{2}( outils| tools| PDF tools| outils PDF)/g, `${NB}$1`).replace(/data-count="\d+"/, `data-count="${NB}"`);
fs.writeFileSync(accueil, html);

console.log(`${NB} outils : ${generees.length} pages générées, ${EN_LIGNE.size} outils en ligne, sitemap.xml et robots.txt écrits.`);
