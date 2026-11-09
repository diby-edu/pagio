// Tests de la sécurité de l'administration : sessions, double authentification, chiffrement des secrets, limites.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSettings } from '../src/db.js';
import { deriveKey, totpCode, verifyTotp, newTotpSecret, encryptSecret, decryptSecret } from '../src/security.js';
import { boot, loginOwner } from './helpers.js';

test('sessions : chaque connexion est révocable immédiatement', async () => {
  const { server, call } = await boot();
  try {
    const t1 = (await loginOwner(call)).json.token;
    const t2 = (await loginOwner(call)).json.token;
    const sessions = (await call('GET', '/api/admin/sessions', null, t1)).json.sessions;
    assert.equal(sessions.length, 2);
    assert.equal(sessions.filter((s) => s.current).length, 1);
    const other = sessions.find((s) => !s.current);
    assert.equal((await call('DELETE', `/api/admin/sessions/${other.id}`, null, t1)).status, 200);
    assert.equal((await call('GET', '/api/admin/me', null, t2)).status, 401); // l'autre appareil est déconnecté
    assert.equal((await call('GET', '/api/admin/me', null, t1)).status, 200);

    // Un membre du support ne voit que ses sessions et ne peut pas fermer celles des autres
    const sup = (await call('POST', '/api/admin/login', { email: 'support@test.fr', password: 'motdepasse-support' })).json.token;
    assert.equal((await call('GET', '/api/admin/sessions', null, sup)).json.sessions.length, 1);
    const mine = (await call('GET', '/api/admin/sessions', null, t1)).json.sessions.find((s) => s.current);
    assert.equal((await call('DELETE', `/api/admin/sessions/${mine.id}`, null, sup)).status, 403);

    // Changer le mot de passe ferme les autres sessions ; la déconnexion ferme la session courante
    const t3 = (await loginOwner(call)).json.token;
    assert.equal((await call('POST', '/api/admin/me/password', { current: 'motdepasse-admin', next: 'motdepasse-admin' }, t1)).json.sessions_closed, 1);
    assert.equal((await call('GET', '/api/admin/me', null, t3)).status, 401);
    const t4 = (await loginOwner(call)).json.token;
    assert.equal((await call('POST', '/api/admin/logout', null, t4)).status, 200);
    assert.equal((await call('GET', '/api/admin/me', null, t4)).status, 401);

    // Le propriétaire réinitialise le mot de passe d'un collègue : ses sessions sont fermées
    const supId = (await call('GET', '/api/admin/admins', null, t1)).json.admins.find((a) => a.email === 'support@test.fr').id;
    assert.equal((await call('PATCH', `/api/admin/admins/${supId}`, { password: 'nouveau-mot-de-passe' }, t1)).status, 200);
    assert.equal((await call('GET', '/api/admin/me', null, sup)).status, 401);
  } finally {
    server.close();
  }
});

