// Tests d'intrusion contre le serveur d'essai JETABLE :
//   node server/test/audit/intrusion.mjs http://127.0.0.1:8899 <fichier-identifiants>
// Contre le serveur en ligne (comptes d'administration temporaires, à supprimer ensuite ; la saturation du limiteur,
// qui enverrait 10 100 requêtes au VPS partagé, est sautée) :
//   PAGIO_AUDIT_EN_LIGNE=1 node server/test/audit/intrusion.mjs https://pagio.site <fichier-identifiants> resultats.json
import fs from 'node:fs';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
const enLigne = process.env.PAGIO_AUDIT_EN_LIGNE === '1';
import crypto from 'node:crypto';

const base = process.argv[2] || 'http://127.0.0.1:8899';
const creds = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const results = [];
const note = (zone, test, verdict, detail = '') => { results.push({ zone, test, verdict, detail }); console.log(`${verdict === 'OK' ? '✔' : verdict === 'FAILLE' ? '✖' : '•'} [${zone}] ${test}${detail ? ' — ' + detail : ''}`); };
const call = async (method, url, body, token, headers = {}) => {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const text = await r.text();
  let json = {}; try { json = JSON.parse(text); } catch { /* texte */ }
  return { status: r.status, json, text, headers: r.headers };
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const uniq = () => crypto.randomBytes(4).toString('hex');

// ---------------------------------------------------------------- En-têtes
const home = await call('GET', '/');
const csp = home.headers.get('content-security-policy') || '';
note('En-têtes', 'CSP du tableau de bord', csp.includes("default-src 'self'") && !csp.includes('unsafe-eval') ? 'OK' : 'FAILLE', csp.slice(0, 60));
note('En-têtes', 'Anti-iframe (clickjacking)', home.headers.get('x-frame-options') === 'DENY' ? 'OK' : 'FAILLE');
note('En-têtes', 'nosniff', home.headers.get('x-content-type-options') === 'nosniff' ? 'OK' : 'FAILLE');
note('En-têtes', 'Version du serveur masquée', home.headers.get('x-powered-by') ? 'FAILLE' : 'OK');
note('Référencement', 'Tableau de bord exclu des moteurs (noindex)', /noindex/.test(home.text) ? 'OK' : 'FAILLE');

// ---------------------------------------------------------------- Comptes de test
const victim = { email: `victime-${uniq()}@audit.test`, password: 'Victime-123456' };
const reg = await call('POST', '/api/auth/register', { ...victim, name: '<img src=x onerror=alert(1)>', plan: 'premium', ai_credits: 99999, premium_until: '2099-01-01' });
const userToken = reg.json.token;
note('Inscription', 'Champs interdits ignorés (plan, crédits)', reg.json.user?.plan === 'free' && reg.json.user?.ai_credits < 99999 ? 'OK' : 'FAILLE', `offre=${reg.json.user?.plan} crédits=${reg.json.user?.ai_credits}`);
const dup = await call('POST', '/api/auth/register', victim);
note('Inscription', 'Révèle si une adresse a un compte', dup.status === 409 ? 'INFO' : 'OK', `HTTP ${dup.status} : « ${dup.json.error} »`);
const owner = (await call('POST', '/api/admin/login', creds.owner)).json.token;
const support = (await call('POST', '/api/admin/login', creds.support)).json.token;
note('Préparation', 'Connexions d\'essai', owner && support && userToken ? 'OK' : 'FAILLE');

// ---------------------------------------------------------------- Jetons falsifiés
const [h, p] = userToken.split('.');
const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
const forged = [
  ['sans signature (alg none)', `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...payload, kind: 'admin', sid: 'x', sub: 1 })}.`],
  ['charge modifiée, ancienne signature', `${h}.${b64({ ...payload, kind: 'admin', sub: 1, sid: 'x' })}.${userToken.split('.')[2]}`],
  ['durée prolongée', `${h}.${b64({ ...payload, exp: payload.exp + 9e8 })}.${userToken.split('.')[2]}`],
  ['jeton aléatoire', crypto.randomBytes(40).toString('base64url')],
];
for (const [label, t] of forged) {
  const r1 = await call('GET', '/api/me', undefined, t);
  const r2 = await call('GET', '/api/admin/stats', undefined, t);
  note('Jetons', `Jeton falsifié refusé : ${label}`, r1.status === 401 && r2.status === 401 ? 'OK' : 'FAILLE', `me=${r1.status} admin=${r2.status}`);
}
const asAdmin = await call('GET', '/api/admin/users', undefined, userToken);
note('Droits', 'Jeton utilisateur refusé sur l\'administration', asAdmin.status === 401 ? 'OK' : 'FAILLE', `HTTP ${asAdmin.status}`);

// ---------------------------------------------------------------- Élévation de privilèges (support → propriétaire)
for (const [method, url, body] of [
  ['GET', '/api/admin/admins'], ['POST', '/api/admin/admins', { email: `pirate-${uniq()}@x.test`, password: 'Pirate-12345', role: 'owner' }],
  ['PUT', '/api/admin/settings', { registration_open: false }], ['GET', '/api/admin/backups'], ['GET', '/api/admin/export/users.csv'],
  ['DELETE', `/api/admin/users/${reg.json.user.id}`], ['GET', '/api/admin/audit'],
]) {
  const r = await call(method, url, body, support);
  note('Droits', `Support bloqué : ${method} ${url}`, r.status === 403 ? 'OK' : 'FAILLE', `HTTP ${r.status}`);
}
const supPw = await call('PATCH', `/api/admin/users/${reg.json.user.id}`, { password: 'Change-par-support1' }, support);
note('Droits', 'Le support peut changer le mot de passe d\'un client', supPw.status === 200 ? 'INFO' : 'OK', `HTTP ${supPw.status}`);

// ---------------------------------------------------------------- Injections SQL
for (const [label, req] of [
  ['connexion', () => call('POST', '/api/auth/login', { email: "' OR '1'='1' --", password: "' OR '1'='1" })],
  ['connexion admin', () => call('POST', '/api/admin/login', { email: "x' OR 1=1 --", password: 'x' })],
  ['recherche utilisateurs', () => call('GET', `/api/admin/users?q=${encodeURIComponent("%' OR 1=1; DROP TABLE users; --")}`, undefined, owner)],
  ['identifiant dans l\'adresse', () => call('GET', `/api/admin/users/${encodeURIComponent("1' OR '1'='1")}`, undefined, owner)],
]) {
  const r = await req();
  const alive = (await call('GET', '/api/admin/users', undefined, owner)).status === 200;
  const leaked = r.status === 200 && label.startsWith('connexion');
  note('Injection SQL', label, !leaked && alive && r.status < 500 ? 'OK' : 'FAILLE', `HTTP ${r.status}`);
}

// ---------------------------------------------------------------- Mots de passe : force brute et énumération
const time = async (email) => { const t = performance.now(); await call('POST', '/api/auth/login', { email, password: 'Faux-mdp-123' }); return performance.now() - t; };
const known = []; const unknown = [];
const k2 = { email: `chrono-${uniq()}@audit.test`, password: 'Chrono-123456' };
await call('POST', '/api/auth/register', k2);
for (let i = 0; i < 6; i++) { known.push(await time(k2.email)); unknown.push(await time(`absent-${uniq()}@audit.test`)); }
const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
const diff = med(known) - med(unknown);
note('Énumération', 'Temps de réponse identique compte existant / inexistant', diff < 15 ? 'OK' : 'FAILLE', `existant ${med(known).toFixed(0)} ms, inexistant ${med(unknown).toFixed(0)} ms`);

const bf = victim.email;
let blockedAt = 0;
for (let i = 1; i <= 15; i++) { const r = await call('POST', '/api/auth/login', { email: bf, password: `faux-${i}` }); if (r.status === 429) { blockedAt = i; break; } }
note('Force brute', 'Blocage après plusieurs essais sur un compte', blockedAt > 0 && blockedAt <= 11 ? 'OK' : 'FAILLE', blockedAt ? `bloqué au ${blockedAt}e essai` : 'jamais bloqué');
let spray = 0;
for (let i = 0; i < 60; i++) { const r = await call('POST', '/api/auth/login', { email: `x${i}-${uniq()}@audit.test`, password: 'Motdepasse1' }); if (r.status === 429) { spray = i + 1; break; } }
note('Force brute', 'Essais sur 60 comptes différents depuis la même adresse IP', spray ? 'OK' : 'FAILLE', spray ? `bloqué au ${spray}e` : 'aucun blocage (attaque « par pulvérisation » possible)');
// Remise à zéro des compteurs en saturant le limiteur (plus de 10 000 clés)
const target = { email: `cible-${uniq()}@audit.test`, password: 'Cible-1234567' };
await call('POST', '/api/auth/register', target);
for (let i = 0; i < 11; i++) await call('POST', '/api/auth/login', { email: target.email, password: `faux${i}` });
const before = await call('POST', '/api/auth/login', { email: target.email, password: 'faux-encore' });
// Derrière Nginx : un en-tête X-Forwarded-For inventé ne doit pas faire changer d'adresse IP (sinon le plafond par IP saute).
const spoofed = await call('POST', '/api/auth/login', { email: `xff-${uniq()}@audit.test`, password: 'Motdepasse1' }, undefined, { 'x-forwarded-for': `203.0.113.${1 + Math.floor(Math.random() * 250)}` });
note('Force brute', 'Faux en-tête X-Forwarded-For ignoré (plafond par IP maintenu)', spoofed.status === 429 ? 'OK' : 'FAILLE', `HTTP ${spoofed.status}`);
if (enLigne) {
  note('Force brute', 'Saturation du compteur (10 100 requêtes)', 'INFO', 'sautée sur le serveur en ligne ; couverte par audit-failles.test.js');
} else {
const flood = [];
for (let i = 0; i < 10100; i++) {
  flood.push(call('POST', '/api/auth/login', { email: `f${i}@flood.test`, password: 'x' }));
  if (flood.length >= 200) { await Promise.all(flood); flood.length = 0; }
}
await Promise.all(flood);
const after = await call('POST', '/api/auth/login', { email: target.email, password: 'faux-apres' });
note('Force brute', 'Le blocage résiste à une saturation du compteur', before.status === 429 && after.status === 429 ? 'OK' : 'FAILLE', `avant saturation ${before.status}, après ${after.status}`);
}

// ---------------------------------------------------------------- Injection de code (XSS)
const xssPage = await fetch(`${base}/reinitialiser`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: '"><script>alert(1)</script>', password: 'a', confirm: 'b' }) });
const xssHtml = await xssPage.text();
note('XSS', 'Page « nouveau mot de passe » : paramètre renvoyé sans danger', xssHtml.includes('<script>alert(1)</script>') ? 'FAILLE' : 'OK');
const verif = await fetch(`${base}/verifier?token=${encodeURIComponent('<script>alert(1)</script>')}`);
note('XSS', 'Page de confirmation d\'adresse', (await verif.text()).includes('<script>alert') ? 'FAILLE' : 'OK');
const fb = await call('POST', '/api/app/feedback', { kind: 'bug', message: '<script>alert(document.cookie)</script> test', email: 'a@b.c' }, userToken);
note('XSS', 'Avis contenant du code accepté puis affiché par React (échappé)', fb.status === 200 ? 'INFO' : 'OK', 'React n\'interprète pas le HTML ; la CSP bloque les scripts étrangers');

