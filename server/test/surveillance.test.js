// Tests de la surveillance et de la gestion des utilisateurs : erreurs du serveur, conversions, IA, alertes,
// fiche utilisateur, historique des offres, actions groupées.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logServerError } from '../src/db.js';
import { boot, loginOwner } from './helpers.js';

test('surveillance : erreurs du serveur, conversions, consommation IA, alertes', async () => {
  const { server, call, raw, db } = await boot();
  try {
    const owner = (await loginOwner(call)).json.token;
    const support = (await call('POST', '/api/admin/login', { email: 'support@test.fr', password: 'motdepasse-support' })).json.token;
    const user = (await call('POST', '/api/auth/register', { email: 'lea@test.fr', password: 'secret123' })).json;

    // --- Journal des erreurs : alimenté par le serveur, réservé aux administrateurs
    assert.equal((await call('GET', '/api/admin/errors', null, support)).status, 403);
    assert.equal((await call('GET', '/api/admin/errors', null, owner)).json.total, 0);
    logServerError(db, 'serveur', new Error('Panne simulée'), { method: 'GET', path: '/api/test', status: 500 });
    const bad = await fetch(server.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{pas du json' });
    assert.equal(bad.status, 400); // une requête mal formée n'est pas une panne du serveur
    const errs = (await call('GET', '/api/admin/errors', null, owner)).json;
    assert.equal(errs.total, 1);
    assert.equal(errs.errors[0].message, 'Panne simulée');
    assert.equal(errs.errors[0].path, '/api/test');
    assert.ok(errs.errors[0].stack.includes('Panne simulée'));
    assert.equal(errs.by_source[0].source, 'serveur');

    // --- Conversions : synthèse à partir des conversions enregistrées
    const ins = db.prepare('INSERT INTO conversions (ts, user_id, source_ext, target, bytes, ms, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    ins.run(Date.now(), user.user.id, 'docx', 'pdf', 1000, 4000, 1, null);
    ins.run(Date.now(), user.user.id, 'docx', 'pdf', 3000, 6000, 1, null);
    ins.run(Date.now(), null, 'pdf', 'docx', 500, 900, 0, 'Fichier illisible');
    ins.run(Date.now() - 400 * 86_400_000, null, 'odt', 'pdf', 1, 1, 1, null); // hors période
    const conv = (await call('GET', '/api/admin/conversions?days=30', null, support)).json;
    assert.equal(conv.totals.total, 3);
    assert.equal(conv.totals.ok, 2);
    assert.equal(conv.totals.avg_ms, 5000);
    assert.equal(conv.totals.bytes, 4500);
    assert.deepEqual(conv.by_type.find((t) => t.source_ext === 'docx'), { source_ext: 'docx', target: 'pdf', total: 2, failed: 0, avg_ms: 5000 });
    assert.equal(conv.top_errors[0].error, 'Fichier illisible');
    assert.equal(conv.recent.find((r) => r.ok === 1).email, 'lea@test.fr');

    // --- Consommation IA
    const ai = db.prepare('INSERT INTO ai_usage (ts, user_id, chars_in, chars_out, credits, provider, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    ai.run(Date.now(), user.user.id, 2000, 500, 1, 'openai', 1, null);
    ai.run(Date.now(), user.user.id, 3000, 700, 1, 'openai', 1, null);
    ai.run(Date.now(), user.user.id, 100, 0, 0, 'openai', 0, 'Quota dépassé');
    const usage = (await call('GET', '/api/admin/ai-usage?days=7', null, support)).json;
    assert.equal(usage.totals.requests, 3);
    assert.equal(usage.totals.ok, 2);
    assert.equal(usage.totals.credits, 2);
    assert.equal(usage.totals.chars_in, 5100);
    assert.equal(usage.top_users[0].email, 'lea@test.fr');
    assert.equal(usage.top_users[0].credits, 2);
    assert.equal(usage.top_errors[0].error, 'Quota dépassé');
    assert.equal(usage.credits_outstanding, 20);

    // --- Alertes : erreurs récentes et administrateurs sans double authentification signalés
    const alerts = (await call('GET', '/api/admin/alerts', null, support)).json.alerts;
    assert.ok(alerts.some((a) => a.code === 'errors' && a.level === 'warning'));
    assert.ok(alerts.some((a) => a.code === 'two_factor'));
    assert.ok(!alerts.some((a) => a.code === 'maintenance'));
    await call('PUT', '/api/admin/settings', { maintenance: true, ai: { enabled: true, provider: 'anthropic', base_url: '', api_key: '' } }, owner);
    const alerts2 = (await call('GET', '/api/admin/alerts', null, owner)).json.alerts;
    assert.ok(alerts2.some((a) => a.code === 'maintenance' && a.level === 'info'));
    assert.ok(alerts2.some((a) => a.code === 'ai_key'));
    assert.ok(alerts2.findIndex((a) => a.level === 'info') > alerts2.findIndex((a) => a.level === 'warning')); // triées par gravité
    for (let i = 0; i < 20; i++) logServerError(db, 'conversion', new Error('x'));
    assert.ok((await call('GET', '/api/admin/alerts', null, owner)).json.alerts.some((a) => a.code === 'errors' && a.level === 'critical'));

    // --- État de la machine
    const sys = (await call('GET', '/api/admin/system', null, owner)).json;
    assert.ok(sys.machine.mem_total_mb > 0 && sys.machine.cpus > 0);
    assert.ok(sys.machine.disk === null || sys.machine.disk.total_mb > 0);
    assert.equal(sys.counts.server_errors, 21);

    // Vider le journal : propriétaire uniquement
    assert.equal((await call('DELETE', '/api/admin/errors', null, owner)).json.deleted, 21);
  } finally {
    server.close();
  }
});

test('utilisateurs : fiche détaillée, historique des offres, actions groupées', async () => {
  const { server, call, db } = await boot();
  try {
    const owner = (await loginOwner(call)).json.token;
    const support = (await call('POST', '/api/admin/login', { email: 'support@test.fr', password: 'motdepasse-support' })).json.token;
    const ids = [];
    for (const n of ['a', 'b', 'c']) ids.push((await call('POST', '/api/auth/register', { email: `${n}@test.fr`, password: 'secret123', name: n.toUpperCase() })).json.user.id);

    // Historique : passage en Premium, changement d'échéance, retour au gratuit
    await call('PATCH', `/api/admin/users/${ids[0]}`, { plan: 'premium', premium_until: '2099-01-01', reason: 'Offert au lancement' }, owner);
    await call('PATCH', `/api/admin/users/${ids[0]}`, { premium_until: '2099-06-30' }, owner);
    await call('PATCH', `/api/admin/users/${ids[0]}`, { note: 'client fidèle' }, owner); // une note ne crée pas d'entrée
    await call('PATCH', `/api/admin/users/${ids[0]}`, { plan: 'free', premium_until: null }, owner);
    db.prepare("INSERT INTO events (ts, device_id, user_id, app_version, name, tool, ok) VALUES (?, 'tel1', ?, '1.0.0', 'tool_run', 'merge', 1)").run(Date.now(), ids[0]);
    const card = (await call('GET', `/api/admin/users/${ids[0]}`, null, support)).json;
    assert.equal(card.user.email, 'a@test.fr');
    assert.equal(card.plan_history.length, 3);
    assert.deepEqual(card.plan_history.map((h) => h.new_plan), ['free', 'premium', 'premium']);
    assert.equal(card.plan_history[2].reason, 'Offert au lancement');
    assert.equal(card.plan_history[2].actor, 'owner@test.fr');
    assert.equal(card.top_tools[0].tool, 'merge');
    assert.equal(card.devices[0].device_id, 'tel1');
    assert.equal((await call('GET', '/api/admin/users/inconnu', null, owner)).status, 404);

    // Premium arrivé à échéance : retour automatique au gratuit, inscrit à l'historique
    await call('PATCH', `/api/admin/users/${ids[1]}`, { plan: 'premium', premium_until: '2020-01-01' }, owner);
    const tokenB = (await call('POST', '/api/auth/login', { email: 'b@test.fr', password: 'secret123' })).json;
    assert.equal(tokenB.user.plan, 'free');
    const histB = (await call('GET', `/api/admin/users/${ids[1]}`, null, owner)).json.plan_history;
    assert.equal(histB[0].reason, 'Premium arrivé à échéance');
    assert.equal(histB[0].actor, null);

    // Actions groupées
    assert.equal((await call('POST', '/api/admin/users/bulk', { ids, action: 'ban' }, support)).status, 403);
    assert.equal((await call('POST', '/api/admin/users/bulk', { ids: [], action: 'ban' }, owner)).status, 400);
    assert.equal((await call('POST', '/api/admin/users/bulk', { ids, action: 'explose' }, owner)).status, 400);
    assert.equal((await call('POST', '/api/admin/users/bulk', { ids, action: 'premium', premium_until: '2099-12-31' }, owner)).json.updated, 3);
    assert.equal((await call('GET', '/api/admin/users?plan=premium', null, owner)).json.total, 3);
    assert.equal((await call('GET', `/api/admin/users/${ids[2]}`, null, owner)).json.plan_history[0].reason, 'Action groupée');
    assert.equal((await call('POST', '/api/admin/users/bulk', { ids: [ids[0], ids[1]], action: 'add_credits', credits: 50 }, owner)).json.updated, 2);
    const list = (await call('GET', '/api/admin/users', null, owner)).json.users;
    assert.equal(list.find((u) => u.id === ids[0]).ai_credits, 70);
    assert.equal(list.find((u) => u.id === ids[2]).ai_credits, 20);
    await call('POST', '/api/admin/users/bulk', { ids: [ids[2]], action: 'ban' }, owner);
    assert.equal((await call('POST', '/api/auth/login', { email: 'c@test.fr', password: 'secret123' })).status, 403);
    await call('POST', '/api/admin/users/bulk', { ids: [ids[2]], action: 'unban' }, owner);
    assert.equal((await call('POST', '/api/auth/login', { email: 'c@test.fr', password: 'secret123' })).status, 200);
    assert.equal((await call('POST', '/api/admin/users/bulk', { ids: [ids[1], 'inexistant'], action: 'delete' }, owner)).json.updated, 1);
    assert.equal((await call('GET', '/api/admin/users', null, owner)).json.total, 2);
    assert.ok((await call('GET', '/api/admin/audit', null, owner)).json.audit.some((a) => a.action === 'users.bulk_delete'));
  } finally {
    server.close();
  }
});
