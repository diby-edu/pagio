// Test de charge contre le serveur d'essai JETABLE.
//   node server/test/audit/charge.mjs http://127.0.0.1:8899
import crypto from 'node:crypto';

const base = process.argv[2] || 'http://127.0.0.1:8899';
const post = (url, body, token) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

/** Envoie des requêtes pendant `seconds` avec `concurrency` clients simultanés ; renvoie débit et temps de réponse. */
async function bench(label, concurrency, seconds, make) {
  const lat = []; let errors = 0; const codes = {};
  const end = Date.now() + seconds * 1000;
  await Promise.all(Array.from({ length: concurrency }, async (_, w) => {
    let i = 0;
    while (Date.now() < end) {
      const t = performance.now();
      try { const r = await make(w, i++); codes[r.status] = (codes[r.status] || 0) + 1; await r.arrayBuffer(); if (r.status >= 500) errors++; } catch { errors++; }
      lat.push(performance.now() - t);
    }
  }));
  lat.sort((a, b) => a - b);
  const q = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))].toFixed(0);
  const res = { label, concurrency, rps: Math.round(lat.length / seconds), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: lat.at(-1).toFixed(0), errors, codes };
  console.log(`${label.padEnd(46)} ${String(concurrency).padStart(3)} clients  ${String(res.rps).padStart(6)} req/s  médiane ${res.p50} ms  95% ${res.p95} ms  99% ${res.p99} ms  max ${res.max} ms  erreurs ${errors}  ${JSON.stringify(codes)}`);
  return res;
}

const u = { email: `charge-${crypto.randomBytes(4).toString('hex')}@audit.test`, password: 'Charge-1234567' };
const token = (await (await post('/api/auth/register', u)).json()).token;
const events = Array.from({ length: 10 }, (_, i) => ({ name: 'tool_run', ts: Date.now(), props: { tool: 'merge', ok: true, n: i } }));

const out = [];
out.push(await bench('Configuration de l\'application (GET)', 50, 8, () => fetch(`${base}/api/app/config`)));
out.push(await bench('Profil connecté (GET /api/me)', 50, 8, () => fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${token}` } })));
out.push(await bench('Statistiques d\'usage (POST, 10 événements)', 20, 8, (w) => post('/api/app/events', { device_id: `d${w}`, app_version: '1.0', events }, token)));
out.push(await bench('Tableau de bord (fichiers statiques)', 50, 8, () => fetch(`${base}/`)));
// Connexions : chaque essai calcule une empreinte scrypt (volontairement lente). On mesure son effet sur les autres requêtes.
const logins = bench('Connexions simultanées (mot de passe faux)', 10, 8, (w, i) => post('/api/auth/login', { email: u.email, password: `faux-${w}-${i}` }));
const during = bench('… et pendant ce temps : configuration (GET)', 10, 8, () => fetch(`${base}/api/app/config`));
out.push(await logins, await during);
console.log(JSON.stringify(out));