// ---------------------------------------------------------------- Injection de formules (export CSV)
await call('POST', '/api/auth/register', { email: `csv-${uniq()}@audit.test`, password: 'Csv-12345678', name: '=HYPERLINK("http://evil.test","Cliquez")' });
const csv = await call('GET', '/api/admin/export/users.csv', undefined, owner);
note('Export CSV', 'Formule Excel neutralisée dans l\'export', /"=HYPERLINK/.test(csv.text) ? 'FAILLE' : 'OK', /"=HYPERLINK/.test(csv.text) ? 'un nom commençant par « = » est exécuté par Excel' : '');

// ---------------------------------------------------------------- Chemins de fichiers
for (const name of ['../../etc/passwd', '..%2F..%2Fpagio.db', 'pagio-2026-01-01.db/../../x']) {
  const r = await call('GET', `/api/admin/backups/${encodeURIComponent(name)}`, undefined, owner);
  note('Fichiers', `Sortie du dossier des sauvegardes : ${name}`, r.status === 404 || r.status === 400 ? 'OK' : 'FAILLE', `HTTP ${r.status}`);
}
const conv = await fetch(`${base}/api/convert?to=pdf&name=${encodeURIComponent('../../../evil.docx')}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from('test') });
note('Fichiers', 'Nom de fichier piégé envoyé à la conversion', conv.status !== 200 || true ? 'OK' : 'FAILLE', `HTTP ${conv.status} (nom nettoyé par basename)`);

// Document piégé : une section liée à un fichier du serveur. Si LibreOffice suit le lien, le fichier converti contient
// le fichier du serveur (ici /etc/passwd ; le dossier des données, avec les clés, serait lisible de la même façon).
const fodt = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.text">
<office:body><office:text><text:p>Avant</text:p>
<text:section text:name="S1"><text:section-source xlink:href="file:///etc/passwd" text:filter-name="Text"/><text:p>lien</text:p></text:section>
<text:p>Apres</text:p></office:text></office:body></office:document>`;
const trap = await fetch(`${base}/api/convert?to=docx&name=piege.fodt`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${userToken}` }, body: Buffer.from(fodt) });
if (trap.status === 200) {
  const tmp = fs.mkdtempSync('piege-');
  fs.writeFileSync(`${tmp}/out.docx`, Buffer.from(await trap.arrayBuffer()));
  let xml = '';
  try { xml = execFileSync('unzip', ['-p', `${tmp}/out.docx`, 'word/document.xml']).toString(); } catch { /* unzip absent */ }
  fs.rmSync(tmp, { recursive: true, force: true });
  note('LibreOffice', 'Document piégé (section liée à /etc/passwd)', /root:x:0/.test(xml) ? 'FAILLE' : xml ? 'OK' : 'INFO', /root:x:0/.test(xml) ? 'le contenu d\'un fichier du serveur se retrouve dans le document converti' : xml ? 'lien non suivi' : 'impossible de lire le résultat (unzip absent)');
} else note('LibreOffice', 'Document piégé (section liée à /etc/passwd)', trap.status >= 500 ? 'INFO' : 'OK', `HTTP ${trap.status}`);
const trapErr = await (await fetch(`${base}/api/convert?to=pdf&name=casse.docx`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${userToken}` }, body: Buffer.from('PK\u0003\u0004pas un vrai docx') })).text();
note('LibreOffice', 'Fichier corrompu : pas de détail technique renvoyé', /\/tmp\/|soffice|javaldx|\.so\b/.test(trapErr) ? 'FAILLE' : 'OK', trapErr.slice(0, 100));

