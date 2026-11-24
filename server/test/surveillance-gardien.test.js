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

test('mesures du VPS : graphiques regroupés, disponibilité, prévision du disque, autres sites, seuils réglables', async () => {
  const { server, call, dataDir } = await boot();
  try {
    const owner = (await loginOwner(call)).json.token;
    const g = path.join(dataDir, 'gardien'); fs.mkdirSync(g);
    const now = Math.floor(Date.now() / 1000);
    // 8 jours de mesures, une toutes les 10 minutes ; le disque se remplit de 1 000 Mo par jour (total 49 000 Mo, 40 000 utilisés).
    const lines = [];
    for (let t = now - 8 * 86400; t <= now; t += 600) {
      const daysAgo = (now - t) / 86400;
      lines.push(JSON.stringify({ t, cpu: 20, charge: 0.3, mem_total: 4000, mem_dispo: 1000, swap_total: 4000, swap_libre: 3900,
        disque_total: 49000, disque_utilise: Math.round(40000 - daysAgo * 1000), rx: 1048576, tx: 524288, pagio_mem: 30, pagio_limite: 1200,
        redemarrages: 0, base: 2, sauvegardes: 8, req: 10, r4xx: 1, r5xx: 0, tmoy: 200, t95: 2500, ok: 1 }));
    }
    // Les 10 dernières minutes : une mesure par minute (comme le vrai gardien).
    const last = JSON.parse(lines[lines.length - 1]);
    for (let k = 9; k >= 1; k--) lines.push(JSON.stringify({ ...last, t: now - k * 60 }));
    lines.sort((x, y) => JSON.parse(x).t - JSON.parse(y).t);
    fs.writeFileSync(path.join(g, 'mesures.jsonl'), lines.join('\n') + '\n');
    fs.writeFileSync(path.join(g, 'incidents.jsonl'), JSON.stringify({ debut: now - 7200, fin: now - 7200 + 864, duree_s: 864, redemarre: false }) + '\n');
    fs.writeFileSync(path.join(g, 'derniere-verification'), String(now));
    fs.writeFileSync(path.join(g, 'sites.json'), JSON.stringify([
      { domaine: 'wazzapai.com', code: 307, ms: 500, verifie: now }, { domaine: 'ancien.exemple', code: 0, ms: 0, verifie: now }]));
    fs.writeFileSync(path.join(g, 'certificats.json'), JSON.stringify([{ domaine: 'wazzapai.com', noms: 'wazzapai.com www.wazzapai.com', expire: now + 5 * 86400 }]));

    const r = (await call('GET', '/api/admin/system/metrics?range=24h', null, owner)).json;
    assert.ok(r.series.length >= 140 && r.series.length <= 290); // tranches de 5 minutes
    assert.equal(r.series[0].mem_pct, 75);
    assert.equal(r.summary.cpu_avg, 20);
    assert.equal(r.summary.t_moy_ms, 200);
    assert.equal(r.current.disk_total_mb, 49000);
    assert.equal(r.uptime['24h'], 99); // 864 s de panne sur 86 400
    assert.ok(r.disk_forecast.days_to_full >= 8 && r.disk_forecast.days_to_full <= 10);
    assert.equal(r.sites.find((x) => x.domaine === 'wazzapai.com').cert_jours, 4);
    assert.equal((await call('GET', '/api/admin/system/metrics?range=7d', null, owner)).json.series.length > 150, true);

    let alerts = (await call('GET', '/api/admin/alerts', null, owner)).json.alerts;
    assert.ok(alerts.some((a) => a.code === 'disk_forecast'));
    assert.ok(alerts.some((a) => a.code === 'slow'));
    assert.ok(alerts.some((a) => a.code === 'sites' && /ancien\.exemple/.test(a.message)));
    assert.ok(alerts.some((a) => a.code === 'sites_cert' && /wazzapai/.test(a.message)));

    // Seuils réglables, sites ignorés
    assert.equal((await call('PUT', '/api/admin/settings', { monitor: { disk_warn_pct: 5, disk_crit_pct: 10 } }, owner)).status, 400);
    await call('PUT', '/api/admin/settings', { monitor: { rt_warn_ms: 5000, sites_ignored: ['ancien.exemple', 'wazzapai.com'] } }, owner);
    alerts = (await call('GET', '/api/admin/alerts', null, owner)).json.alerts;
    assert.ok(!alerts.some((a) => ['slow', 'sites', 'sites_cert'].includes(a.code)));
  } finally {
    server.close();
  }
});
