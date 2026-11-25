// Notifications de Pagio Admin : cases à cocher par téléphone, événements (message, inscription, paiement, Premium,
// alertes), essai, réglage Firebase et envoi instantané (Firebase simulé, aucun accès réseau).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { boot, loginOwner } from './helpers.js';
import { parsePrefs, cleanPrefs, isQuietHour, parseFirebaseJson } from '../src/notify.js';

test('préférences : valeurs par défaut, nettoyage, heures calmes', () => {
  const d = parsePrefs(null);
  assert.equal(d.kinds.critical, true);
  assert.equal(d.kinds.signup, false); // inscriptions : décochées par défaut
  assert.equal(d.quiet, false);
  const c = cleanPrefs({ kinds: { payment: false, signup: true, inconnu: true }, quiet: true });
  assert.equal(c.kinds.payment, false);
  assert.equal(c.kinds.signup, true);
  assert.equal('inconnu' in c.kinds, false);
  assert.equal(c.quiet, true);
  assert.equal(isQuietHour(Date.UTC(2026, 0, 1, 23)), true);
  assert.equal(isQuietHour(Date.UTC(2026, 0, 1, 12)), false);
  assert.throws(() => parseFirebaseJson('pas du json'), /JSON/);
  assert.throws(() => parseFirebaseJson('{"a":1}'), /non reconnu/);
});