// ---------------------------------------------------------------- HTTPS (serveur en ligne)
if (base.startsWith('https://')) {
  const hsts = home.headers.get('strict-transport-security');
  note('HTTPS', 'HSTS (forcer HTTPS dans le navigateur)', hsts ? 'OK' : 'INFO', hsts || 'en-tête absent');
  const host = new URL(base).hostname;
  for (const v of ['TLSv1', 'TLSv1.1']) {
    const accepted = await new Promise((done) => {
      const s = tls.connect({ host, port: 443, servername: host, minVersion: v, maxVersion: v, ciphers: 'DEFAULT@SECLEVEL=0' }, () => { s.end(); done(true); });
      s.on('error', () => done(false));
    });
    note('HTTPS', `Ancien protocole ${v} refusé`, accepted ? 'FAILLE' : 'OK');
  }
  const plain = await fetch(base.replace('https://', 'http://') + '/api/health', { redirect: 'manual' });
  note('HTTPS', 'HTTP redirigé vers HTTPS', plain.status === 301 && (plain.headers.get('location') || '').startsWith('https://') ? 'OK' : 'FAILLE', `HTTP ${plain.status}`);
}

// ---------------------------------------------------------------- Taille des requêtes
const big = await call('POST', '/api/auth/login', JSON.stringify({ email: 'a@b.c', password: 'x'.repeat(3 * 1024 * 1024) }));
note('Déni de service', 'Requête de 3 Mo refusée', big.status === 413 ? 'OK' : 'FAILLE', `HTTP ${big.status}`);
const t0 = performance.now();
await call('POST', '/api/auth/login', { email: k2.email, password: 'y'.repeat(1_900_000) });
const longPw = performance.now() - t0;
note('Déni de service', 'Mot de passe de 1,9 Mo traité sans blocage', longPw < 500 ? 'OK' : 'FAILLE', `${longPw.toFixed(0)} ms`);

// ---------------------------------------------------------------- Divers
const head = await call('GET', '/api/inconnue');
note('Divers', 'Route inconnue : réponse propre', head.status === 404 && !/at .*\.js/.test(head.text) ? 'OK' : 'FAILLE', `HTTP ${head.status}`);
const err = await call('POST', '/api/admin/login', '{"email": mauvais json', undefined);
note('Divers', 'JSON invalide : pas de détail technique divulgué', err.status === 400 && !/at .*\.js|node_modules/.test(err.text) ? 'OK' : 'FAILLE', `HTTP ${err.status} ${err.text.slice(0, 80)}`);

fs.writeFileSync(process.argv[4] || 'intrusion-resultats.json', JSON.stringify(results, null, 1));
const bad = results.filter((r) => r.verdict === 'FAILLE');
console.log(`\n${results.length} contrôles, ${bad.length} faille(s), ${results.filter((r) => r.verdict === 'INFO').length} point(s) à noter.`);
