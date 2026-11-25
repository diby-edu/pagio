// Statistiques détaillées de l'application : actifs, installations, rétention, appareils, outils, filtres.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, loginOwner } from './helpers.js';

const DAY = 86_400_000;

test('statistiques de l\'application : actifs, rétention, appareils, outils et filtres', async () => {
  const { server, call, db } = await boot();
  try {
    const now = Date.now();
    const ins = db.prepare('INSERT INTO events (ts, device_id, user_id, app_version, name, tool, ok, props) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)');
    const open = (ts, dev, ver, props) => ins.run(ts, dev, ver, 'app_open', null, null, JSON.stringify(props));
    // A : installé il y a 10 jours en Côte d'Ivoire, revenu 8 jours après ; B : installé il y a 10 jours au Sénégal, jamais revenu
    open(now - 10 * DAY, 'A', '2.2.0', { country: 'CI', brand: 'Xiaomi', model: 'X1', android: '15', lang: 'fr', first_open: true, installer: 'apk', screen_dp: '400x900' });
    open(now - 2 * DAY, 'A', '2.2.0', { country: 'CI', brand: 'Xiaomi', model: 'X1', android: '15', lang: 'fr', first_open: false, installer: 'apk', screen_dp: '400x900' });
    open(now - 10 * DAY, 'B', '2.1.0', { country: 'SN', brand: 'Samsung', model: 'A1', android: '13', lang: 'fr', first_open: true, installer: 'play_store', screen_dp: '340x700' });
    ins.run(now - 2 * DAY, 'A', '2.2.0', 'tool_run', 'merge', 1, JSON.stringify({ tool: 'merge', ok: true, ms: 1000, bytes_in: 2000, files: 2 }));
    ins.run(now - 2 * DAY, 'A', '2.2.0', 'tool_run', 'merge', 0, JSON.stringify({ tool: 'merge', ok: false, error: 'PASSWORD' }));
    ins.run(now - 2 * DAY, 'A', '2.2.0', 'limit_reached', 'compress', null, JSON.stringify({ tool: 'compress' }));
    ins.run(now - 2 * DAY, 'web:x', 'web', 'tool_run', 'merge', 1, '{}'); // outil en ligne : pas compté ici

    const owner = (await loginOwner(call)).json.token;
    const s = (await call('GET', '/api/admin/app-stats?days=30', null, owner)).json;
    assert.equal(s.users.installs, 2);
    assert.equal(s.users.wau, 1);
    assert.equal(s.users.mau, 2);
    assert.equal(s.users.retention.cohort, 2);
    assert.equal(s.users.retention.d7, 50);
    assert.equal(s.devices.count, 2);
    assert.deepEqual(s.devices.countries.map((c) => c.k).sort(), ['CI', 'SN']);
    assert.equal(s.devices.screens.find((x) => x.k.startsWith('petit')).n, 1);
    const merge = s.tools.list.find((t) => t.tool === 'merge');
    assert.equal(merge.runs, 2);
    assert.equal(merge.error_pct, 50);
    assert.equal(s.tools.limit_hits, 1);
    assert.equal(s.tools.errors[0].error, 'PASSWORD');
    assert.deepEqual(s.options.versions, ['2.2.0', '2.1.0']);

    // Filtre par pays : seulement l'appareil ivoirien
    const ci = (await call('GET', '/api/admin/app-stats?days=30&country=CI', null, owner)).json;
    assert.equal(ci.devices.count, 1);
    assert.equal(ci.users.installs, 1);
    // Filtre par version
    assert.equal((await call('GET', '/api/admin/app-stats?days=30&version=2.1.0', null, owner)).json.devices.count, 1);
  } finally {
    server.close();
  }
});
