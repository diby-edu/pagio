// Routes HTTP du serveur Pagio. Les routes /api/app, /api/auth, /api/me, /api/ai et /api/convert servent
// l'application Android ; les routes /api/admin servent le tableau de bord (rôles owner / admin / support).
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOL_IDS, getSettings, setSetting, protect, reveal, logServerError } from './db.js';
import {
  hashPassword, verifyPassword, signToken, verifyToken, rateLimiter,
  newTotpSecret, verifyTotp, totpUri, newRecoveryCodes, hashRecoveryCode,
} from './security.js';
import { aiComplete, convertWithLibreOffice, libreOfficeAvailable } from './services.js';
import { listBackups, createBackup, backupPath, restoreBackup, importBackup, verifyBackup } from './backup.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const ADMIN_SESSION_MS = 12 * HOUR;
const MAX_PARALLEL_CONVERSIONS = 2;
const today = () => new Date().toISOString().slice(0, 10);
const emailOk = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

/**
 * dataDir : dossier des données (sauvegardes dans dataDir/backups) ; sans lui, les sauvegardes sont indisponibles.
 * trustProxy : nombre de proxys de confiance devant le serveur (1 derrière Caddy/Nginx), pour connaître la vraie adresse IP.
 */
export function createApp({ db, secret, distDir, dataDir = null, trustProxy = false, startedAt = Date.now() }) {
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', trustProxy);
  const backupsDir = dataDir ? path.join(dataDir, 'backups') : null;
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    // Le tableau de bord n'exécute que ses propres scripts ; il peut appeler un serveur Pagio distant (connect-src).
    if (!req.path.startsWith('/api/')) res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src *; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use('/api', express.json({ limit: '2mb' }));

  const loginLimit = rateLimiter(10, 15 * 60_000);
  const registerLimit = rateLimiter(10, HOUR);
  const forgotLimit = rateLimiter(5, HOUR);
  const feedbackLimit = rateLimiter(10, HOUR);
  const eventsLimit = rateLimiter(120, 60_000);
  const convertLimit = rateLimiter(30, HOUR);
  let runningConversions = 0;
  const ok = (res, data = {}) => res.json(data);
  const fail = (res, status, error, extra = {}) => res.status(status).json({ error, ...extra });
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
      planChange(u.id, null, 'premium', 'free', null, 'Premium arrivé à échéance');
      u.plan = 'free';
    }
    return u;
  };

  /** Historique des offres : chaque passage Gratuit ↔ Premium ou changement d'échéance est conservé. */
  const planChange = (userId, actor, oldPlan, newPlan, until, reason) =>
    db.prepare('INSERT INTO plan_history (ts, user_id, actor, old_plan, new_plan, premium_until, reason) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(Date.now(), userId, actor ?? null, oldPlan, newPlan, until ?? null, reason ?? null);

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
      if (p?.kind !== 'admin' || !p.sid) return fail(res, 401, 'Session administrateur expirée');
      // Chaque jeton est lié à une session en base : la révoquer déconnecte immédiatement.
      const sess = db.prepare('SELECT * FROM admin_sessions WHERE id = ? AND admin_id = ? AND revoked = 0 AND expires_at > ?').get(p.sid, p.sub, Date.now());
      if (!sess) return fail(res, 401, 'Session administrateur expirée ou fermée');
      const a = db.prepare('SELECT * FROM admins WHERE id = ? AND active = 1').get(p.sub);
      if (!a) return fail(res, 401, 'Administrateur inconnu ou désactivé');
      if (ROLES[a.role] < ROLES[minRole]) return fail(res, 403, 'Droits insuffisants pour cette action');
      if (Date.now() - sess.last_seen > 60_000) db.prepare('UPDATE admin_sessions SET last_seen = ? WHERE id = ?').run(Date.now(), sess.id);
      req.admin = a;
      req.sessionId = sess.id;
      next();
    };
  }

  const publicAdmin = (a) => ({ id: a.id, email: a.email, name: a.name, role: a.role, totp_enabled: !!a.totp_enabled });
  const revokeSessions = (adminId, exceptId = null) =>
    Number(db.prepare('UPDATE admin_sessions SET revoked = 1 WHERE admin_id = ? AND revoked = 0 AND id != ?').run(adminId, exceptId ?? '').changes);
  // Clé d'IA : la variable d'environnement AI_API_KEY, si elle existe, remplace celle du tableau de bord.
  const aiConfig = (s) => (process.env.AI_API_KEY ? { ...s.ai, api_key: process.env.AI_API_KEY } : s.ai);

  /** Vérifie un code de double authentification (application ou code de secours) et le consomme. */
  function checkSecondFactor(a, code) {
    const clean = String(code || '').trim();
    if (!clean) return false;
    if (/^\d{6}$/.test(clean.replace(/\s/g, ''))) {
      let secretB32;
      try { secretB32 = reveal(db, a.totp_secret); } catch { return false; }
      const step = verifyTotp(secretB32, clean, a.totp_last_step);
      if (!step) return false;
      db.prepare('UPDATE admins SET totp_last_step = ? WHERE id = ?').run(step, a.id);
      return true;
    }
    let codes = [];
    try { codes = JSON.parse(a.recovery_codes || '[]'); } catch { /* aucun code de secours */ }
    const h = hashRecoveryCode(clean);
    if (!codes.includes(h)) return false;
    db.prepare('UPDATE admins SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(codes.filter((c) => c !== h)), a.id);
    audit(a, 'admin.recovery_code_used', a.email, { remaining: codes.length - 1 });
    return true;
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
      ai_enabled: !!(s.ai.enabled && (aiConfig(s).api_key || s.ai.base_url)),
      server_conversion: !!(s.conversion_enabled && libreOfficeAvailable()),
      registration_open: s.registration_open,
    });
  });

  app.post('/api/app/events', userAuth(false), (req, res) => {
    const { device_id, app_version, events } = req.body || {};
    if (!eventsLimit(`e:${req.ip}`)) return fail(res, 429, 'Trop de requêtes');
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
    if (!feedbackLimit(`f:${req.ip}`)) return fail(res, 429, 'Trop de messages envoyés. Réessayez dans une heure.');
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
    // Seules les créations effectives comptent : un robot ne peut pas créer des comptes en masse depuis une même adresse.
    const perHour = Number(s.limits.register_per_hour) || 0;
    if (perHour > 0 && !registerLimit(`r:${req.ip}`, perHour)) return fail(res, 429, 'Trop d\'inscriptions depuis cette connexion. Réessayez dans une heure.');
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
    if (!forgotLimit(`p:${req.ip}`)) return fail(res, 429, 'Trop de demandes. Réessayez dans une heure.');
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
      const text = await aiComplete(aiConfig(s), String(system).slice(0, 8000), clean, max_tokens);
      db.prepare('UPDATE users SET ai_credits = ai_credits - ? WHERE id = ?').run(cost, u.id);
      db.prepare('INSERT INTO ai_usage (ts, user_id, chars_in, chars_out, credits, provider, ok) VALUES (?, ?, ?, ?, ?, ?, 1)')
        .run(Date.now(), u.id, charsIn, text.length, cost, s.ai.provider);
      ok(res, { text, credits_left: u.ai_credits - cost });
    } catch (e) {
      db.prepare('INSERT INTO ai_usage (ts, user_id, chars_in, chars_out, credits, provider, ok, error) VALUES (?, ?, ?, 0, 0, ?, 0, ?)')
        .run(Date.now(), u.id, charsIn, s.ai.provider, String(e.message).slice(0, 500));
      logServerError(db, 'ia', e, { method: req.method, path: req.path, status: 502 });
      fail(res, 502, `Le fournisseur d'IA a refusé la demande : ${e.message}`);
    }
  });

  // ================================================================== Conversion haute fidélité

  // Contrôles faits AVANT de recevoir le fichier : service actif, compte exigé ou non, taille annoncée, quota horaire.
  const convertGuard = (req, res, next) => {
    const s = getSettings(db);
    if (!s.conversion_enabled) return fail(res, 503, 'Conversion serveur désactivée');
    const lim = s.limits;
    if (lim.convert_require_account && !req.user) return fail(res, 401, 'Connectez-vous à votre compte Pagio pour utiliser la conversion en ligne');
    const maxMb = Math.min(Number(lim.convert_max_mb) || 100, 100);
    req.convertMaxBytes = maxMb * 1048576;
    if (Number(req.headers['content-length']) > req.convertMaxBytes) return fail(res, 413, `Fichier trop volumineux pour la conversion en ligne (${maxMb} Mo maximum)`);
    const perHour = Number(req.user ? lim.convert_user_per_hour : lim.convert_anon_per_hour) || 0;
    if (perHour > 0 && !convertLimit(req.user ? `u:${req.user.id}` : `ip:${req.ip}`, perHour)) {
      return fail(res, 429, req.user ? 'Limite de conversions en ligne atteinte. Réessayez dans une heure.' : 'Limite de conversions atteinte. Connectez-vous à votre compte ou réessayez dans une heure.');
    }
    next();
  };

  app.post('/api/convert', userAuth(false), convertGuard, express.raw({ type: '*/*', limit: '100mb' }), async (req, res) => {
    const target = String(req.query.to || 'pdf');
    const name = String(req.query.name || 'document');
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return fail(res, 400, 'Fichier vide');
    if (req.body.length > req.convertMaxBytes) return fail(res, 413, 'Fichier trop volumineux pour la conversion en ligne');
    // LibreOffice est gourmand : au-delà de quelques conversions simultanées, on refuse plutôt que de saturer le serveur.
    if (runningConversions >= MAX_PARALLEL_CONVERSIONS) return fail(res, 503, 'Le serveur de conversion est occupé. Réessayez dans un instant.');
    runningConversions++;
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
      if (!e.status || e.status >= 500) logServerError(db, 'conversion', e, { method: req.method, path: req.path, status: e.status || 500 });
      fail(res, e.status || 500, e.message);
    } finally {
      runningConversions--;
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
    // Double authentification : le mot de passe est bon, il faut encore le code à 6 chiffres (ou un code de secours).
    if (a.totp_enabled) {
      if (!req.body?.code) return fail(res, 401, 'Saisissez le code de votre application d\'authentification', { totp_required: true });
      if (!checkSecondFactor(a, req.body.code)) {
        audit(a, 'admin.login_failed', a.email, { reason: 'code 2FA incorrect' });
        return fail(res, 401, 'Code de double authentification incorrect ou déjà utilisé', { totp_required: true });
      }
    }
    const now = Date.now();
    const sid = crypto.randomUUID();
    db.prepare('INSERT INTO admin_sessions (id, admin_id, created_at, last_seen, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(sid, a.id, now, now, now + ADMIN_SESSION_MS, String(req.ip || '').slice(0, 64), String(req.headers['user-agent'] || '').slice(0, 300));
    db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(now - 30 * DAY); // ménage des très anciennes sessions
    db.prepare('UPDATE admins SET last_login = ? WHERE id = ?').run(now, a.id);
    audit(a, 'admin.login', a.email);
    ok(res, { token: signToken({ kind: 'admin', sub: a.id, sid }, secret, ADMIN_SESSION_MS / 1000), admin: publicAdmin(a) });
  });

  app.post('/api/admin/logout', adminAuth(), (req, res) => {
    db.prepare('UPDATE admin_sessions SET revoked = 1 WHERE id = ?').run(req.sessionId);
    audit(req.admin, 'admin.logout', req.admin.email);
    ok(res, { ok: true });
  });

  app.get('/api/admin/me', adminAuth(), (req, res) => ok(res, { admin: publicAdmin(req.admin) }));

  app.post('/api/admin/me/password', adminAuth(), (req, res) => {
    const { current, next: nextPw } = req.body || {};
    if (!verifyPassword(String(current || ''), req.admin.password_hash)) return fail(res, 400, 'Mot de passe actuel incorrect');
    if (String(nextPw || '').length < 10) return fail(res, 400, 'Le nouveau mot de passe doit contenir au moins 10 caractères');
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(nextPw), req.admin.id);
    const closed = revokeSessions(req.admin.id, req.sessionId); // les autres appareils sont déconnectés
    audit(req.admin, 'admin.password_changed', req.admin.email, { sessions_closed: closed });
    ok(res, { ok: true, sessions_closed: closed });
  });

  // ------------------------------------------------------------- Double authentification
  // 1) setup : génère un secret (inactif) ; 2) enable : un premier code valide l'active et délivre les codes de secours.
  app.post('/api/admin/me/2fa/setup', adminAuth(), (req, res) => {
    if (req.admin.totp_enabled) return fail(res, 400, 'La double authentification est déjà active');
    if (!verifyPassword(String(req.body?.password || ''), req.admin.password_hash)) return fail(res, 400, 'Mot de passe incorrect');
    const secretB32 = newTotpSecret();
    db.prepare('UPDATE admins SET totp_secret = ?, totp_last_step = 0 WHERE id = ?').run(protect(db, secretB32), req.admin.id);
    ok(res, { secret: secretB32, uri: totpUri(secretB32, req.admin.email) });
  });

  app.post('/api/admin/me/2fa/enable', adminAuth(), (req, res) => {
    if (req.admin.totp_enabled) return fail(res, 400, 'La double authentification est déjà active');
    if (!req.admin.totp_secret) return fail(res, 400, 'Commencez par générer un secret');
    let secretB32;
    try { secretB32 = reveal(db, req.admin.totp_secret); } catch { return fail(res, 500, 'Secret illisible : recommencez l\'activation'); }
    const step = verifyTotp(secretB32, req.body?.code);
    if (!step) return fail(res, 400, 'Code incorrect. Vérifiez que l\'heure de votre téléphone est réglée automatiquement.');
    const codes = newRecoveryCodes();
    db.prepare('UPDATE admins SET totp_enabled = 1, totp_last_step = ?, recovery_codes = ? WHERE id = ?').run(step, JSON.stringify(codes.map(hashRecoveryCode)), req.admin.id);
    const closed = revokeSessions(req.admin.id, req.sessionId);
    audit(req.admin, 'admin.2fa_enabled', req.admin.email, { sessions_closed: closed });
    ok(res, { recovery_codes: codes });
  });

  app.post('/api/admin/me/2fa/disable', adminAuth(), (req, res) => {
    if (!req.admin.totp_enabled) return fail(res, 400, 'La double authentification n\'est pas active');
    if (!verifyPassword(String(req.body?.password || ''), req.admin.password_hash)) return fail(res, 400, 'Mot de passe incorrect');
    if (!checkSecondFactor(req.admin, req.body?.code)) return fail(res, 400, 'Code de double authentification incorrect');
    db.prepare('UPDATE admins SET totp_enabled = 0, totp_secret = NULL, totp_last_step = 0, recovery_codes = NULL WHERE id = ?').run(req.admin.id);
    audit(req.admin, 'admin.2fa_disabled', req.admin.email);
    ok(res, { ok: true });
  });

  // ------------------------------------------------------------- Sessions d'administration
  // Chacun voit et ferme ses propres sessions ; le propriétaire voit et ferme celles de toute l'équipe.
  app.get('/api/admin/sessions', adminAuth(), (req, res) => {
    const all = req.admin.role === 'owner';
    const rows = db.prepare(`SELECT s.id, s.admin_id, a.email, a.name, s.created_at, s.last_seen, s.expires_at, s.ip, s.user_agent
      FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.revoked = 0 AND s.expires_at > ? ${all ? '' : 'AND s.admin_id = ?'} ORDER BY s.last_seen DESC`).all(...(all ? [Date.now()] : [Date.now(), req.admin.id]));
    ok(res, { sessions: rows.map((r) => ({ ...r, current: r.id === req.sessionId })) });
  });

  app.delete('/api/admin/sessions/:id', adminAuth(), (req, res) => {
    const sess = db.prepare('SELECT s.*, a.email FROM admin_sessions s JOIN admins a ON a.id = s.admin_id WHERE s.id = ?').get(req.params.id);
    if (!sess) return fail(res, 404, 'Session introuvable');
    if (sess.admin_id !== req.admin.id && req.admin.role !== 'owner') return fail(res, 403, 'Vous ne pouvez fermer que vos propres sessions');
    db.prepare('UPDATE admin_sessions SET revoked = 1 WHERE id = ?').run(sess.id);
    audit(req.admin, 'admin.session_revoked', sess.email, { ip: sess.ip });
    ok(res, { ok: true, current: sess.id === req.sessionId });
  });

  app.post('/api/admin/sessions/revoke-others', adminAuth(), (req, res) => {
    const closed = revokeSessions(req.admin.id, req.sessionId);
    audit(req.admin, 'admin.sessions_revoked', req.admin.email, { sessions_closed: closed });
    ok(res, { closed });
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
    if (plan === 'premium') planChange(id, req.admin.email, 'free', 'premium', null, 'Compte créé en Premium');
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
    const newPlan = changes.plan ?? u.plan;
    const newUntil = 'premium_until' in changes ? changes.premium_until : u.premium_until;
    if (newPlan !== u.plan || newUntil !== u.premium_until) planChange(u.id, req.admin.email, u.plan, newPlan, newUntil, b.reason ? String(b.reason).slice(0, 200) : null);
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

  // Fiche complète d'un utilisateur : compte, historique des offres, activité, IA, conversions, messages au support.
  app.get('/api/admin/users/:id', adminAuth(), (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!u) return fail(res, 404, 'Utilisateur introuvable');
    const since30 = Date.now() - 30 * DAY;
    ok(res, {
      user: publicUser(u),
      reset_pending: !!(u.reset_token && u.reset_expires > Date.now()),
      plan_history: db.prepare('SELECT ts, actor, old_plan, new_plan, premium_until, reason FROM plan_history WHERE user_id = ? ORDER BY ts DESC LIMIT 100').all(u.id),
      events: db.prepare('SELECT ts, name, tool, ok, app_version FROM events WHERE user_id = ? ORDER BY ts DESC LIMIT 100').all(u.id),
      top_tools: db.prepare("SELECT tool, COUNT(*) runs, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) errors FROM events WHERE user_id = ? AND name = 'tool_run' AND tool IS NOT NULL GROUP BY tool ORDER BY runs DESC LIMIT 8").all(u.id),
      ai: db.prepare('SELECT ts, credits, chars_in, chars_out, provider, ok, error FROM ai_usage WHERE user_id = ? ORDER BY ts DESC LIMIT 50').all(u.id),
      ai_30d: db.prepare('SELECT COUNT(*) requests, COALESCE(SUM(credits), 0) credits FROM ai_usage WHERE user_id = ? AND ts >= ?').get(u.id, since30),
      conversions: db.prepare('SELECT ts, source_ext, target, bytes, ms, ok, error FROM conversions WHERE user_id = ? ORDER BY ts DESC LIMIT 50').all(u.id),
      feedback: db.prepare('SELECT id, ts, kind, message, status FROM feedback WHERE user_id = ? ORDER BY ts DESC LIMIT 20').all(u.id),
      devices: db.prepare('SELECT device_id, MAX(app_version) app_version, MAX(ts) last_ts FROM events WHERE user_id = ? AND device_id IS NOT NULL GROUP BY device_id ORDER BY last_ts DESC LIMIT 10').all(u.id),
    });
  });

  // Actions groupées sur une sélection d'utilisateurs (500 au plus par appel), en une seule transaction.
  app.post('/api/admin/users/bulk', adminAuth('admin'), (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(String))].slice(0, 500) : [];
    const action = String(req.body?.action || '');
    if (ids.length === 0) return fail(res, 400, 'Aucun utilisateur sélectionné');
    if (!['premium', 'free', 'ban', 'unban', 'add_credits', 'delete'].includes(action)) return fail(res, 400, 'Action inconnue');
    const until = req.body?.premium_until ? String(req.body.premium_until).slice(0, 10) : null;
    if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) return fail(res, 400, 'Date de fin invalide');
    const credits = Math.round(Number(req.body?.credits) || 0);
    if (action === 'add_credits' && credits === 0) return fail(res, 400, 'Indiquez un nombre de crédits');
    let done = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const id of ids) {
        const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        if (!u) continue;
        if (action === 'premium') {
          db.prepare("UPDATE users SET plan = 'premium', premium_until = ? WHERE id = ?").run(until, id);
          if (u.plan !== 'premium' || u.premium_until !== until) planChange(id, req.admin.email, u.plan, 'premium', until, 'Action groupée');
        } else if (action === 'free') {
          db.prepare("UPDATE users SET plan = 'free', premium_until = NULL WHERE id = ?").run(id);
          if (u.plan !== 'free') planChange(id, req.admin.email, u.plan, 'free', null, 'Action groupée');
        } else if (action === 'ban' || action === 'unban') {
          db.prepare('UPDATE users SET banned = ? WHERE id = ?').run(action === 'ban' ? 1 : 0, id);
        } else if (action === 'add_credits') {
          db.prepare('UPDATE users SET ai_credits = MAX(0, ai_credits + ?) WHERE id = ?').run(credits, id);
        } else if (action === 'delete') {
          db.prepare('DELETE FROM users WHERE id = ?').run(id);
          db.prepare('UPDATE events SET user_id = NULL WHERE user_id = ?').run(id);
        }
        done++;
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      logServerError(db, 'admin', e, { method: req.method, path: req.path, status: 500 });
      return fail(res, 500, `Action annulée, rien n'a été modifié : ${e.message}`);
    }
    audit(req.admin, `users.bulk_${action}`, null, { count: done, premium_until: until ?? undefined, credits: action === 'add_credits' ? credits : undefined });
    ok(res, { updated: done });
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
  // La clé n'est jamais renvoyée au navigateur : seuls ses 4 derniers caractères sont affichés.
  const masked = (s) => {
    const key = aiConfig(s).api_key;
    return { ...s, ai: { ...s.ai, api_key: key ? `••••${key.slice(-4)}` : '', has_key: !!key, key_from_env: !!process.env.AI_API_KEY, key_error: !!s.ai.key_error } };
  };
  const int = (v, min, max, fallback) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback; };

  app.get('/api/admin/settings', adminAuth(), (req, res) => ok(res, { settings: masked(getSettings(db)), libreoffice: libreOfficeAvailable() }));

  app.put('/api/admin/settings', adminAuth('admin'), (req, res) => {
    const b = req.body || {};
    const current = getSettings(db);
    const allowed = ['maintenance', 'maintenance_message', 'announcement', 'announcement_level', 'min_version_code', 'latest_version_name',
      'update_url', 'support_email', 'conversion_enabled', 'plans', 'ai', 'registration_open', 'limits', 'backup'];
    const changed = [];
    for (const k of allowed) {
      if (!(k in b)) continue;
      let v = b[k];
      if (k === 'limits') {
        const l = { ...current.limits, ...(v || {}) };
        v = {
          convert_require_account: !!l.convert_require_account,
          convert_anon_per_hour: int(l.convert_anon_per_hour, 0, 100000, current.limits.convert_anon_per_hour),
          convert_user_per_hour: int(l.convert_user_per_hour, 0, 100000, current.limits.convert_user_per_hour),
          convert_max_mb: int(l.convert_max_mb, 1, 100, current.limits.convert_max_mb),
          register_per_hour: int(l.register_per_hour, 0, 100000, current.limits.register_per_hour),
        };
      }
      if (k === 'backup') {
        const bk = { ...current.backup, ...(v || {}) };
        v = { enabled: !!bk.enabled, hour: int(bk.hour, 0, 23, current.backup.hour), keep_days: int(bk.keep_days, 1, 3650, current.backup.keep_days) };
      }
      if (k === 'ai') {
        v = { ...current.ai, ...v };
        delete v.has_key; delete v.key_from_env; delete v.key_error;
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
    try { ok(res, { text: (await aiComplete(aiConfig(s), 'Réponds en une phrase courte.', [{ role: 'user', content: 'Dis bonjour en français.' }], 40)).slice(0, 200) }); }
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
  app.get('/api/admin/admins', adminAuth('owner'), (req, res) => ok(res, { admins: db.prepare('SELECT id, email, name, role, active, created_at, last_login, totp_enabled FROM admins ORDER BY id').all() }));

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
    // Téléphone perdu : le propriétaire retire la double authentification d'un collègue, qui la réactivera ensuite.
    if (req.body?.reset_2fa) db.prepare('UPDATE admins SET totp_enabled = 0, totp_secret = NULL, totp_last_step = 0, recovery_codes = NULL WHERE id = ?').run(a.id);
    // Tout changement d'accès ferme les sessions ouvertes de la personne concernée.
    if (a.id !== req.admin.id && (req.body?.password || req.body?.reset_2fa || !active || role !== a.role)) revokeSessions(a.id);
    audit(req.admin, 'admin.update', a.email, { role, active: !!active, password: req.body?.password ? 'réinitialisé' : undefined, double_auth: req.body?.reset_2fa ? 'retirée' : undefined });
    ok(res, { ok: true });
  });

  // ------------------------------------------------------------- Sauvegardes
  // Créer et lister : administrateur. Télécharger, importer, supprimer, restaurer : propriétaire uniquement
  // (une sauvegarde contient tous les comptes).
  const needBackups = (req, res, next) => (backupsDir ? next() : fail(res, 501, 'Les sauvegardes ne sont pas disponibles sur ce serveur (dossier de données non configuré)'));

  app.get('/api/admin/backups', adminAuth('admin'), needBackups, (req, res) => {
    const s = getSettings(db);
    ok(res, { backups: listBackups(backupsDir), settings: s.backup, dir: backupsDir });
  });

  app.post('/api/admin/backups', adminAuth('admin'), needBackups, (req, res) => {
    try {
      const b = createBackup(db, backupsDir, 'manuelle');
      audit(req.admin, 'backup.create', b.name, { bytes: b.bytes });
      ok(res, { backup: b });
    } catch (e) { fail(res, 500, `Sauvegarde impossible : ${e.message}`); }
  });

  app.post('/api/admin/backups/import', adminAuth('owner'), needBackups, express.raw({ type: '*/*', limit: '500mb' }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return fail(res, 400, 'Fichier vide');
    try {
      const b = importBackup(backupsDir, req.body);
      audit(req.admin, 'backup.import', b.name, { bytes: b.bytes });
      ok(res, { backup: b });
    } catch (e) { fail(res, 400, e.message); }
  });

  app.get('/api/admin/backups/:name', adminAuth('owner'), needBackups, (req, res) => {
    const file = backupPath(backupsDir, req.params.name);
    if (!file) return fail(res, 404, 'Sauvegarde introuvable');
    audit(req.admin, 'backup.download', req.params.name);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}"`);
    res.send(fs.readFileSync(file));
  });

  app.delete('/api/admin/backups/:name', adminAuth('owner'), needBackups, (req, res) => {
    const file = backupPath(backupsDir, req.params.name);
    if (!file) return fail(res, 404, 'Sauvegarde introuvable');
    fs.rmSync(file, { force: true });
    audit(req.admin, 'backup.delete', req.params.name);
    ok(res, { deleted: true });
  });

  app.post('/api/admin/backups/:name/verify', adminAuth('admin'), needBackups, (req, res) => {
    const file = backupPath(backupsDir, req.params.name);
    if (!file) return fail(res, 404, 'Sauvegarde introuvable');
    try { ok(res, { ok: true, counts: verifyBackup(file) }); } catch (e) { fail(res, 400, e.message); }
  });

  // Restauration : mot de passe redemandé, sauvegarde de l'état actuel faite juste avant, opération tout ou rien.
  app.post('/api/admin/backups/:name/restore', adminAuth('owner'), needBackups, (req, res) => {
    const file = backupPath(backupsDir, req.params.name);
    if (!file) return fail(res, 404, 'Sauvegarde introuvable');
    if (!verifyPassword(String(req.body?.password || ''), req.admin.password_hash)) return fail(res, 400, 'Mot de passe incorrect');
    try {
      const safety = createBackup(db, backupsDir, 'avant-restauration');
      const counts = restoreBackup(db, file);
      audit(req.admin, 'backup.restore', req.params.name, { safety: safety.name, counts });
      ok(res, { restored: true, safety: safety.name, counts });
    } catch (e) { fail(res, 400, `Restauration impossible, rien n'a été modifié : ${e.message}`); }
  });

  // ------------------------------------------------------------- Surveillance : erreurs, conversions, IA
  const period = (req) => { const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365); return { days, since: Date.now() - days * DAY }; };
  const dayOf = "strftime('%Y-%m-%d', ts / 1000, 'unixepoch')";

  app.get('/api/admin/errors', adminAuth('admin'), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const source = req.query.source ? String(req.query.source) : null;
    const where = source ? 'WHERE source = ?' : '';
    const p = source ? [source] : [];
    ok(res, {
      total: db.prepare(`SELECT COUNT(*) n FROM server_errors ${where}`).get(...p).n,
      last_24h: db.prepare('SELECT COUNT(*) n FROM server_errors WHERE ts >= ?').get(Date.now() - DAY).n,
      by_source: db.prepare('SELECT source, COUNT(*) n, MAX(ts) last_ts FROM server_errors GROUP BY source ORDER BY n DESC').all(),
      errors: db.prepare(`SELECT * FROM server_errors ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`).all(...p, limit, offset),
    });
  });

  app.delete('/api/admin/errors', adminAuth('owner'), (req, res) => {
    const r = db.prepare('DELETE FROM server_errors').run();
    audit(req.admin, 'errors.clear', null, { deleted: Number(r.changes) });
    ok(res, { deleted: Number(r.changes) });
  });

  app.get('/api/admin/conversions', adminAuth(), (req, res) => {
    const { days, since } = period(req);
    ok(res, {
      days, libreoffice: libreOfficeAvailable(), running: runningConversions,
      totals: db.prepare('SELECT COUNT(*) total, COALESCE(SUM(ok), 0) ok, COALESCE(SUM(bytes), 0) bytes, COALESCE(ROUND(AVG(CASE WHEN ok = 1 THEN ms END)), 0) avg_ms, COALESCE(MAX(CASE WHEN ok = 1 THEN ms END), 0) max_ms FROM conversions WHERE ts >= ?').get(since),
      by_type: db.prepare("SELECT source_ext, target, COUNT(*) total, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) failed, ROUND(AVG(CASE WHEN ok = 1 THEN ms END)) avg_ms FROM conversions WHERE ts >= ? GROUP BY source_ext, target ORDER BY total DESC").all(since),
      daily: db.prepare(`SELECT ${dayOf} day, COUNT(*) total, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) failed FROM conversions WHERE ts >= ? GROUP BY day ORDER BY day`).all(since),
      top_errors: db.prepare('SELECT error, COUNT(*) n, MAX(ts) last_ts FROM conversions WHERE ok = 0 AND ts >= ? GROUP BY error ORDER BY n DESC LIMIT 10').all(since),
      recent: db.prepare('SELECT c.ts, c.source_ext, c.target, c.bytes, c.ms, c.ok, c.error, u.email FROM conversions c LEFT JOIN users u ON u.id = c.user_id WHERE c.ts >= ? ORDER BY c.ts DESC LIMIT 100').all(since),
    });
  });

  app.get('/api/admin/ai-usage', adminAuth(), (req, res) => {
    const { days, since } = period(req);
    const s = getSettings(db);
    ok(res, {
      days, enabled: !!s.ai.enabled, provider: s.ai.provider, model: s.ai.model, cost_per_request: s.ai.cost_per_request,
      totals: db.prepare('SELECT COUNT(*) requests, COALESCE(SUM(ok), 0) ok, COALESCE(SUM(credits), 0) credits, COALESCE(SUM(chars_in), 0) chars_in, COALESCE(SUM(chars_out), 0) chars_out, COUNT(DISTINCT user_id) users FROM ai_usage WHERE ts >= ?').get(since),
      daily: db.prepare(`SELECT ${dayOf} day, COUNT(*) requests, COALESCE(SUM(credits), 0) credits, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) failed FROM ai_usage WHERE ts >= ? GROUP BY day ORDER BY day`).all(since),
      top_users: db.prepare('SELECT a.user_id, u.email, u.plan, u.ai_credits credits_left, COUNT(*) requests, COALESCE(SUM(a.credits), 0) credits, COALESCE(SUM(a.chars_in), 0) chars_in FROM ai_usage a LEFT JOIN users u ON u.id = a.user_id WHERE a.ts >= ? GROUP BY a.user_id ORDER BY credits DESC, requests DESC LIMIT 20').all(since),
      top_errors: db.prepare('SELECT error, COUNT(*) n, MAX(ts) last_ts FROM ai_usage WHERE ok = 0 AND ts >= ? GROUP BY error ORDER BY n DESC LIMIT 10').all(since),
      credits_outstanding: db.prepare('SELECT COALESCE(SUM(ai_credits), 0) n FROM users').get().n,
      users_out_of_credits: db.prepare('SELECT COUNT(*) n FROM users WHERE ai_credits < ?').get(Math.max(1, Number(s.ai.cost_per_request) || 1)).n,
    });
  });

  // ------------------------------------------------------------- Système : état de la machine et alertes
  function machine() {
    let disk = null;
    try {
      const st = fs.statfsSync(dataDir || process.cwd());
      disk = { total_mb: Math.round((st.blocks * st.bsize) / 1048576), free_mb: Math.round((st.bavail * st.bsize) / 1048576) };
    } catch { /* indisponible sur ce système */ }
    return {
      disk, cpus: os.cpus().length, load: os.loadavg().map((n) => Math.round(n * 100) / 100), platform: `${os.type()} ${os.release()}`,
      mem_total_mb: Math.round(os.totalmem() / 1048576), mem_free_mb: Math.round(os.freemem() / 1048576),
    };
  }

  /** Points à surveiller, du plus grave au moins grave. `page` : page du tableau de bord où agir. */
  function alerts() {
    const s = getSettings(db);
    const m = machine();
    const out = [];
    const add = (level, code, message, page) => out.push({ level, code, message, page });
    const now = Date.now();
    if (m.disk && m.disk.total_mb > 0) {
      const pct = Math.round((m.disk.free_mb / m.disk.total_mb) * 100);
      if (pct < 10 || m.disk.free_mb < 500) add('critical', 'disk', `Disque presque plein : ${pct} % libre (${m.disk.free_mb} Mo). Le serveur s'arrêtera s'il est saturé.`, 'system');
      else if (pct < 20) add('warning', 'disk', `Espace disque faible : ${pct} % libre.`, 'system');
    }
    if (m.mem_total_mb > 0 && m.mem_free_mb / m.mem_total_mb < 0.08) add('warning', 'memory', `Mémoire presque saturée : ${m.mem_free_mb} Mo libres sur ${m.mem_total_mb} Mo.`, 'system');
    if (s.ai.key_error) add('critical', 'ai_key', "La clé d'IA ne peut plus être déchiffrée : saisissez-la de nouveau.", 'ai');
    else if (s.ai.enabled && !aiConfig(s).api_key && !s.ai.base_url) add('warning', 'ai_key', "L'IA est activée mais aucune clé d'API n'est enregistrée.", 'ai');
    if (backupsDir) {
      const lastAuto = listBackups(backupsDir).find((b) => b.kind === 'auto');
      if (!s.backup.enabled) add('warning', 'backup', 'La sauvegarde automatique est désactivée.', 'backups');
      else if (!lastAuto && now - startedAt > DAY) add('warning', 'backup', 'Aucune sauvegarde automatique n\'a encore été créée.', 'backups');
      else if (lastAuto && now - lastAuto.created_at > 36 * HOUR) add('warning', 'backup', `Dernière sauvegarde automatique il y a ${Math.round((now - lastAuto.created_at) / HOUR)} heures.`, 'backups');
    }
    if (s.conversion_enabled && !libreOfficeAvailable()) add('warning', 'libreoffice', 'La conversion en ligne est activée mais LibreOffice n\'est pas installé sur le serveur.', 'app');
    const errors24 = db.prepare('SELECT COUNT(*) n FROM server_errors WHERE ts >= ?').get(now - DAY).n;
    if (errors24 >= 20) add('critical', 'errors', `${errors24} erreurs du serveur sur les dernières 24 heures.`, 'errors');
    else if (errors24 > 0) add('warning', 'errors', `${errors24} erreur(s) du serveur sur les dernières 24 heures.`, 'errors');
    const conv = db.prepare('SELECT COUNT(*) total, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) failed FROM conversions WHERE ts >= ?').get(now - DAY);
    if (conv.total >= 5 && conv.failed / conv.total > 0.3) add('warning', 'conversions', `${conv.failed} conversions sur ${conv.total} ont échoué en 24 heures.`, 'conversions');
    const ai = db.prepare('SELECT COUNT(*) total, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) failed FROM ai_usage WHERE ts >= ?').get(now - DAY);
    if (ai.total >= 5 && ai.failed / ai.total > 0.3) add('warning', 'ai_failures', `${ai.failed} requêtes IA sur ${ai.total} ont échoué en 24 heures (clé, quota ou modèle à vérifier).`, 'aiusage');
    const no2fa = db.prepare("SELECT COUNT(*) n FROM admins WHERE active = 1 AND role IN ('owner', 'admin') AND totp_enabled = 0").get().n;
    if (no2fa > 0) add('warning', 'two_factor', `${no2fa} administrateur(s) sans double authentification.`, 'account');
    if (s.maintenance) add('info', 'maintenance', "Le mode maintenance est actif : l'application est bloquée pour les utilisateurs.", 'app');
    const open = db.prepare("SELECT COUNT(*) n FROM feedback WHERE status = 'nouveau'").get().n;
    if (open > 0) add('info', 'feedback', `${open} message(s) d'utilisateurs en attente de réponse.`, 'feedback');
    const rank = { critical: 0, warning: 1, info: 2 };
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  }

  app.get('/api/admin/alerts', adminAuth(), (req, res) => ok(res, { alerts: alerts() }));

  app.get('/api/admin/system', adminAuth('admin'), (req, res) => {
    const file = db.prepare('PRAGMA database_list').all()[0]?.file;
    ok(res, {
      node: process.version, uptime_s: Math.round((Date.now() - startedAt) / 1000),
      // Taille réelle : fichier principal + journal des écritures récentes (mode WAL).
      db_file: file, db_bytes: file ? [file, `${file}-wal`].reduce((n, f) => n + (fs.existsSync(f) ? fs.statSync(f).size : 0), 0) : 0,
      libreoffice: libreOfficeAvailable(), memory_mb: Math.round(process.memoryUsage().rss / 1048576),
      machine: machine(), alerts: alerts(),
      backups: backupsDir ? { count: listBackups(backupsDir).length, bytes: listBackups(backupsDir).reduce((n, b) => n + b.bytes, 0) } : null,
      counts: Object.fromEntries(['users', 'events', 'ai_usage', 'conversions', 'feedback', 'audit', 'server_errors'].map((t) => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n])),
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
    // index.html n'est jamais gardé en cache : sinon, après une mise à jour, le navigateur continue d'afficher
    // l'ancien tableau de bord. Les fichiers de assets/ portent une empreinte dans leur nom : cache long sans risque.
    app.use(express.static(distDir, {
      index: 'index.html',
      setHeaders: (res, file) => res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache'),
    }));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
  }

  app.use((err, req, res, _next) => {
    if (err?.type === 'entity.too.large') return fail(res, 413, 'Fichier trop volumineux');
    if (err?.type === 'entity.parse.failed') return fail(res, 400, 'Requête illisible (JSON invalide)');
    console.error(err);
    logServerError(db, 'serveur', err, { method: req.method, path: req.path, status: 500 });
    fail(res, 500, 'Erreur interne du serveur');
  });
  return app;
}
