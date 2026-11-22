// Disponibilité relevée par le gardien du VPS, alertes de certificats et de pannes, flux de notifications de l'APK admin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot, loginOwner } from './helpers.js';

const DAY = 86_400_000;

test('gardien : disponibilité sur 30 jours, pannes récentes et certificats proches de l\'expiration', async () => {
  const { server, call, dataDir } = await boot();
  try {
    const owner = (await loginOwner(call)).json.token;
    // Sans gardien installé : aucune information, aucune alerte inventée
    assert.equal((await call('GET', '/api/admin/system', null, owner)).json.availability, null);

    const g = path.join(dataDir, 'gardien'); fs.mkdirSync(g);
    const s = Math.floor(Date.now() / 1000);
    fs.writeFileSync(path.join(g, 'incidents.jsonl'), [
      { debut: s - 3600, fin: s - 3600 + 180, duree_s: 180, redemarre: true },    // il y a une heure, 3 min
      { debut: s - 40 * 86400, fin: s - 40 * 86400 + 60, duree_s: 60, redemarre: false }, // trop ancienne
    ].map((x) => JSON.stringify(x)).join('\n') + '\n');
    fs.writeFileSync(path.join(g, 'certificats.json'), JSON.stringify([
      { domaine: 'pagio.site', noms: 'pagio.site www.pagio.site', expire: s + 90 * 86400 },
      { domaine: 'admin.pagio.site', noms: 'admin.pagio.site', expire: s + 3 * 86400 },
    ]));
    fs.writeFileSync(path.join(g, 'derniere-verification'), String(s));

    const av = (await call('GET', '/api/admin/system', null, owner)).json.availability;
    assert.equal(av.incidents.length, 1);
    assert.equal(av.gardien_actif, true);
    assert.ok(av.disponibilite_30j < 100 && av.disponibilite_30j > 99.9);
    assert.equal(av.certificats.find((c) => c.domaine === 'admin.pagio.site').jours, 2);

    const alerts = (await call('GET', '/api/admin/alerts', null, owner)).json.alerts;
    assert.ok(alerts.some((a) => a.code === 'cert' && a.level === 'critical' && /admin\.pagio\.site/.test(a.message)));
    assert.ok(alerts.some((a) => a.code === 'outage' && /redémarré automatiquement/.test(a.message)));
    assert.ok(!alerts.some((a) => a.code === 'watchdog'));

    // Gardien silencieux depuis 20 minutes : signalé
    fs.writeFileSync(path.join(g, 'derniere-verification'), String(s - 1200));
    assert.ok((await call('GET', '/api/admin/alerts', null, owner)).json.alerts.some((a) => a.code === 'watchdog'));
  } finally { server.close(); }
});

test('notifications : clé par téléphone, flux limité, révocation immédiate', async () => {
  const { server, call, db, base } = await boot().then((b) => ({ ...b, base: b.server.base }));
  try {
    const owner = (await loginOwner(call)).json.token;
    const feed = (key) => fetch(`${base}/api/admin/notify/feed`, { headers: key ? { 'x-pagio-notify': key } : {} });
    assert.equal((await feed()).status, 401);
    assert.equal((await feed('inventee')).status, 401);

    const created = await call('POST', '/api/admin/notify/devices', { name: 'Téléphone de test' }, owner);
    const key = created.json.token;
    assert.ok(key.length > 30);
    // Seule l'empreinte est en base
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM notify_devices').all()).includes(key));

    db.prepare("INSERT INTO feedback (ts, kind, message, email, status) VALUES (?, 'contact', 'Le scanner ne marche pas', 'a@b.c', 'nouveau')").run(Date.now());
    const r = await feed(key);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.feedback.length, 1);
    assert.ok(Array.isArray(j.alerts) && Array.isArray(j.incidents));
    // La clé ne donne accès à rien d'autre
    assert.equal((await fetch(`${base}/api/admin/users`, { headers: { 'x-pagio-notify': key } })).status, 401);

    const list = (await call('GET', '/api/admin/notify/devices', null, owner)).json.devices;
    assert.equal(list.length, 1);
    assert.ok(list[0].last_seen > 0);
    assert.equal((await call('DELETE', `/api/admin/notify/devices/${list[0].id}`, null, owner)).status, 200);
    assert.equal((await feed(key)).status, 401);
  } finally { server.close(); }
});
