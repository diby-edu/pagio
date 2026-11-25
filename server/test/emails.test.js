// Tests des e-mails automatiques : réglages chiffrés, e-mail d'essai, confirmation d'adresse, mot de passe oublié,
// alertes par e-mail. Aucun envoi réel : la fonction d'envoi est remplacée par une boîte de réception en mémoire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logServerError } from '../src/db.js';
import { boot, loginOwner } from './helpers.js';

const linkIn = (mail) => new URL(mail.text.match(/https?:\/\/\S+/)[0]);
const form = (base, path, fields) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
const settle = () => new Promise((r) => setTimeout(r, 30)); // les envois liés à une requête partent juste après la réponse

async function bootWithMail(overrides = {}) {
  const inbox = [];
  let failing = false;
  const sendMail = async (config, message) => {
    if (failing) throw new Error('Clé refusée par Brevo');
    inbox.push({ ...message, from: config.from_email, key: config.api_key });
  };
  const ctx = await boot({ secretsKey: 'cle-de-test', sendMail });
  const owner = (await loginOwner(ctx.call)).json.token;
  const saved = await ctx.call('PUT', '/api/admin/settings', { mail: {
    enabled: true, api_key: 'xkeysib-secret-de-test-1234', from_email: 'Bonjour@Pagio.test', from_name: 'Pagio',
    public_url: 'https://pagio.exemple.test/', verify_signup: true, alerts_enabled: true, alerts_to: 'alerte@pagio.test', ...overrides,
  } }, owner);
  return { ...ctx, inbox, owner, saved, fail: (v) => { failing = v; } };
}

test('e-mails : réglages chiffrés, clé jamais renvoyée, e-mail d\'essai', async () => {
  const { server, call, db, inbox, owner, saved, fail } = await bootWithMail();
  try {
    assert.equal(saved.status, 200);
    const m = saved.json.settings.mail;
    assert.equal(m.api_key, '••••1234');
    assert.equal(m.has_key, true);
    assert.equal(m.from_email, 'bonjour@pagio.test');
    assert.equal(m.public_url, 'https://pagio.exemple.test');
    assert.ok(!('mail_alert_state' in saved.json.settings));
    // En base : clé chiffrée, jamais en clair
    const stored = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'mail'").get().value);
    assert.ok(stored.api_key.startsWith('enc:v1:'));
    assert.ok(!JSON.stringify(stored).includes('secret-de-test'));
    // Réenregistrer la clé masquée conserve la vraie clé
    await call('PUT', '/api/admin/settings', { mail: { ...m, from_name: 'Pagio App' } }, owner);
    // Le journal d'audit ne contient pas la clé
    assert.ok(!JSON.stringify(db.prepare('SELECT details FROM audit').all()).includes('secret-de-test'));

    const t = await call('POST', '/api/admin/mail/test', { to: 'moi@test.fr' }, owner);
    assert.equal(t.status, 200);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].to, 'moi@test.fr');
    assert.equal(inbox[0].key, 'xkeysib-secret-de-test-1234');
    assert.equal(inbox[0].from, 'bonjour@pagio.test');

    // Refus du fournisseur : message clair, pas de panne
    fail(true);
    const bad = await call('POST', '/api/admin/mail/test', {}, owner);
    assert.equal(bad.status, 502);
    assert.match(bad.json.error, /Clé refusée par Brevo/);
    fail(false);

    // Réglages invalides refusés ; rôle support refusé
    assert.equal((await call('PUT', '/api/admin/settings', { mail: { from_email: 'pas-une-adresse' } }, owner)).status, 400);
    assert.equal((await call('PUT', '/api/admin/settings', { mail: { public_url: 'pagio.test' } }, owner)).status, 400);
    const support = (await call('POST', '/api/admin/login', { email: 'support@test.fr', password: 'motdepasse-support' })).json.token;
    assert.equal((await call('POST', '/api/admin/mail/test', {}, support)).status, 403);
  } finally { server.close(); }
});

test('e-mails : adresse publique de l\'administration refusée', async () => {
  const { server, call, owner } = await bootWithMail();
  try {
    const r = await call('PUT', '/api/admin/settings', { mail: { public_url: 'https://admin.pagio.site' } }, owner);
    assert.equal(r.status, 400);
    assert.match(r.json.error, /administration/);
  } finally { server.close(); }
});