test('double authentification : activation, connexion, rejeu, codes de secours, désactivation', async () => {
  const { server, call, db } = await boot({ secretsKey: 'cle-de-test' });
  try {
    const t1 = (await loginOwner(call)).json.token;
    assert.equal((await call('POST', '/api/admin/me/2fa/setup', { password: 'faux' }, t1)).status, 400);
    const setup = (await call('POST', '/api/admin/me/2fa/setup', { password: 'motdepasse-admin' }, t1)).json;
    assert.match(setup.uri, /^otpauth:\/\/totp\//);
    const stored = db.prepare("SELECT totp_secret FROM admins WHERE email = 'owner@test.fr'").get().totp_secret;
    assert.ok(stored.startsWith('enc:v1:') && !stored.includes(setup.secret)); // secret chiffré en base

    // Tant que le premier code n'est pas validé, la double authentification n'est pas exigée
    assert.equal((await loginOwner(call)).status, 200);
    assert.equal((await call('POST', '/api/admin/me/2fa/enable', { code: '000000' }, t1)).status, 400);
    const step = Math.floor(Date.now() / 30_000);
    const enabled = await call('POST', '/api/admin/me/2fa/enable', { code: totpCode(setup.secret, step) }, t1);
    assert.equal(enabled.status, 200);
    assert.equal(enabled.json.recovery_codes.length, 8);
    assert.equal((await call('GET', '/api/admin/me', null, t1)).json.admin.totp_enabled, true);
    assert.ok(!db.prepare("SELECT recovery_codes FROM admins WHERE email = 'owner@test.fr'").get().recovery_codes.includes(enabled.json.recovery_codes[0]));

    // Connexion : mot de passe seul refusé, mauvais code refusé, code rejoué refusé, code suivant accepté
    const noCode = await loginOwner(call);
    assert.equal(noCode.status, 401);
    assert.equal(noCode.json.totp_required, true);
    assert.equal(noCode.json.token, undefined);
    assert.equal((await loginOwner(call, { code: '123456' })).status, 401);
    assert.equal((await loginOwner(call, { code: totpCode(setup.secret, step) })).status, 401); // déjà utilisé à l'activation
    const withCode = await loginOwner(call, { code: totpCode(setup.secret, step + 1) });
    assert.equal(withCode.status, 200);

    // Code de secours : valable une seule fois
    const rc = enabled.json.recovery_codes[0];
    assert.equal((await loginOwner(call, { code: rc })).status, 200);
    assert.equal((await loginOwner(call, { code: rc })).status, 401);

    // Désactivation : mot de passe et code exigés
    const admin = withCode.json.token;
    assert.equal((await call('POST', '/api/admin/me/2fa/disable', { password: 'motdepasse-admin', code: '111111' }, admin)).status, 400);
    assert.equal((await call('POST', '/api/admin/me/2fa/disable', { password: 'motdepasse-admin', code: enabled.json.recovery_codes[1] }, admin)).status, 200);
    assert.equal((await loginOwner(call)).status, 200);
  } finally {
    server.close();
  }
});

test('TOTP : conforme aux vecteurs de la RFC 6238', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // « 12345678901234567890 » en base32
  assert.equal(totpCode(secret, Math.floor(59 / 30)), '287082');
  assert.equal(totpCode(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totpCode(secret, Math.floor(1234567890 / 30)), '005924');
  const s = newTotpSecret();
  const now = 1_700_000_000_000;
  const step = Math.floor(now / 30_000);
  assert.equal(verifyTotp(s, totpCode(s, step), 0, now), step);
  assert.equal(verifyTotp(s, totpCode(s, step - 1), 0, now), step - 1); // léger retard d'horloge toléré
  assert.equal(verifyTotp(s, totpCode(s, step - 5), 0, now), 0);
  assert.equal(verifyTotp(s, totpCode(s, step), step, now), 0); // rejeu interdit
});

test("clé d'IA : chiffrée en base, masquée pour le navigateur", async () => {
  const { server, call, db } = await boot({ secretsKey: 'cle-de-test' });
  try {
    const admin = (await loginOwner(call)).json.token;
    await call('PUT', '/api/admin/settings', { ai: { enabled: true, provider: 'openai', api_key: 'sk-tres-secret-9876' } }, admin);
    const rawAi = db.prepare("SELECT value FROM settings WHERE key = 'ai'").get().value;
    assert.ok(!rawAi.includes('sk-tres-secret-9876'));
    assert.ok(JSON.parse(rawAi).api_key.startsWith('enc:v1:'));
    assert.equal(getSettings(db).ai.api_key, 'sk-tres-secret-9876'); // le serveur, lui, sait la relire
    assert.equal((await call('GET', '/api/admin/settings', null, admin)).json.settings.ai.api_key, '••••9876');
    await call('PUT', '/api/admin/settings', { ai: { model: 'x', api_key: '••••9876' } }, admin);
    assert.equal(getSettings(db).ai.api_key, 'sk-tres-secret-9876'); // conservée quand on enregistre sans la retaper
    assert.throws(() => decryptSecret(encryptSecret('abc', deriveKey('a')), deriveKey('b'))); // mauvaise clé = illisible
    assert.ok(!JSON.stringify((await call('GET', '/api/admin/audit', null, admin)).json).includes('sk-tres-secret'));
  } finally {
    server.close();
  }
});

test('limites : inscriptions par adresse, conversion réservée aux comptes, taille et quota', async () => {
  const { server, call, raw } = await boot();
  try {
    const admin = (await loginOwner(call)).json.token;
    await call('PUT', '/api/admin/settings', { limits: { register_per_hour: 2, convert_require_account: true, convert_max_mb: 1 } }, admin);
    assert.equal((await call('POST', '/api/auth/register', { email: 'a1@test.fr', password: 'secret123' })).status, 200);
    const u2 = await call('POST', '/api/auth/register', { email: 'a2@test.fr', password: 'secret123' });
    assert.equal(u2.status, 200);
    assert.equal((await call('POST', '/api/auth/register', { email: 'a3@test.fr', password: 'secret123' })).status, 429);
    assert.equal((await raw('POST', '/api/convert?to=pdf&name=a.txt', Buffer.from('bonjour'))).status, 401);
    assert.equal((await raw('POST', '/api/convert?to=pdf&name=a.txt', Buffer.alloc(2 * 1048576), u2.json.token)).status, 413);
    await call('PUT', '/api/admin/settings', { limits: { convert_user_per_hour: 1, convert_max_mb: 50 } }, admin);
    const first = await raw('POST', '/api/convert?to=pdf&name=a.txt', Buffer.from('bonjour'), u2.json.token);
    assert.notEqual(first.status, 429); // acceptée par le quota (501 ensuite : LibreOffice n'est pas détecté dans les tests)
    assert.equal((await raw('POST', '/api/convert?to=pdf&name=a.txt', Buffer.from('bonjour'), u2.json.token)).status, 429);
    // Valeurs absurdes ramenées dans les bornes
    const s = (await call('PUT', '/api/admin/settings', { limits: { convert_max_mb: 99999 }, backup: { hour: 99, keep_days: 0 } }, admin)).json.settings;
    assert.equal(s.limits.convert_max_mb, 100);
    assert.equal(s.backup.hour, 23);
    assert.equal(s.backup.keep_days, 1);
  } finally {
    server.close();
  }
});

test('en-têtes de sécurité et accès sans session', async () => {
  const { server, call, raw } = await boot();
  try {
    const r = await raw('GET', '/api/health');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    for (const p of ['/api/admin/sessions', '/api/admin/backups', '/api/admin/settings']) assert.equal((await call('GET', p)).status, 401);
  } finally {
    server.close();
  }
});