test('notifications : cases cochées, flux d\'événements, essai, Firebase et envoi instantané', async () => {
  const sent = [];
  const pushFetch = async (url, opts) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'jeton-acces', expires_in: 3600 }), { status: 200 });
    const body = JSON.parse(opts.body);
    if (body.message.token === 'perime-' + 'x'.repeat(30)) return new Response(JSON.stringify({ error: { status: 'NOT_FOUND' } }), { status: 404 });
    sent.push(body.message);
    return new Response('{}', { status: 200 });
  };
  const { server, call, db } = await boot({ pushFetch, secretsKey: 'cle-de-test-pour-les-secrets' });
  const base = server.base;
  try {
    const owner = (await loginOwner(call)).json.token;
    const support = (await call('POST', '/api/admin/login', { email: 'support@test.fr', password: 'motdepasse-support' })).json.token;
    const key = (await call('POST', '/api/admin/notify/devices', { name: 'Mon téléphone' }, owner)).json.token;
    const feed = async (since) => (await fetch(`${base}/api/admin/notify/feed?since=${since}`, { headers: { 'x-pagio-notify': key } })).json();

    let list = (await call('GET', '/api/admin/notify/devices', null, owner)).json;
    assert.equal(list.kinds.length, 7);
    assert.equal(list.firebase.service, false);
    const dev = list.devices[0];
    assert.equal(dev.prefs.kinds.signup, false);
    assert.equal(dev.mine, true);
    // Le support ne peut pas changer les cases du téléphone d'un autre administrateur.
    assert.equal((await call('PUT', `/api/admin/notify/devices/${dev.id}/prefs`, { kinds: {} }, support)).status, 403);

    const start = (await feed(0)).last_event;
    // Un message et une inscription : seule le message est coché par défaut.
    await call('POST', '/api/app/feedback', { message: 'Le scanner ne marche pas chez moi' });
    await call('POST', '/api/auth/register', { email: 'nouveau@x.ci', password: 'motdepasse1' });
    let f = await feed(start);
    assert.deepEqual(f.events.map((e) => e.kind), ['feedback']);

    // On coche les inscriptions et on décoche les messages.
    const prefs = (await call('PUT', `/api/admin/notify/devices/${dev.id}/prefs`, { kinds: { signup: true, feedback: false } }, owner)).json.prefs;
    assert.equal(prefs.kinds.signup, true);
    f = await feed(start);
    assert.deepEqual(f.events.map((e) => e.kind), ['signup']);
    assert.match(f.events[0].body, /nouveau@x\.ci/);
    assert.equal(f.feedback.length, 0); // ancien flux, lui aussi filtré

    // Paiement enregistré par l'administration : un événement « paiement » et un « nouveau Premium ».
    const uid = db.prepare("SELECT id FROM users WHERE email = 'nouveau@x.ci'").get().id;
    assert.equal((await call('POST', `/api/admin/users/${uid}/payments`, { kind: 'premium', offer: 'month', method: 'orange_money', amount: 1000, reference: 'OM1' }, owner)).status, 200);
    f = await feed(start);
    assert.deepEqual(f.events.map((e) => e.kind), ['signup', 'premium', 'payment']);

    // Essai : arrive même si sa catégorie n'existe pas dans les cases ; sans Firebase, il passera par le flux.
    const t = (await call('POST', `/api/admin/notify/devices/${dev.id}/test`, null, owner)).json;
    assert.equal(t.instant, false);
    assert.equal((await feed(start)).events.at(-1).kind, 'test');

    // Firebase : fichier inconnu refusé ; google-services.json puis clé de compte de service acceptés (propriétaire seul).
    const gs = JSON.stringify({ project_info: { project_id: 'pagio-515720', project_number: '123' }, client: [{ client_info: { mobilesdk_app_id: '1:123:android:abc', android_client_info: { package_name: 'com.pagio.admin' } }, api_key: [{ current_key: 'cle-publique' }] }] });
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const sa = JSON.stringify({ type: 'service_account', project_id: 'pagio-515720', client_email: 'fcm@pagio-515720.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
    assert.equal((await call('PUT', '/api/admin/firebase', { json: gs }, support)).status, 403);
    assert.equal((await call('PUT', '/api/admin/firebase', { json: '{"x":1}' }, owner)).status, 400);
    assert.equal((await call('PUT', '/api/admin/firebase', { json: gs }, owner)).json.saved, 'client');
    // Le téléphone n'obtient la configuration qu'une fois les deux parties enregistrées.
    const conf = async () => (await fetch(`${base}/api/admin/notify/firebase`, { headers: { 'x-pagio-notify': key } })).json();
    assert.equal((await conf()).enabled, false);
    assert.equal((await call('PUT', '/api/admin/firebase', { json: sa }, owner)).json.saved, 'service');
    const c = await conf();
    assert.equal(c.enabled, true);
    assert.equal(c.app_id, '1:123:android:abc');
    // La clé privée est chiffrée en base et n'apparaît jamais dans les réglages renvoyés au tableau de bord.
    assert.ok(!db.prepare("SELECT value FROM settings WHERE key = 'firebase'").get().value.includes('PRIVATE KEY'));
    assert.ok(!JSON.stringify((await call('GET', '/api/admin/settings', null, owner)).json).includes('firebase'));

    // Le téléphone enregistre son jeton ; un essai part alors tout de suite.
    const pt = (token) => fetch(`${base}/api/admin/notify/push-token`, { method: 'POST', headers: { 'x-pagio-notify': key, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    assert.equal((await pt('court')).status, 400);
    assert.equal((await pt('jeton-fcm-' + 'a'.repeat(40))).status, 200);
    assert.equal((await call('POST', `/api/admin/notify/devices/${dev.id}/test`, null, owner)).json.instant, true);
    assert.equal(sent.at(-1).data.kind, 'test');
    assert.equal(sent.at(-1).android.priority, 'HIGH');

    // Une inscription (cochée) part tout de suite ; un message (décoché) ne part pas.
    sent.length = 0;
    await call('POST', '/api/auth/register', { email: 'deux@x.ci', password: 'motdepasse1' });
    await server.app?.locals?.lastPush;
    await new Promise((r) => setTimeout(r, 50));
    await call('POST', '/api/app/feedback', { message: 'Encore un message de test' });
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(sent.map((m) => m.data.kind), ['signup']);

    // Jeton périmé chez Google : il est oublié.
    await pt('perime-' + 'x'.repeat(30));
    await call('POST', `/api/admin/notify/devices/${dev.id}/test`, null, owner);
    assert.equal(db.prepare('SELECT fcm_token FROM notify_devices WHERE id = ?').get(dev.id).fcm_token, null);
  } finally { server.close(); }
});

test('alertes et pannes réparées deviennent des notifications, une seule fois', async () => {
  const { server, db, app } = await boot();
  try {
    assert.equal(app.locals.notifyTick(), 0); // premier passage : état mémorisé, rien n'est envoyé
    db.prepare("INSERT INTO server_errors (ts, source, message) VALUES (?, 'test', 'boum')").run(Date.now());
    const before = db.prepare('SELECT COUNT(*) n FROM notify_events').get().n;
    app.locals.notifyTick();
    app.locals.notifyTick(); // deuxième passage : pas de doublon
    const evs = db.prepare('SELECT * FROM notify_events').all();
    assert.ok(evs.length >= before);
    const keys = evs.map((e) => `${e.kind}|${e.body}`);
    assert.equal(new Set(keys).size, keys.length);
  } finally { server.close(); }
});