test('e-mails : clé Brevo gardée active une fois par semaine, clé refusée signalée', async () => {
  const pings = [];
  let answer = { ok: true, status: 200, message: '' };
  const inbox = [];
  const ctx = await boot({ secretsKey: 'cle-de-test', sendMail: async (c, m) => { inbox.push(m); }, checkMailKey: async (key) => { pings.push(key); return answer; } });
  const { server, call, app, db } = ctx;
  try {
    const owner = (await loginOwner(call)).json.token;
    // E-mails inactifs : aucun contact avec Brevo
    assert.equal(await app.locals.keepMailKeyAlive(), null);
    await call('PUT', '/api/admin/settings', { mail: { enabled: true, api_key: 'xkeysib-cle-1111', from_email: 'noreply@pagio.test', public_url: 'https://pagio.test' } }, owner);
    assert.equal((await app.locals.keepMailKeyAlive()).ok, true);
    assert.deepEqual(pings, ['xkeysib-cle-1111']);
    // Moins d'une semaine après un contact réussi : rien
    assert.equal(await app.locals.keepMailKeyAlive(), null);
    assert.equal(pings.length, 1);
    // Une semaine plus tard (simulée) : nouveau contact
    const kc = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'mail_key_check'").get().value);
    db.prepare("UPDATE settings SET value = ? WHERE key = 'mail_key_check'").run(JSON.stringify({ ...kc, ts: kc.ts - 8 * 86_400_000 }));
    answer = { ok: false, status: 401, message: "Brevo ne reconnaît plus la clé d'API" };
    assert.equal((await app.locals.keepMailKeyAlive()).ok, false);
    const alerts = (await call('GET', '/api/admin/alerts', null, owner)).json.alerts;
    assert.ok(alerts.some((a) => a.code === 'mail_key_refused' && a.level === 'critical'));
    // Nouvelle clé collée : vérification remise à zéro, l'alerte disparaît, nouveau contact
    answer = { ok: true, status: 200, message: '' };
    await call('PUT', '/api/admin/settings', { mail: { api_key: 'xkeysib-cle-2222' } }, owner);
    assert.ok(!(await call('GET', '/api/admin/alerts', null, owner)).json.alerts.some((a) => a.code === 'mail_key_refused'));
    assert.equal((await app.locals.keepMailKeyAlive()).ok, true);
    assert.equal(pings.at(-1), 'xkeysib-cle-2222');
  } finally { server.close(); }
});

test('e-mails : activation impossible sans clé ni expéditeur', async () => {
  const { server, call } = await boot();
  try {
    const owner = (await loginOwner(call)).json.token;
    assert.equal((await call('PUT', '/api/admin/settings', { mail: { enabled: true } }, owner)).status, 400);
    // Sans e-mails : l'inscription n'envoie rien et le mot de passe oublié reste traité par le support
    const u = await call('POST', '/api/auth/register', { email: 'sans@test.fr', password: 'secret123' });
    assert.equal(u.json.user.email_verified, false);
    const f = await call('POST', '/api/auth/forgot', { email: 'sans@test.fr' });
    assert.match(f.json.message, /support vous contactera/);
    assert.equal((await call('GET', '/api/admin/resets', null, owner)).json.resets.length, 1);
    assert.equal((await call('POST', '/api/auth/resend-verification', null, u.json.token)).status, 503);
  } finally { server.close(); }
});

