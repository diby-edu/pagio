// Routes HTTP du serveur Pagio. Les routes /api/app, /api/auth, /api/me, /api/ai et /api/convert servent
// l'application Android ; les routes /api/admin servent le tableau de bord (rôles owner / admin / support).
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TOOL_IDS, getSettings, setSetting } from './db.js';
import { hashPassword, verifyPassword, signToken, verifyToken, rateLimiter } from './security.js';
import { aiComplete, convertWithLibreOffice, libreOfficeAvailable } from './services.js';

const DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);
const emailOk = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

export function createApp({ db, secret, distDir, startedAt = Date.now() }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use('/api', express.json({ limit: '2mb' }));

  const loginLimit = rateLimiter(10, 15 * 60_000);
  const ok = (res, data = {}) => res.json(data);
  const fail = (res, status, error) => res.status(status).json({ error });
  const audit = (admin, action, target, details) =>
    db.prepare('INSERT INTO audit (ts, admin_email, action, target, details) VALUES (?, ?, ?, ?, ?)')
      .run(Date.now(), admin?.email ?? null, action, target ?? null, details ? JSON.stringify(details) : null);

  const publicUser = (u) => ({
    id: u.id, email: u.email, name: u.name, plan: u.plan, premium_until: u.premium_until, ai_credits: u.ai_credits,
    tasks_today: u.tasks_day === today() ? u.tasks_count : 0, banned: !!u.banned, created_at: u.created_at, last_seen: u.last_seen,
    total_tasks: u.total_tasks, note: u.note,
  });

  // Premium expiré → retour automatique à l'offre gratuite.
  const effective = (u) => {
    if (u && u.plan === 'premium' && u.premium_until && u.premium_until < today()) {
      db.prepare("UPDATE users SET plan = 'free' WHERE id = ?").run(u.id);
      u.plan = 'free';
    }
    return u;
  };

  const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;

  function userAuth(required) {
    return (req, res, next) => {
      const p = verifyToken(bearer(req), secret);
      if (p?.kind === 'user') {
        const u = db.prepare('SELECT * FROM users WHERE id = ?').get(p.sub);
        if (u && !u.banned) {
          req.user = effective(u);
          db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), u.id);
        } else if (u?.banned) return fail(res, 403, 'Compte suspendu. Contactez le support.');
      }
      if (required && !req.user) return fail(res, 401, 'Connexion requise');
      next();
    };
  }

  const ROLES = { support: 1, admin: 2, owner: 3 };
  function adminAuth(minRole = 'support') {
    return (req, res, next) => {
      const p = verifyToken(bearer(req), secret);
      if (p?.kind !== 'admin') return fail(res, 401, 'Session administrateur expirée');
      const a = db.prepare('SELECT * FROM admins WHERE id = ? AND active = 1').get(p.sub);
      if (!a) return fail(res, 401, 'Administrateur inconnu ou désactivé');
      if (ROLES[a.role] < ROLES[minRole]) return fail(res, 403, 'Droits insuffisants pour cette action');
      req.admin = a;
      next();
    };
  }

  // ================================================================== Public / application

  app.get('/api/health', (req, res) => ok(res, { ok: true, version: '1.0.0', uptime_s: Math.round((Date.now() - startedAt) / 1000) }));

  app.get('/api/app/config', (req, res) => {
    const s = getSettings(db);
    const tools = {};
    for (const t of db.prepare('SELECT * FROM tools').all()) tools[t.id] = { enabled: !!t.enabled, premium: !!t.premium, max_files: t.max_files, max_mb: t.max_mb };
    ok(res, {
      maintenance: s.maintenance, maintenance_message: s.maintenance_message,
      announcement: s.announcement, announcement_level: s.announcement_level,
      min_version_code: s.min_version_code, latest_version_name: s.latest_version_name, update_url: s.update_url,
      tools, plans: s.plans, support_email: s.support_email,
      ai_enabled: !!(s.ai.enabled && (s.ai.api_key || s.ai.base_url)),
      server_conversion: !!(s.conversion_enabled && libreOfficeAvailable()),
      registration_open: s.registration_open,
    });
  });

  app.post('/api/app/events', userAuth(false), (req, res) => {
    const { device_id, app_version, events } = req.body || {};
    if (!Array.isArray(events)) return fail(res, 400, 'Format invalide');
    const ins = db.prepare('INSERT INTO events (ts, device_id, user_id, app_version, name, tool, ok, props) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const e of events.slice(0, 200)) {
      if (!e || typeof e.name !== 'string') continue;
      const props = e.props && typeof e.props === 'object' ? e.props : {};
      ins.run(Number(e.ts) || Date.now(), String(device_id || '').slice(0, 64), req.user?.id ?? null, String(app_version || '').slice(0, 32),
        e.name.slice(0, 48), props.tool ? String(props.tool).slice(0, 48) : (props.task ? String(props.task).slice(0, 48) : null),
        props.ok === undefined ? null : (props.ok ? 1 : 0), JSON.stringify(props).slice(0, 2000));
    }
    ok(res, { stored: Math.min(events.length, 200) });
  });

  app.post('/api/app/feedback', userAuth(false), (req, res) => {
    const { kind, message, email } = req.body || {};
    if (!message || String(message).trim().length < 5) return fail(res, 400, 'Message trop court');
    db.prepare('INSERT INTO feedback (ts, kind, message, email, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(Date.now(), String(kind || 'contact').slice(0, 20), String(message).slice(0, 5000), String(email || '').slice(0, 200), req.user?.id ?? null);
    ok(res, { message: 'Merci ! Votre message a bien été envoyé.' });
  });

  // ================================================================== Comptes utilisateurs

  app.post('/api/auth/register', (req, res) => {
    const s = getSettings(db);
    if (!s.registration_open) return fail(res, 403, 'Les inscriptions sont temporairement fermées.');
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!emailOk(email)) return fail(res, 400, 'Adresse e-mail invalide');
    if (password.length < 8) return fail(res, 400, 'Le mot de passe doit contenir au moins 8 caractères');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return fail(res, 409, 'Un compte existe déjà avec cette adresse');
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO users (id, email, name, password_hash, ai_credits, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, email, String(req.body?.name || '').slice(0, 80), hashPassword(password), s.plans.free.ai_credits || 0, Date.now());
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    ok(res, { token: signToken({ kind: 'user', sub: id }, secret, 90 * 86400), user: publicUser(u) });
  });

  app.post('/api/auth/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!loginLimit(`u:${req.ip}:${email}`)) return fail(res, 429, 'Trop de tentatives. Réessayez dans 15 minutes.');
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!u || !verifyPassword(String(req.body?.password || ''), u.password_hash)) return fail(res, 401, 'E-mail ou mot de passe incorrect');
    if (u.banned) return fail(res, 403, 'Compte suspendu. Contactez le support.');
    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), u.id);
    ok(res, { token: signToken({ kind: 'user', sub: u.id }, secret, 90 * 86400), user: publicUser(effective(u)) });
  });

  // Mot de passe oublié : un jeton de réinitialisation est créé ; l'administrateur (ou un service
  // d'e-mail branché ici) le transmet. La réponse est identique que l'adresse existe ou non.
  app.post('/api/auth/forgot', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const u = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (u) db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').run(crypto.randomBytes(24).toString('hex'), Date.now() + DAY, u.id);
    ok(res, { message: 'Si un compte existe pour cette adresse, une demande de réinitialisation a été enregistrée. Le support vous contactera.' });
  });

  app.get('/api/me', userAuth(true), (req, res) => ok(res, { user: publicUser(req.user) }));

  app.delete('/api/me', userAuth(true), (req, res) => {
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    db.prepare('UPDATE events SET user_id = NULL WHERE user_id = ?').run(req.user.id);
    ok(res, { deleted: true });
  });

  /** Décompte d'une tâche selon le quota quotidien de l'offre. */
  app.post('/api/me/tasks', userAuth(true), (req, res) => {
    const s = getSettings(db);
    const u = req.user;
    const limits = s.plans[u.plan] || s.plans.free;
    const count = u.tasks_day === today() ? u.tasks_count : 0;
    if (limits.daily_tasks > 0 && count >= limits.daily_tasks) return fail(res, 402, `Limite de ${limits.daily_tasks} tâches par jour atteinte`);
    db.prepare('UPDATE users SET tasks_day = ?, tasks_count = ?, total_tasks = total_tasks + 1 WHERE id = ?').run(today(), count + 1, u.id);
    ok(res, { tasks_today: count + 1, daily_limit: limits.daily_tasks });
  });

  // ================================================================== IA (proxy)

  app.post('/api/ai/complete', userAuth(true), async (req, res) => {
    const s = getSettings(db);
    if (!s.ai.enabled) return fail(res, 503, "L'IA du serveur est désactivée par l'administrateur");
    const cost = Math.max(0, Number(s.ai.cost_per_request) || 1);
    const u = req.user;
    if (u.ai_credits < cost) return fail(res, 402, 'Crédits IA épuisés. Contactez le support ou passez à Premium.');
    const { system = '', messages = [], max_tokens } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) return fail(res, 400, 'Requête vide');
    const clean = messages.slice(-30).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 120_000) }));
    const charsIn = clean.reduce((n, m) => n + m.content.length, 0) + String(system).length;
    try {
      const text = await aiComplete(s.ai, String(system).slice(0, 8000), clean, max_tokens);
      db.prepare('UPDATE users SET ai_credits = ai_credits - ? WHERE id = ?').run(cost, u.id);
      db.prepare('INSERT INTO ai_usage (ts, user_id, chars_in, chars_out, credits, provider, ok) VALUES (?, ?, ?, ?, ?, ?, 1)')
        .run(Date.now(), u.id, charsIn, text.length, cost, s.ai.provider);
      ok(res, { text, credits_left: u.ai_credits - cost });
    } catch (e) {
      db.prepare('INSERT INTO ai_usage (ts, user_id, chars_in, chars_out, credits, provider, ok, error) VALUES (?, ?, ?, 0, 0, ?, 0, ?)')
        .run(Date.now(), u.id, charsIn, s.ai.provider, String(e.message).slice(0, 500));
      fail(res, 502, `Le fournisseur d'IA a refusé la demande : ${e.message}`);
    }
  });

  // ================================================================== Conversion haute fidélité

  app.post('/api/convert', userAuth(false), express.raw({ type: '*/*', limit: '100mb' }), async (req, res) => {
    const s = getSettings(db);
    if (!s.conversion_enabled) return fail(res, 503, 'Conversion serveur désactivée');
    const target = String(req.query.to || 'pdf');
    const name = String(req.query.name || 'document');
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return fail(res, 400, 'Fichier vide');
    const t0 = Date.now();
    try {
      const out = await convertWithLibreOffice(req.body, name, target);
      db.prepare('INSERT INTO conversions (ts, user_id, source_ext, target, bytes, ms, ok) VALUES (?, ?, ?, ?, ?, ?, 1)')
        .run(Date.now(), req.user?.id ?? null, path.extname(name).slice(1, 10), target, req.body.length, Date.now() - t0);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(out);
    } catch (e) {
      db.prepare('INSERT INTO conversions (ts, user_id, source_ext, target, bytes, ms, ok, error) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
        .run(Date.now(), req.user?.id ?? null, path.extname(name).slice(1, 10), target, req.body.length, Date.now() - t0, String(e.message).slice(0, 500));
      fail(res, e.status || 500, e.message);
    }
  });

  // ================================================================== Administration

  app.post('/api/admin/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!loginLimit(`a:${req.ip}:${email}`)) return fail(res, 429, 'Trop de tentatives. Réessayez dans 15 minutes.');
    const a = db.prepare('SELECT * FROM admins WHERE email = ? AND active = 1').get(email);
    if (!a || !verifyPassword(String(req.body?.password || ''), a.password_hash)) {
      audit({ email }, 'admin.login_failed', email);
      return fail(res, 401, 'Identifiants administrateur incorrects');
    }
    db.prepare('UPDATE admins SET last_login = ? WHERE id = ?').run(Date.now(), a.id);
    audit(a, 'admin.login', a.email);
    ok(res, { token: signToken({ kind: 'admin', sub: a.id }, secret, 12 * 3600), admin: { id: a.id, email: a.email, name: a.name, role: a.role } });
  });

  app.get('/api/admin/me', adminAuth(), (req, res) => ok(res, { admin: { id: req.admin.id, email: req.admin.email, name: req.admin.name, role: req.admin.role } }));

  app.post('/api/admin/me/password', adminAuth(), (req, res) => {
    const { current, next: nextPw } = req.body || {};
    if (!verifyPassword(String(current || ''), req.admin.password_hash)) return fail(res, 400, 'Mot de passe actuel incorrect');
    if (String(nextPw || '').length < 10) return fail(res, 400, 'Le nouveau mot de passe doit contenir au moins 10 caractères');
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(nextPw), req.admin.id);
    audit(req.admin, 'admin.password_changed', req.admin.email);
    ok(res, { ok: true });
  });

  // ------------------------------------------------------------- Statistiques
  app.get('/api/admin/stats', adminAuth(), (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const since = Date.now() - days * DAY;
    const one = (sql, ...p) => db.prepare(sql).get(...p);
    const all = (sql, ...p) => db.prepare(sql).all(...p);
    const dayExpr = "strftime('%Y-%m-%d', ts / 1000, 'unixepoch')";
    ok(res, {
      days,
      users: {
        total: one('SELECT COUNT(*) n FROM users').n,
        premium: one("SELECT COUNT(*) n FROM users WHERE plan = 'premium'").n,
        banned: one('SELECT COUNT(*) n FROM users WHERE banned = 1').n,
        new_period: one('SELECT COUNT(*) n FROM users WHERE created_at >= ?', since).n,
        active_7d: one('SELECT COUNT(*) n FROM users WHERE last_seen >= ?', Date.now() - 7 * DAY).n,
      },
      devices_period: one('SELECT COUNT(DISTINCT device_id) n FROM events WHERE ts >= ?', since).n,
      tasks_period: one("SELECT COUNT(*) n FROM events WHERE name = 'tool_run' AND ts >= ?", since).n,
      errors_period: one("SELECT COUNT(*) n FROM events WHERE name = 'tool_run' AND ok = 0 AND ts >= ?", since).n,
      ai_requests_period: one('SELECT COUNT(*) n FROM ai_usage WHERE ts >= ?', since).n,
      ai_credits_period: one('SELECT COALESCE(SUM(credits), 0) n FROM ai_usage WHERE ts >= ?', since).n,
      conversions_period: one('SELECT COUNT(*) n FROM conversions WHERE ts >= ?', since).n,
      feedback_open: one("SELECT COUNT(*) n FROM feedback WHERE status = 'nouveau'").n,
      by_tool: all("SELECT tool, COUNT(*) runs, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) errors FROM events WHERE name = 'tool_run' AND ts >= ? AND tool IS NOT NULL GROUP BY tool ORDER BY runs DESC", since),
      daily: all(`SELECT ${dayExpr} day, COUNT(*) events, COUNT(DISTINCT device_id) devices, SUM(CASE WHEN name = 'tool_run' THEN 1 ELSE 0 END) tasks FROM events WHERE ts >= ? GROUP BY day ORDER BY day`, since),
      signups: all("SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') day, COUNT(*) n FROM users WHERE created_at >= ? GROUP BY day ORDER BY day", since),
      versions: all('SELECT app_version, COUNT(DISTINCT device_id) devices FROM events WHERE ts >= ? GROUP BY app_version ORDER BY devices DESC LIMIT 10', since),
      top_errors: all("SELECT tool, json_extract(props, '$.error') error, COUNT(*) n FROM events WHERE name = 'tool_run' AND ok = 0 AND ts >= ? GROUP BY tool, error ORDER BY n DESC LIMIT 10", since),
    });
  });

  // ------------------------------------------------------------- Utilisateurs
  app.get('/api/admin/users', adminAuth(), (req, res) => {
    const q = `%${String(req.query.q || '').toLowerCase()}%`;
    const plan = req.query.plan ? String(req.query.plan) : null;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const where = 'WHERE (lower(email) LIKE ? OR lower(name) LIKE ?)' + (plan ? ' AND plan = ?' : '');
    const params = plan ? [q, q, plan] : [q, q];
    const total = db.prepare(`SELECT COUNT(*) n FROM users ${where}`).get(...params).n;
    const rows = db.prepare(`SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    ok(res, { total, users: rows.map(publicUser) });
  });

  app.post('/api/admin/users', adminAuth('admin'), (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!emailOk(email)) return fail(res, 400, 'Adresse e-mail invalide');
    if (password.length < 8) return fail(res, 400, 'Mot de passe : 8 caractères minimum');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return fail(res, 409, 'Adresse déjà utilisée');
    const id = crypto.randomUUID();
    const s = getSettings(db);
    const plan = req.body?.plan === 'premium' ? 'premium' : 'free';
    db.prepare('INSERT INTO users (id, email, name, password_hash, plan, ai_credits, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, email, String(req.body?.name || '').slice(0, 80), hashPassword(password), plan, s.plans[plan].ai_credits || 0, Date.now());
    audit(req.admin, 'user.create', email, { plan });
    ok(res, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
  });

  app.patch('/api/admin/users/:id', adminAuth('support'), (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!u) return fail(res, 404, 'Utilisateur introuvable');
    const b = req.body || {};
    const changes = {};
    const sensitive = ['plan', 'premium_until', 'ai_credits', 'add_credits', 'banned', 'password'].some((k) => k in b);
    if (sensitive && ROLES[req.admin.role] < ROLES.admin) return fail(res, 403, "Le rôle support ne peut modifier que la note d'un utilisateur");
    if (b.plan === 'free' || b.plan === 'premium') changes.plan = b.plan;
    if ('premium_until' in b) changes.premium_until = b.premium_until ? String(b.premium_until).slice(0, 10) : null;
    if ('ai_credits' in b) changes.ai_credits = Math.max(0, Math.round(Number(b.ai_credits) || 0));
    if ('add_credits' in b) changes.ai_credits = Math.max(0, u.ai_credits + Math.round(Number(b.add_credits) || 0));
    if ('banned' in b) changes.banned = b.banned ? 1 : 0;
    if ('name' in b) changes.name = String(b.name).slice(0, 80);
    if ('note' in b) changes.note = String(b.note).slice(0, 2000);
    if (b.password) {
      if (String(b.password).length < 8) return fail(res, 400, 'Mot de passe : 8 caractères minimum');
      changes.password_hash = hashPassword(String(b.password));
    }
    const keys = Object.keys(changes);
    if (keys.length === 0) return fail(res, 400, 'Aucune modification');
    db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => changes[k]), u.id);
    const logged = { ...changes }; if (logged.password_hash) { delete logged.password_hash; logged.password = 'réinitialisé'; }
    audit(req.admin, 'user.update', u.email, logged);
    ok(res, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
  });

  app.delete('/api/admin/users/:id', adminAuth('admin'), (req, res) => {
    const u = db.prepare('SELECT email FROM users WHERE id = ?').get(req.params.id);
    if (!u) return fail(res, 404, 'Utilisateur introuvable');
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    audit(req.admin, 'user.delete', u.email);
    ok(res, { deleted: true });
  });

  app.get('/api/admin/users/:id/activity', adminAuth(), (req, res) => {
    ok(res, {
      events: db.prepare('SELECT ts, name, tool, ok, app_version FROM events WHERE user_id = ? ORDER BY ts DESC LIMIT 100').all(req.params.id),
      ai: db.prepare('SELECT ts, credits, ok, error FROM ai_usage WHERE user_id = ? ORDER BY ts DESC LIMIT 50').all(req.params.id),
    });
  });

  app.post('/api/admin/credits/refill', adminAuth('admin'), (req, res) => {
    const s = getSettings(db);
    const r1 = db.prepare("UPDATE users SET ai_credits = MAX(ai_credits, ?) WHERE plan = 'free'").run(s.plans.free.ai_credits || 0);
    const r2 = db.prepare("UPDATE users SET ai_credits = MAX(ai_credits, ?) WHERE plan = 'premium'").run(s.plans.premium.ai_credits || 0);
    audit(req.admin, 'credits.refill', null, { free: r1.changes, premium: r2.changes });
    ok(res, { updated: Number(r1.changes) + Number(r2.changes) });
  });

  // ------------------------------------------------------------- Outils
  app.get('/api/admin/tools', adminAuth(), (req, res) => {
    const since = Date.now() - 30 * DAY;
    const usage = Object.fromEntries(db.prepare("SELECT tool, COUNT(*) n FROM events WHERE name = 'tool_run' AND ts >= ? GROUP BY tool").all(since).map((r) => [r.tool, r.n]));
    ok(res, { tools: db.prepare('SELECT * FROM tools').all().sort((a, b) => TOOL_IDS.indexOf(a.id) - TOOL_IDS.indexOf(b.id))
      .map((t) => ({ ...t, enabled: !!t.enabled, premium: !!t.premium, runs_30d: usage[t.id] || 0 })) });
  });

  app.put('/api/admin/tools/:id', adminAuth('admin'), (req, res) => {
    const t = db.prepare('SELECT * FROM tools WHERE id = ?').get(req.params.id);
    if (!t) return fail(res, 404, 'Outil inconnu');
    const b = req.body || {};
    const next = {
      enabled: 'enabled' in b ? (b.enabled ? 1 : 0) : t.enabled,
      premium: 'premium' in b ? (b.premium ? 1 : 0) : t.premium,
      max_files: 'max_files' in b ? Math.max(0, Number(b.max_files) || 0) : t.max_files,
      max_mb: 'max_mb' in b ? Math.max(0, Number(b.max_mb) || 0) : t.max_mb,
    };
    db.prepare('UPDATE tools SET enabled = ?, premium = ?, max_files = ?, max_mb = ? WHERE id = ?').run(next.enabled, next.premium, next.max_files, next.max_mb, t.id);
    audit(req.admin, 'tool.update', t.id, next);
    ok(res, { tool: { id: t.id, ...next, enabled: !!next.enabled, premium: !!next.premium } });
  });

  // ------------------------------------------------------------- Réglages de l'application
  const masked = (s) => ({ ...s, ai: { ...s.ai, api_key: s.ai.api_key ? `••••${s.ai.api_key.slice(-4)}` : '', has_key: !!s.ai.api_key } });

  app.get('/api/admin/settings', adminAuth(), (req, res) => ok(res, { settings: masked(getSettings(db)), libreoffice: libreOfficeAvailable() }));

  app.put('/api/admin/settings', adminAuth('admin'), (req, res) => {
    const b = req.body || {};
    const current = getSettings(db);
    const allowed = ['maintenance', 'maintenance_message', 'announcement', 'announcement_level', 'min_version_code', 'latest_version_name',
      'update_url', 'support_email', 'conversion_enabled', 'plans', 'ai', 'registration_open'];
    const changed = [];
    for (const k of allowed) {
      if (!(k in b)) continue;
      let v = b[k];
      if (k === 'ai') {
        v = { ...current.ai, ...v };
        delete v.has_key;
        if (typeof b.ai.api_key !== 'string' || b.ai.api_key.startsWith('••••')) v.api_key = current.ai.api_key; // clé inchangée
        if (!['openai', 'anthropic', 'gemini'].includes(v.provider)) return fail(res, 400, 'Fournisseur IA inconnu');
      }
      if (k === 'plans') v = { free: { ...current.plans.free, ...(v.free || {}) }, premium: { ...current.plans.premium, ...(v.premium || {}) } };
      if (k === 'min_version_code') v = Math.max(0, Number(v) || 0);
      setSetting(db, k, v);
      changed.push(k);
    }
    audit(req.admin, 'settings.update', changed.join(','), Object.fromEntries(changed.filter((k) => k !== 'ai').map((k) => [k, b[k]])));
    ok(res, { settings: masked(getSettings(db)) });
  });

  app.post('/api/admin/ai/test', adminAuth('admin'), async (req, res) => {
    const s = getSettings(db);
    try { ok(res, { text: (await aiComplete(s.ai, 'Réponds en une phrase courte.', [{ role: 'user', content: 'Dis bonjour en français.' }], 40)).slice(0, 200) }); }
    catch (e) { fail(res, 502, e.message); }
  });

  // ------------------------------------------------------------- Événements, avis, journal
  app.get('/api/admin/events', adminAuth(), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const name = req.query.name ? String(req.query.name) : null;
    const onlyErrors = req.query.errors === '1';
    const conds = []; const p = [];
    if (name) { conds.push('name = ?'); p.push(name); }
    if (onlyErrors) conds.push('ok = 0');
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    ok(res, {
      total: db.prepare(`SELECT COUNT(*) n FROM events ${where}`).get(...p).n,
      events: db.prepare(`SELECT * FROM events ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`).all(...p, limit, offset),
    });
  });

  app.get('/api/admin/feedback', adminAuth(), (req, res) => ok(res, { feedback: db.prepare('SELECT * FROM feedback ORDER BY ts DESC LIMIT 300').all() }));
  app.patch('/api/admin/feedback/:id', adminAuth(), (req, res) => {
    const status = ['nouveau', 'en cours', 'traité'].includes(req.body?.status) ? req.body.status : null;
    if (!status) return fail(res, 400, 'Statut invalide');
    db.prepare('UPDATE feedback SET status = ? WHERE id = ?').run(status, Number(req.params.id));
    audit(req.admin, 'feedback.status', String(req.params.id), { status });
    ok(res, { ok: true });
  });

  app.get('/api/admin/audit', adminAuth('admin'), (req, res) => ok(res, { audit: db.prepare('SELECT * FROM audit ORDER BY ts DESC LIMIT 500').all() }));

  app.get('/api/admin/resets', adminAuth('support'), (req, res) => ok(res, {
    resets: db.prepare('SELECT id, email, reset_expires FROM users WHERE reset_token IS NOT NULL AND reset_expires > ? ORDER BY reset_expires DESC').all(Date.now()),
  }));

  // ------------------------------------------------------------- Administrateurs
  app.get('/api/admin/admins', adminAuth('owner'), (req, res) => ok(res, { admins: db.prepare('SELECT id, email, name, role, active, created_at, last_login FROM admins ORDER BY id').all() }));

  app.post('/api/admin/admins', adminAuth('owner'), (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const role = ['owner', 'admin', 'support'].includes(req.body?.role) ? req.body.role : 'support';
    if (!emailOk(email)) return fail(res, 400, 'Adresse e-mail invalide');
    if (String(req.body?.password || '').length < 10) return fail(res, 400, 'Mot de passe : 10 caractères minimum');
    if (db.prepare('SELECT 1 FROM admins WHERE email = ?').get(email)) return fail(res, 409, 'Administrateur déjà existant');
    db.prepare('INSERT INTO admins (email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(email, String(req.body?.name || '').slice(0, 80), hashPassword(String(req.body.password)), role, Date.now());
    audit(req.admin, 'admin.create', email, { role });
    ok(res, { ok: true });
  });

  app.patch('/api/admin/admins/:id', adminAuth('owner'), (req, res) => {
    const a = db.prepare('SELECT * FROM admins WHERE id = ?').get(Number(req.params.id));
    if (!a) return fail(res, 404, 'Administrateur introuvable');
    if (a.id === req.admin.id && (req.body?.active === false || (req.body?.role && req.body.role !== 'owner'))) return fail(res, 400, 'Vous ne pouvez pas vous retirer vos propres droits');
    const role = ['owner', 'admin', 'support'].includes(req.body?.role) ? req.body.role : a.role;
    const active = 'active' in (req.body || {}) ? (req.body.active ? 1 : 0) : a.active;
    db.prepare('UPDATE admins SET role = ?, active = ? WHERE id = ?').run(role, active, a.id);
    if (req.body?.password) {
      if (String(req.body.password).length < 10) return fail(res, 400, 'Mot de passe : 10 caractères minimum');
      db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(String(req.body.password)), a.id);
    }
    audit(req.admin, 'admin.update', a.email, { role, active: !!active, password: req.body?.password ? 'réinitialisé' : undefined });
    ok(res, { ok: true });
  });

  // ------------------------------------------------------------- Système
  app.get('/api/admin/system', adminAuth('admin'), (req, res) => {
    const file = db.prepare('PRAGMA database_list').all()[0]?.file;
    ok(res, {
      node: process.version, uptime_s: Math.round((Date.now() - startedAt) / 1000),
      db_file: file, db_bytes: file && fs.existsSync(file) ? fs.statSync(file).size : 0,
      libreoffice: libreOfficeAvailable(), memory_mb: Math.round(process.memoryUsage().rss / 1048576),
      counts: Object.fromEntries(['users', 'events', 'ai_usage', 'conversions', 'feedback', 'audit'].map((t) => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n])),
    });
  });

  app.post('/api/admin/system/purge-events', adminAuth('owner'), (req, res) => {
    const days = Math.max(Number(req.body?.older_than_days) || 180, 7);
    const r = db.prepare('DELETE FROM events WHERE ts < ?').run(Date.now() - days * DAY);
    audit(req.admin, 'events.purge', null, { older_than_days: days, deleted: Number(r.changes) });
    ok(res, { deleted: Number(r.changes) });
  });

  app.get('/api/admin/export/users.csv', adminAuth('admin'), (req, res) => {
    const rows = db.prepare('SELECT id, email, name, plan, premium_until, ai_credits, banned, created_at, last_seen, total_tasks FROM users ORDER BY created_at').all();
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['id;email;nom;offre;premium_jusqu_au;credits_ia;suspendu;cree_le;vu_le;taches']
      .concat(rows.map((r) => [r.id, r.email, r.name, r.plan, r.premium_until, r.ai_credits, r.banned, new Date(r.created_at).toISOString(), r.last_seen ? new Date(r.last_seen).toISOString() : '', r.total_tasks].map(esc).join(';')))
      .join('\n');
    audit(req.admin, 'users.export', null, { count: rows.length });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="utilisateurs-pagio.csv"');
    res.send('﻿' + csv);
  });

  app.use('/api', (req, res) => fail(res, 404, 'Route inconnue'));

  // Tableau de bord (fichiers statiques construits par Vite).
  if (distDir && fs.existsSync(distDir)) {
    app.use(express.static(distDir, { index: 'index.html', maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
  }

  app.use((err, req, res, _next) => {
    if (err?.type === 'entity.too.large') return fail(res, 413, 'Fichier trop volumineux');
    console.error(err);
    fail(res, 500, 'Erreur interne du serveur');
  });
  return app;
}
