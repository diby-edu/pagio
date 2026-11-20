// Tests de non-régression des failles trouvées pendant l'audit de sécurité (novembre 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimiter } from '../src/security.js';
import { boot, loginOwner } from './helpers.js';

const settle = () => new Promise((r) => setTimeout(r, 40));

test('liens par e-mail : jamais construits avec l\'en-tête Host envoyé par le client', async () => {
  const inbox = [];
  const ctx = await boot({ secretsKey: 'cle', sendMail: async (_c, m) => { inbox.push(m); } });
  const { server, call } = ctx;
  try {
    const owner = (await loginOwner(call)).json.token;
    // E-mails activés mais adresse publique non renseignée
    await call('PUT', '/api/admin/settings', { mail: { enabled: true, api_key: 'xkeysib-test-1111', from_email: 'pagio@test.fr', from_name: 'Pagio', public_url: '', verify_signup: true, alerts_enabled: false, alerts_to: '' } }, owner);
    await call('POST', '/api/auth/register', { email: 'cible@test.fr', password: 'Cible-1234567' });
    await fetch(`${server.base}/api/auth/forgot`, { method: 'POST', headers: { 'content-type': 'application/json', host: 'pirate.example' }, body: JSON.stringify({ email: 'cible@test.fr' }) });
    await settle();
    assert.equal(inbox.length, 0, 'aucun lien ne doit partir sans adresse publique configurée');
    const alerts = await call('GET', '/api/admin/alerts', null, owner);
    assert.ok(alerts.json.alerts.some((a) => a.code === 'mail_url'), 'une alerte signale l\'adresse manquante');

    // Adresse publique renseignée : le lien l'utilise, même si le client ment sur Host
    await call('PUT', '/api/admin/settings', { mail: { enabled: true, api_key: 'xkeysib-test-1111', from_email: 'pagio@test.fr', from_name: 'Pagio', public_url: 'https://pagio.exemple.test', verify_signup: true, alerts_enabled: false, alerts_to: '' } }, owner);
    await fetch(`${server.base}/api/auth/forgot`, { method: 'POST', headers: { 'content-type': 'application/json', host: 'pirate.example' }, body: JSON.stringify({ email: 'cible@test.fr' }) });
    await settle();
    assert.equal(inbox.length, 1);
    assert.match(inbox[0].text, /https:\/\/pagio\.exemple\.test\/reinitialiser\?token=/);
    assert.ok(!inbox[0].text.includes('pirate.example'));
  } finally { server.close(); }
});

test('export CSV : un nom commençant par = est neutralisé', async () => {
  const { server, call } = await boot();
  try {
    await call('POST', '/api/auth/register', { email: 'csv@test.fr', password: 'Csv-12345678', name: '=HYPERLINK("http://evil.test","x")' });
    const owner = (await loginOwner(call)).json.token;
    const r = await fetch(`${server.base}/api/admin/export/users.csv`, { headers: { authorization: `Bearer ${owner}` } });
    const csv = await r.text();
    assert.ok(csv.includes(`"'=HYPERLINK(`), 'la formule doit être précédée d\'une apostrophe');
    assert.ok(!/;"=HYPERLINK/.test(csv));
  } finally { server.close(); }
});

test('limiteur : saturer la table ne remet pas les blocages à zéro', () => {
  const limit = rateLimiter(3, 60_000);
  for (let i = 0; i < 4; i++) limit('cible');
  assert.equal(limit('cible'), false);
  for (let i = 0; i < 25_000; i++) limit(`bruit-${i}`);
  assert.equal(limit('cible'), false, 'la cible doit rester bloquée');
});

test('connexion : limite par adresse IP, tous comptes confondus', async () => {
  const { server, call } = await boot();
  try {
    let blocked = 0;
    for (let i = 0; i < 45; i++) {
      const r = await call('POST', '/api/auth/login', { email: `compte${i}@test.fr`, password: 'Motdepasse1' });
      if (r.status === 429) { blocked = i + 1; break; }
    }
    assert.ok(blocked > 0 && blocked <= 41, `blocage attendu vers 40 essais (obtenu : ${blocked})`);
  } finally { server.close(); }
});

test('IA : l\'erreur du fournisseur n\'est pas renvoyée telle quelle à l\'utilisateur', async () => {
  const { server, call, db } = await boot({ secretsKey: 'cle' });
  try {
    const owner = (await loginOwner(call)).json.token;
    // Fournisseur injoignable (port fermé)
    await call('PUT', '/api/admin/settings', { ai: { enabled: true, provider: 'openai', base_url: 'http://127.0.0.1:9/v1', api_key: 'sk-secret-de-test-abcdef', model: 'x', cost_per_request: 1 } }, owner);
    const u = (await call('POST', '/api/auth/register', { email: 'ia@test.fr', password: 'Ia-123456789' })).json.token;
    const r = await call('POST', '/api/ai/complete', { messages: [{ role: 'user', content: 'bonjour' }] }, u);
    assert.equal(r.status, 502);
    assert.equal(r.json.error, "Le service d'IA est momentanément indisponible. Réessayez dans quelques minutes.");
    assert.ok(db.prepare("SELECT COUNT(*) n FROM ai_usage WHERE ok = 0").get().n >= 1, 'le détail reste consigné côté serveur');
  } finally { server.close(); }
});