test('e-mails : confirmation de l\'adresse à l\'inscription', async () => {
  const { server, call, db, inbox } = await bootWithMail();
  try {
    const u = await call('POST', '/api/auth/register', { email: 'awa@test.fr', password: 'secret123' });
    assert.equal(u.status, 200);
    assert.equal(u.json.user.email_verified, false);
    await settle();
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].to, 'awa@test.fr');
    const link = linkIn(inbox[0]);
    assert.equal(link.origin, 'https://pagio.exemple.test');
    assert.equal(link.pathname, '/verifier');
    const token = link.searchParams.get('token');
    // Le jeton n'est pas stocké tel quel
    assert.notEqual(db.prepare("SELECT verify_token t FROM users WHERE email = 'awa@test.fr'").get().t, token);

    assert.equal((await fetch(`${server.base}/verifier?token=faux`)).status, 400);
    const page = await fetch(`${server.base}/verifier?token=${token}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Adresse confirmée/);
    assert.equal((await call('GET', '/api/me', null, u.json.token)).json.user.email_verified, true);
    assert.equal((await fetch(`${server.base}/verifier?token=${token}`)).status, 400); // utilisable une seule fois

    // Renvoi : inutile une fois confirmée ; possible sinon
    assert.match((await call('POST', '/api/auth/resend-verification', null, u.json.token)).json.message, /déjà confirmée/);
    const v = await call('POST', '/api/auth/register', { email: 'ben@test.fr', password: 'secret123' });
    await settle();
    assert.equal((await call('POST', '/api/auth/resend-verification', null, v.json.token)).status, 200);
    assert.equal(inbox.filter((m) => m.to === 'ben@test.fr').length, 2);
    // Le premier lien est remplacé par le second
    const [first, second] = inbox.filter((m) => m.to === 'ben@test.fr').map((m) => linkIn(m).searchParams.get('token'));
    assert.equal((await fetch(`${server.base}/verifier?token=${first}`)).status, 400);
    assert.equal((await fetch(`${server.base}/verifier?token=${second}`)).status, 200);
  } finally { server.close(); }
});

test('e-mails : inscription sans confirmation si l\'option est coupée', async () => {
  const { server, call, inbox } = await bootWithMail({ verify_signup: false });
  try {
    await call('POST', '/api/auth/register', { email: 'cle@test.fr', password: 'secret123' });
    await settle();
    assert.equal(inbox.length, 0);
  } finally { server.close(); }
});

test('e-mails : mot de passe oublié de bout en bout', async () => {
  const { server, call, db, inbox, fail } = await bootWithMail({ verify_signup: false });
  try {
    await call('POST', '/api/auth/register', { email: 'lea@test.fr', password: 'ancien-secret' });
    // Adresse inconnue : même réponse, aucun envoi
    const unknown = await call('POST', '/api/auth/forgot', { email: 'personne@test.fr' });
    const known = await call('POST', '/api/auth/forgot', { email: 'LEA@test.fr' });
    await settle();
    assert.deepEqual(unknown.json, known.json);
    assert.match(known.json.message, /e-mail vient de lui être envoyé/);
    assert.equal(inbox.length, 1);
    const link = linkIn(inbox[0]);
    assert.equal(link.pathname, '/reinitialiser');
    const token = link.searchParams.get('token');
    assert.notEqual(db.prepare("SELECT reset_token t FROM users WHERE email = 'lea@test.fr'").get().t, token);

    // Page du formulaire
    assert.equal((await fetch(`${server.base}/reinitialiser?token=faux`)).status, 400);
    const page = await fetch(`${server.base}/reinitialiser?token=${token}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /name="password"/);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);

    // Saisies refusées : le lien reste utilisable
    assert.equal((await form(server.base, '/reinitialiser', { token, password: 'nouveau-secret', confirm: 'different' })).status, 400);
    assert.equal((await form(server.base, '/reinitialiser', { token, password: 'court', confirm: 'court' })).status, 400);
    const done = await form(server.base, '/reinitialiser', { token, password: 'nouveau-secret', confirm: 'nouveau-secret' });
    assert.equal(done.status, 200);
    assert.match(await done.text(), /Mot de passe modifié/);

    assert.equal((await call('POST', '/api/auth/login', { email: 'lea@test.fr', password: 'ancien-secret' })).status, 401);
    const login = await call('POST', '/api/auth/login', { email: 'lea@test.fr', password: 'nouveau-secret' });
    assert.equal(login.status, 200);
    assert.equal(login.json.user.email_verified, true); // recevoir le lien prouve l'adresse
    // Lien à usage unique, y compris par l'API
    assert.equal((await form(server.base, '/reinitialiser', { token, password: 'encore-un-autre', confirm: 'encore-un-autre' })).status, 400);
    assert.equal((await call('POST', '/api/auth/reset', { token, password: 'encore-un-autre' })).status, 400);

    // Lien expiré
    await call('POST', '/api/auth/forgot', { email: 'lea@test.fr' });
    await settle();
    const token2 = linkIn(inbox.at(-1)).searchParams.get('token');
    db.prepare("UPDATE users SET reset_expires = ? WHERE email = 'lea@test.fr'").run(Date.now() - 1000);
    assert.equal((await call('POST', '/api/auth/reset', { token: token2, password: 'encore-un-autre' })).status, 400);

    // Envoi refusé par le fournisseur : la réponse ne change pas, l'erreur est au journal
    fail(true);
    const r = await call('POST', '/api/auth/forgot', { email: 'lea@test.fr' });
    await settle();
    assert.equal(r.status, 200);
    const err = db.prepare("SELECT message, path FROM server_errors WHERE source = 'email'").get();
    assert.match(err.message, /Clé refusée/);
    assert.ok(!err.path.includes('lea@')); // l'adresse complète n'est pas recopiée dans le journal

    // Compte suspendu : aucun lien envoyé
    fail(false);
    db.prepare("UPDATE users SET banned = 1 WHERE email = 'lea@test.fr'").run();
    const before = inbox.length;
    await call('POST', '/api/auth/forgot', { email: 'lea@test.fr' });
    await settle();
    assert.equal(inbox.length, before);
  } finally { server.close(); }
});

