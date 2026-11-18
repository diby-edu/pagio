// Un nouveau mot de passe doit déconnecter immédiatement les téléphones déjà connectés au compte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, loginOwner } from './helpers.js';

const form = (base, path, fields) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
const settle = () => new Promise((r) => setTimeout(r, 30));

test('mot de passe changé par l\'administrateur : les téléphones connectés sont déconnectés', async () => {
  const { server, call } = await boot();
  try {
    const reg = await call('POST', '/api/auth/register', { email: 'lea@test.fr', password: 'ancien-mdp-123' });
    assert.equal(reg.status, 200);
    const phone = reg.json.token;
    assert.equal((await call('GET', '/api/me', null, phone)).status, 200);

    // Le badge est daté à la seconde : on attend la seconde suivante, comme dans la vraie vie.
    await new Promise((r) => setTimeout(r, 1100));
    const owner = (await loginOwner(call)).json.token;
    const ch = await call('PATCH', `/api/admin/users/${reg.json.user.id}`, { password: 'nouveau-mdp-456' }, owner);
    assert.equal(ch.status, 200);

    // Ancien badge refusé tout de suite, sans attendre 90 jours
    assert.equal((await call('GET', '/api/me', null, phone)).status, 401);
    // L'ancien mot de passe ne marche plus, le nouveau oui, et donne un badge valable
    assert.equal((await call('POST', '/api/auth/login', { email: 'lea@test.fr', password: 'ancien-mdp-123' })).status, 401);
    const again = await call('POST', '/api/auth/login', { email: 'lea@test.fr', password: 'nouveau-mdp-456' });
    assert.equal(again.status, 200);
    assert.equal((await call('GET', '/api/me', null, again.json.token)).status, 200);
  } finally { server.close(); }
});

test('mot de passe oublié puis changé par lien : les téléphones connectés sont déconnectés', async () => {
  const inbox = [];
  const ctx = await boot({ secretsKey: 'cle-de-test', sendMail: async (_c, m) => { inbox.push(m); } });
  const { server, call } = ctx;
  try {
    const owner = (await loginOwner(call)).json.token;
    await call('PUT', '/api/admin/settings', { mail: { enabled: true, api_key: 'xkeysib-test-0000', from_email: 'pagio@test.fr', from_name: 'Pagio', public_url: server.base, verify_signup: false, alerts_enabled: false, alerts_to: '' } }, owner);
    const reg = await call('POST', '/api/auth/register', { email: 'sam@test.fr', password: 'ancien-mdp-123' });
    const phone = reg.json.token;
    assert.equal((await call('GET', '/api/me', null, phone)).status, 200);

    await new Promise((r) => setTimeout(r, 1100));
    await call('POST', '/api/auth/forgot', { email: 'sam@test.fr' });
    await settle();
    const link = new URL(inbox.at(-1).text.match(/https?:\/\/\S+/)[0]);
    const r = await form(server.base, '/reinitialiser', { token: link.searchParams.get('token'), password: 'nouveau-mdp-456', confirm: 'nouveau-mdp-456' });
    assert.equal(r.status, 200);

    assert.equal((await call('GET', '/api/me', null, phone)).status, 401);
    const again = await call('POST', '/api/auth/login', { email: 'sam@test.fr', password: 'nouveau-mdp-456' });
    assert.equal((await call('GET', '/api/me', null, again.json.token)).status, 200);
  } finally { server.close(); }
});

test('modifier autre chose que le mot de passe ne déconnecte personne', async () => {
  const { server, call } = await boot();
  try {
    const reg = await call('POST', '/api/auth/register', { email: 'max@test.fr', password: 'mdp-stable-123' });
    await new Promise((r) => setTimeout(r, 1100));
    const owner = (await loginOwner(call)).json.token;
    await call('PATCH', `/api/admin/users/${reg.json.user.id}`, { add_credits: 10, note: 'client fidèle' }, owner);
    assert.equal((await call('GET', '/api/me', null, reg.json.token)).status, 200);
  } finally { server.close(); }
});
