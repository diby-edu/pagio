// Campagnes e-mail (segments, désinscription), sécurité (connexions, IP bloquées, export des données), recherche globale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, loginOwner } from './helpers.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('campagnes : essai, envoi à un segment, désinscription respectée', async () => {
  const sent = [];
  const { server, call } = await boot({ sendMail: async (cfg, m) => { sent.push(m); } });
  try {
    const owner = (await loginOwner(call)).json.token;
    await call('PUT', '/api/admin/settings', { mail: { enabled: true, api_key: 'xkeysib-test', from_email: 'noreply@pagio.site', public_url: 'https://pagio.site' } }, owner);
    for (const e of ['a@x.ci', 'b@x.ci']) await call('POST', '/api/auth/register', { email: e, password: 'motdepasse1', name: e[0].toUpperCase() });
    const segs = (await call('GET', '/api/admin/campaigns', null, owner)).json.segments;
    assert.equal(segs.all.count, 2);
    // Essai
    assert.equal((await call('POST', '/api/admin/campaigns', { subject: 'Nouveautés', body: 'Découvrez les outils en ligne : https://pagio.site/app/', test_to: 'moi@x.ci' }, owner)).status, 200);
    assert.equal(sent.at(-1).to, 'moi@x.ci');
    sent.length = 0;
    // Envoi réel
    const r = await call('POST', '/api/admin/campaigns', { subject: 'Nouveautés', body: 'Découvrez les outils en ligne : https://pagio.site/app/', segment: 'all' }, owner);
    assert.equal(r.json.recipients, 2);
    await wait(200);
    assert.equal(sent.length, 2);
    assert.match(sent[0].text, /Bonjour [AB]/);
    const unsub = /(https:\/\/pagio\.site\/api\/desabonnement\?u=[^\s]+)/.exec(sent[0].text)[1];
    const c = (await call('GET', '/api/admin/campaigns', null, owner)).json.campaigns[0];
    assert.equal(c.status, 'terminée');
    assert.equal(c.sent, 2);
    // Désinscription par le lien (sans connexion), puis exclusion des campagnes suivantes
    const page = await fetch(server.base + new URL(unsub).pathname + new URL(unsub).search);
    assert.equal(page.status, 200);
    assert.equal((await fetch(`${server.base}/api/desabonnement?u=x&t=faux`)).status, 400);
    assert.equal((await call('GET', '/api/admin/campaigns', null, owner)).json.segments.all.count, 1);
  } finally {
    server.close();
  }
});

test('sécurité : connexions notées, IP bloquée, export des données ; recherche globale', async () => {
  const { server, call } = await boot();
  try {
    const owner = (await loginOwner(call)).json.token;
    await call('POST', '/api/auth/register', { email: 'client@x.ci', password: 'motdepasse1' });
    await call('POST', '/api/auth/login', { email: 'client@x.ci', password: 'mauvais' });
    const token = (await call('POST', '/api/auth/login', { email: 'client@x.ci', password: 'motdepasse1' })).json.token;
    const sec = (await call('GET', '/api/admin/security', null, owner)).json;
    assert.equal(sec.logins.length, 2);
    assert.equal(sec.failed_24h[0].n, 1);
    assert.match(sec.logins[0].ip, /x$/); // adresse tronquée
    // Export : par l'administrateur et par l'utilisateur lui-même, sans mot de passe
    const me = (await call('GET', '/api/me/export', null, token)).json;
    assert.equal(me.account.email, 'client@x.ci');
    assert.equal(me.account.password_hash, undefined);
    assert.equal(me.logins.length, 2); // la tentative échouée et la connexion réussie
    // Recherche
    const found = (await call('GET', '/api/admin/search?q=client', null, owner)).json;
    assert.equal(found.users[0].email, 'client@x.ci');
    // Blocage de l'IP de test : API publiques refusées, administration toujours accessible
    await call('PUT', '/api/admin/security/blocked', { ips: ['127.0.0.1', 'pas une ip !'] }, owner);
    assert.equal((await call('GET', '/api/app/config')).status, 403);
    assert.equal((await call('GET', '/api/admin/security', null, owner)).status, 200);
    await call('PUT', '/api/admin/security/blocked', { ips: [] }, owner);
    assert.equal((await call('GET', '/api/app/config')).status, 200);
  } finally {
    server.close();
  }
});
