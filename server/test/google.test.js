// Connexion « avec Google » : vérification cryptographique du jeton, puis création ou ouverture du compte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyGoogleToken } from '../src/google.js';
import { boot, loginOwner } from './helpers.js';

const CLIENT = '1234-abcd.apps.googleusercontent.com';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'cle1', alg: 'RS256', use: 'sig' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(payload, { kid = 'cle1', key = privateKey } = {}) {
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' }); const body = b64(payload);
  return `${head}.${body}.${crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
}
const good = (over = {}) => ({ iss: 'https://accounts.google.com', aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 600, email: 'Ama@Gmail.com', email_verified: true, name: 'Ama K', sub: '42', ...over });

test('jeton Google : accepté seulement s\'il est authentique, pour nous, valide et vérifié', async () => {
  const keys = [jwk];
  assert.deepEqual(await verifyGoogleToken(sign(good()), CLIENT, { keys }), { email: 'ama@gmail.com', name: 'Ama K', sub: '42' });
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  await assert.rejects(verifyGoogleToken(sign(good(), { key: other }), CLIENT, { keys }), /Signature/);
  await assert.rejects(verifyGoogleToken(sign(good(), { kid: 'inconnue' }), CLIENT, { keys }), /clé inconnue/);
  await assert.rejects(verifyGoogleToken(sign(good({ aud: 'autre.apps.googleusercontent.com' })), CLIENT, { keys }), /autre application/);
  await assert.rejects(verifyGoogleToken(sign(good({ iss: 'pirate.example' })), CLIENT, { keys }), /émetteur/);
  await assert.rejects(verifyGoogleToken(sign(good({ exp: 1000 })), CLIENT, { keys }), /expiré/);
  await assert.rejects(verifyGoogleToken(sign(good({ email_verified: false })), CLIENT, { keys }), /non vérifiée/);
  await assert.rejects(verifyGoogleToken('n.importe.quoi', CLIENT, { keys }), /invalide/);
  await assert.rejects(verifyGoogleToken(sign(good()), '', { keys }), /non configurée/);
});

test('connexion Google : compte créé au premier passage, ouvert ensuite, réglage validé', async () => {
  const verifyGoogle = (token, clientId) => verifyGoogleToken(token, clientId, { keys: [jwk] });
  const { server, call, db } = await boot({ verifyGoogle });
  try {
    const owner = (await loginOwner(call)).json.token;
    // Pas d'identifiant client : refus, et le bouton est masqué (config vide)
    assert.equal((await call('POST', '/api/auth/google', { credential: sign(good()) })).status, 401);
    assert.equal((await call('GET', '/api/app/config')).json.google_client_id, '');
    assert.equal((await call('PUT', '/api/admin/settings', { google_client_id: 'pas-un-identifiant' }, owner)).status, 400);
    assert.equal((await call('PUT', '/api/admin/settings', { google_client_id: CLIENT }, owner)).status, 200);
    assert.equal((await call('GET', '/api/app/config')).json.google_client_id, CLIENT);

    const first = await call('POST', '/api/auth/google', { credential: sign(good()) });
    assert.equal(first.status, 200);
    assert.ok(first.json.token);
    const u = db.prepare("SELECT * FROM users WHERE email = 'ama@gmail.com'").get();
    assert.equal(u.email_verified, 1);
    assert.equal(u.name, 'Ama K');
    // Deuxième passage : même compte
    const again = await call('POST', '/api/auth/google', { credential: sign(good()) });
    assert.equal(again.json.user.id ?? again.json.user.email, first.json.user.id ?? first.json.user.email);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
    // Le jeton ouvre bien le compte
    db.prepare("UPDATE users SET note = 'Note interne de l''administrateur' WHERE email = 'ama@gmail.com'").run();
    const mine = (await call('GET', '/api/me', null, again.json.token)).json.user;
    assert.equal(mine.email, 'ama@gmail.com');
    assert.ok(!('note' in mine), "la note interne de l'administrateur n'est jamais renvoyée à l'utilisateur");
    // Un faux jeton est refusé
    assert.equal((await call('POST', '/api/auth/google', { credential: sign(good({ aud: 'x.apps.googleusercontent.com' })) })).status, 401);
  } finally { server.close(); }
});
