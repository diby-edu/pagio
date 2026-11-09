// Tests de l'API (node --test) : base en mémoire, aucun réseau externe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { hashPassword } from '../src/security.js';
import { createApp } from '../src/app.js';

async function boot() {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO admins (email, name, password_hash, role, created_at) VALUES ('owner@test.fr', 'O', ?, 'owner', ?)").run(hashPassword('motdepasse-admin'), Date.now());
  db.prepare("INSERT INTO admins (email, name, password_hash, role, created_at) VALUES ('support@test.fr', 'S', ?, 'support', ?)").run(hashPassword('motdepasse-support'), Date.now());
  const server = createApp({ db, secret: 'test-secret' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  return { server, call };
}

test('parcours complet : config, inscription, administration, quotas, événements', async () => {
  const { server, call } = await boot();
  try {
    assert.equal((await call('GET', '/api/health')).json.ok, true);
    const cfg = await call('GET', '/api/app/config');
    assert.equal(cfg.json.tools.merge.enabled, true);
    assert.equal(cfg.json.maintenance, false);

    // Inscription / connexion
    assert.equal((await call('POST', '/api/auth/register', { email: 'bad', password: 'x' })).status, 400);
    const reg = await call('POST', '/api/auth/register', { email: 'Awa@Test.fr', password: 'secret123', name: 'Awa' });
    assert.equal(reg.status, 200);
    assert.equal(reg.json.user.email, 'awa@test.fr');
    assert.equal(reg.json.user.ai_credits, 20);
    assert.equal((await call('POST', '/api/auth/register', { email: 'awa@test.fr', password: 'secret123' })).status, 409);
    assert.equal((await call('POST', '/api/auth/login', { email: 'awa@test.fr', password: 'mauvais' })).status, 401);
    const login = await call('POST', '/api/auth/login', { email: 'awa@test.fr', password: 'secret123' });
    const userToken = login.json.token;
    assert.equal((await call('GET', '/api/me', null, userToken)).json.user.name, 'Awa');
    assert.equal((await call('GET', '/api/me')).status, 401);

    // Administration
    assert.equal((await call('POST', '/api/admin/login', { email: 'owner@test.fr', password: 'faux' })).status, 401);
    const admin = (await call('POST', '/api/admin/login', { email: 'owner@test.fr', password: 'motdepasse-admin' })).json.token;
    const support = (await call('POST', '/api/admin/login', { email: 'support@test.fr', password: 'motdepasse-support' })).json.token;
    assert.equal((await call('GET', '/api/admin/stats', null, userToken)).status, 401); // un jeton utilisateur n'ouvre pas l'admin

    // Outil désactivé + premium, visible dans la configuration publique
    assert.equal((await call('PUT', '/api/admin/tools/compress', { enabled: false }, support)).status, 403);
    await call('PUT', '/api/admin/tools/compress', { enabled: false }, admin);
    await call('PUT', '/api/admin/tools/ocr', { premium: true, max_mb: 20 }, admin);
    const cfg2 = (await call('GET', '/api/app/config')).json;
    assert.equal(cfg2.tools.compress.enabled, false);
    assert.equal(cfg2.tools.ocr.premium, true);
    assert.equal(cfg2.tools.ocr.max_mb, 20);

    // Quota quotidien
    await call('PUT', '/api/admin/settings', { plans: { free: { daily_tasks: 2 } }, announcement: 'Bienvenue !', min_version_code: 3 }, admin);
    assert.equal((await call('POST', '/api/me/tasks', { tool: 'merge' }, userToken)).status, 200);
    assert.equal((await call('POST', '/api/me/tasks', { tool: 'merge' }, userToken)).status, 200);
    assert.equal((await call('POST', '/api/me/tasks', { tool: 'merge' }, userToken)).status, 402);
    const cfg3 = (await call('GET', '/api/app/config')).json;
    assert.equal(cfg3.announcement, 'Bienvenue !');
    assert.equal(cfg3.min_version_code, 3);
    assert.equal(cfg3.plans.free.daily_tasks, 2);

    // Gestion des utilisateurs : Premium, crédits, suspension
    const list = (await call('GET', '/api/admin/users?q=awa', null, support)).json;
    assert.equal(list.total, 1);
    const id = list.users[0].id;
    assert.equal((await call('PATCH', `/api/admin/users/${id}`, { plan: 'premium' }, support)).status, 403);
    const upd = (await call('PATCH', `/api/admin/users/${id}`, { plan: 'premium', premium_until: '2099-12-31', add_credits: 100 }, admin)).json.user;
    assert.equal(upd.plan, 'premium');
    assert.equal(upd.ai_credits, 120);
    await call('PATCH', `/api/admin/users/${id}`, { banned: true }, admin);
    assert.equal((await call('GET', '/api/me', null, userToken)).status, 403);
    await call('PATCH', `/api/admin/users/${id}`, { banned: false }, admin);

    // IA désactivée par défaut
    assert.equal((await call('POST', '/api/ai/complete', { messages: [{ role: 'user', content: 'Bonjour' }] }, userToken)).status, 503);

    // Statistiques à partir des événements de l'application
    await call('POST', '/api/app/events', { device_id: 'dev1', app_version: '1.0.0', events: [
      { name: 'app_open', ts: Date.now() },
      { name: 'tool_run', ts: Date.now(), props: { tool: 'merge', ok: true } },
      { name: 'tool_run', ts: Date.now(), props: { tool: 'split', ok: false, error: 'CORRUPTED' } },
    ] }, userToken);
    const stats = (await call('GET', '/api/admin/stats?days=7', null, support)).json;
    assert.equal(stats.tasks_period, 2);
    assert.equal(stats.errors_period, 1);
    assert.equal(stats.users.premium, 1);
    assert.ok(stats.by_tool.find((t) => t.tool === 'split').errors === 1);

    // Avis, journal d'audit, administrateurs
    assert.equal((await call('POST', '/api/app/feedback', { kind: 'bug', message: 'Le bouton ne marche pas' })).status, 200);
    assert.equal((await call('GET', '/api/admin/feedback', null, support)).json.feedback.length, 1);
    const auditLog = (await call('GET', '/api/admin/audit', null, admin)).json.audit;
    assert.ok(auditLog.some((a) => a.action === 'tool.update'));
    assert.equal((await call('GET', '/api/admin/admins', null, support)).status, 403);
    assert.equal((await call('POST', '/api/admin/admins', { email: 'new@test.fr', password: 'tres-long-mdp', role: 'admin' }, admin)).status, 200);

    // Maintenance
    await call('PUT', '/api/admin/settings', { maintenance: true, maintenance_message: 'Retour à 14 h' }, admin);
    assert.equal((await call('GET', '/api/app/config')).json.maintenance_message, 'Retour à 14 h');

    // Clé d'IA jamais renvoyée en clair
    await call('PUT', '/api/admin/settings', { ai: { enabled: true, provider: 'openai', api_key: 'sk-secret-1234' } }, admin);
    const s = (await call('GET', '/api/admin/settings', null, admin)).json.settings;
    assert.equal(s.ai.api_key, '••••1234');
    await call('PUT', '/api/admin/settings', { ai: { model: 'autre', api_key: s.ai.api_key } }, admin);
    assert.equal((await call('GET', '/api/admin/settings', null, admin)).json.settings.ai.api_key, '••••1234'); // inchangée

    // Suppression du compte par l'utilisateur
    assert.equal((await call('DELETE', '/api/me', null, userToken)).status, 200);
    assert.equal((await call('GET', '/api/admin/users', null, admin)).json.total, 0);
  } finally {
    server.close();
  }
});