test('e-mails : alertes envoyées une fois par jour', async () => {
  const { server, call, db, inbox, app, owner } = await bootWithMail();
  try {
    // Premier passage : seules les alertes propres à la machine de test (disque presque plein…) peuvent partir.
    const machine = await app.locals.sendAlertEmails();
    assert.equal(inbox.length, machine > 0 ? 1 : 0);
    assert.ok(inbox.every((m) => !/erreur\(s\) du serveur|double authentification|message\(s\) d'utilisateurs/.test(m.text)));
    inbox.length = 0;
    logServerError(db, 'serveur', new Error('Panne simulée'));
    assert.equal(await app.locals.sendAlertEmails(), 1);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].to, 'alerte@pagio.test');
    assert.match(inbox[0].text, /1 erreur\(s\) du serveur/);
    assert.match(inbox[0].text, /https:\/\/pagio\.exemple\.test/);
    // Même alerte toujours active : pas de second e-mail avant 24 heures
    assert.equal(await app.locals.sendAlertEmails(), 0);
    assert.equal(inbox.length, 1);
    const state = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'mail_alert_state'").get().value);
    db.prepare("UPDATE settings SET value = ? WHERE key = 'mail_alert_state'").run(JSON.stringify({ ...state, errors: state.errors - 25 * 3_600_000 }));
    assert.equal(await app.locals.sendAlertEmails(), 1);
    assert.equal(inbox.length, 2);
    // Alerte disparue puis revenue : signalée de nouveau
    db.prepare('DELETE FROM server_errors').run();
    assert.equal(await app.locals.sendAlertEmails(), 0);
    logServerError(db, 'serveur', new Error('Nouvelle panne'));
    assert.equal(await app.locals.sendAlertEmails(), 1);
    assert.equal(inbox.length, 3);
    // Option coupée : plus aucun envoi
    const m = (await call('GET', '/api/admin/settings', null, owner)).json.settings.mail;
    await call('PUT', '/api/admin/settings', { mail: { ...m, alerts_enabled: false } }, owner);
    db.prepare("DELETE FROM settings WHERE key = 'mail_alert_state'").run();
    assert.equal(await app.locals.sendAlertEmails(), 0);
    assert.equal(inbox.length, 3);
  } finally { server.close(); }
});

test('rapport hebdomadaire : contenu, lundi seulement, une fois par semaine, désactivable', async () => {
  const sent = [];
  const { server, call, db, app } = await boot({ sendMail: async (cfg, m) => { sent.push(m); } });
  try {
    const owner = (await loginOwner(call)).json.token;
    await call('PUT', '/api/admin/settings', { mail: { enabled: true, api_key: 'xkeysib-test', from_email: 'noreply@pagio.site', public_url: 'https://pagio.site', alerts_to: 'patron@exemple.ci' } }, owner);
    db.prepare("INSERT INTO site_hits (ts, visitor, path, source) VALUES (?, 'v1', '/', 'Google')").run(Date.now() - 3600_000);
    // Envoi à la demande depuis le tableau de bord
    assert.equal((await call('POST', '/api/admin/report/send', {}, owner)).status, 200);
    const m = sent.at(-1);
    assert.match(m.subject, /votre semaine/);
    assert.match(m.text, /Visiteurs du site : 1/);
    assert.match(m.text, /admin\.pagio\.site\/#stats/);
    // Envoi automatique : pas un mardi ; le lundi à 8 h oui, une seule fois ; désactivable
    const n = sent.length;
    assert.equal(await app.locals.sendWeeklyReport({ now: new Date('2026-12-01T08:00:00Z') }), false);
    assert.equal(await app.locals.sendWeeklyReport({ now: new Date('2026-11-30T06:00:00Z') }), false);
    assert.equal(await app.locals.sendWeeklyReport({ now: new Date('2026-11-30T08:00:00Z') }), true);
    assert.equal(await app.locals.sendWeeklyReport({ now: new Date('2026-11-30T09:00:00Z') }), false);
    assert.equal(sent.length, n + 1);
    await call('PUT', '/api/admin/settings', { mail: { weekly_report: false } }, owner);
    assert.equal(await app.locals.sendWeeklyReport({ now: new Date('2026-12-07T08:00:00Z') }), false);
  } finally {
    server.close();
  }
});
