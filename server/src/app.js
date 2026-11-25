// Routes HTTP du serveur Pagio. Les routes /api/app, /api/auth, /api/me, /api/ai et /api/convert servent
// l'application Android ; les routes /api/admin servent le tableau de bord (rôles owner / admin / support).
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOL_IDS, OFFER_DAYS, PAYMENT_METHODS, getSettings, setSetting, protect, reveal, logServerError } from './db.js';
import {
  hashPassword, verifyPassword, signToken, verifyToken, rateLimiter,
  hashPasswordAsync, verifyPasswordAsync, verifyAgainstNothing,
  newTotpSecret, verifyTotp, totpUri, newRecoveryCodes, hashRecoveryCode,
} from './security.js';
import { aiComplete, convertWithLibreOffice, libreOfficeAvailable, pdfTool, PDF_OPS } from './services.js';
import { listBackups, createBackup, backupPath, restoreBackup, importBackup, verifyBackup } from './backup.js';
import { verifyGoogleToken } from './google.js';
import { visitorId, isBot, parseUA, classifySource, countryOf } from './sitestats.js';
import { NOTIFY_KINDS, parsePrefs, cleanPrefs, wants, isQuietHour, parseFirebaseJson, fcmTokenSource, fcmSend } from './notify.js';
import { sendWithBrevo, pingBrevo, messages, newToken, hashToken, resetForm, messagePage, page } from './mail.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const ADMIN_SESSION_MS = 12 * HOUR;
const MAX_PARALLEL_CONVERSIONS = 2;
const today = () => new Date().toISOString().slice(0, 10);
const emailOk = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

/**
 * dataDir : dossier des données (sauvegardes dans dataDir/backups) ; sans lui, les sauvegardes sont indisponibles.
 * trustProxy : nombre de proxys de confiance devant le serveur (1 derrière Caddy/Nginx), pour connaître la vraie adresse IP.
 * sendMail : fonction d'envoi des e-mails (Brevo par défaut ; remplacée dans les tests).
 */
export function createApp({ db, secret, distDir, dataDir = null, trustProxy = false, startedAt = Date.now(), sendMail = sendWithBrevo, checkMailKey = pingBrevo, verifyGoogle = verifyGoogleToken, campaignDelayMs = 300, pushFetch = fetch }) {
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
  // Adresses IP bloquées depuis le tableau de bord (Sécurité) : API publiques refusées. L'administration n'est jamais bloquée.
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/admin')) return next();
    const list = getSettings(db).blocked_ips;
    if (!list?.length) return next();
    const ip = String(req.ip || '').replace(/^::ffff:/, '');
    const blocked = list.some((b) => (b.endsWith('.x') ? ip.startsWith(b.slice(0, -1)) : b.endsWith('::x') ? ip.startsWith(b.slice(0, -1)) : ip === b));
    return blocked ? res.status(403).json({ error: 'Accès refusé' }) : next();
  });

  const loginLimit = rateLimiter(10, 15 * 60_000);
  // Limite par adresse IP, tous comptes confondus : empêche d'essayer un mot de passe courant sur des milliers de comptes.
  const loginIpLimit = rateLimiter(40, 15 * 60_000);
  const registerLimit = rateLimiter(10, HOUR);
  const forgotLimit = rateLimiter(5, HOUR);
  const resetLimit = rateLimiter(20, HOUR);
  const resendLimit = rateLimiter(3, HOUR);
  const feedbackLimit = rateLimiter(10, HOUR);
  const eventsLimit = rateLimiter(120, 60_000);
  const convertLimit = rateLimiter(30, HOUR);
  let runningConversions = 0;
  // File d'attente des traitements lourds (conversions, outils PDF du serveur) : au plus MAX_PARALLEL_CONVERSIONS à la
  // fois ; les comptes Premium passent devant les comptes gratuits. Au-delà de MAX_WAITING, on refuse poliment.
  const MAX_WAITING = 30;
  const waiting = [];
  const queueStats = { served: 0, waited_ms: 0, refused: 0 };
  const takeSlot = (premium) => new Promise((resolve, reject) => {
    if (runningConversions < MAX_PARALLEL_CONVERSIONS && waiting.length === 0) { runningConversions++; return resolve(0); }
    if (waiting.length >= MAX_WAITING) { queueStats.refused++; return reject(Object.assign(new Error('Le serveur est très demandé. Réessayez dans une minute.'), { status: 503 })); }
    const job = { premium, at: Date.now(), resolve, reject };
    // Premium : placé après les autres Premium déjà en attente, mais avant tous les gratuits.
    const i = premium ? waiting.findIndex((w) => !w.premium) : -1;
    if (i < 0) waiting.push(job); else waiting.splice(i, 0, job);
    job.timer = setTimeout(() => {
      const k = waiting.indexOf(job);
      if (k >= 0) { waiting.splice(k, 1); queueStats.refused++; reject(Object.assign(new Error("Trop d'attente : réessayez dans un instant."), { status: 503 })); }
    }, 120_000);
  });
  const releaseSlot = () => {
    const next = waiting.shift();
    if (next) { clearTimeout(next.timer); queueStats.waited_ms += Date.now() - next.at; next.resolve(Date.now() - next.at); }
    else runningConversions--;
  };
  const ok = (res, data = {}) => res.json(data);
  const fail = (res, status, error, extra = {}) => res.status(status).json({ error, ...extra });
  const audit = (admin, action, target, details) =>
    db.prepare('INSERT INTO audit (ts, admin_email, action, target, details) VALUES (?, ?, ?, ?, ?)')
      .run(Date.now(), admin?.email ?? null, action, target ?? null, details ? JSON.stringify(details) : null);

  const publicUser = (u) => ({
    id: u.id, email: u.email, name: u.name, plan: u.plan, premium_until: u.premium_until, ai_credits: u.ai_credits,
    tasks_today: u.tasks_day === today() ? u.tasks_count : 0, banned: !!u.banned, created_at: u.created_at, last_seen: u.last_seen,
    total_tasks: u.total_tasks, note: u.note, email_verified: !!u.email_verified,
  });
  /** Ce que l'utilisateur voit de son propre compte : sans la note interne de l'administrateur, ni l'état de suspension. */
  const selfUser = (u) => { const { note: _note, banned: _banned, ...rest } = publicUser(u); return rest; };

  // Premium expiré → retour automatique à l'offre gratuite.
  // Premium actif : les crédits IA inclus sont remis à niveau une fois par mois (jamais diminués).
  const effective = (u) => {
    if (u && u.plan === 'premium' && u.premium_until && u.premium_until < today()) {
      db.prepare("UPDATE users SET plan = 'free' WHERE id = ?").run(u.id);
      planChange(u.id, null, 'premium', 'free', null, 'Premium arrivé à échéance');
      u.plan = 'free';
    }
    if (u && u.plan === 'premium' && u.credits_month !== today().slice(0, 7)) topUpMonthly(u);
    return u;
  };
  function topUpMonthly(u) {
    const included = Number(getSettings(db).plans.premium.ai_credits) || 0;
    const month = today().slice(0, 7);
    db.prepare('UPDATE users SET ai_credits = MAX(ai_credits, ?), credits_month = ? WHERE id = ?').run(included, month, u.id);
    u.ai_credits = Math.max(u.ai_credits || 0, included); u.credits_month = month;
  }

  /** Historique des offres : chaque passage Gratuit ↔ Premium ou changement d'échéance est conservé. */
  const planChange = (userId, actor, oldPlan, newPlan, until, reason) => {
    db.prepare('INSERT INTO plan_history (ts, user_id, actor, old_plan, new_plan, premium_until, reason) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(Date.now(), userId, actor ?? null, oldPlan, newPlan, until ?? null, reason ?? null);
    if (newPlan === 'premium' && oldPlan !== 'premium') {
      const email = db.prepare('SELECT email FROM users WHERE id = ?').get(userId)?.email || 'un compte';
      notifyEvent('premium', 'info', 'Nouveau Premium', `${email}${until ? ` jusqu'au ${until}` : ''}${reason ? ` — ${reason}` : ''}`);
    }
  };

  // ------------------------------------------------------------- Notifications de Pagio Admin (événements)
  // Chaque événement est gardé 30 jours : l'APK le lit (flux toutes les 15 min) et, si Firebase est réglé, il est
  // aussi envoyé tout de suite aux téléphones qui ont coché sa catégorie.
  const fcmToken = fcmTokenSource(pushFetch);
  const firebaseConf = () => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'firebase'").get();
    let f = {}; try { f = row ? JSON.parse(row.value) : {}; } catch { f = {}; }
    return f && typeof f === 'object' ? f : {};
  };
  const firebaseService = () => {
    const f = firebaseConf();
    if (!f.service?.private_key) return null;
    try { return { ...f.service, private_key: reveal(db, f.service.private_key) }; } catch { return null; }
  };
  async function pushEvent(ev, onlyDevice = null) {
    const service = firebaseService();
    if (!service) return 0;
    const devices = db.prepare('SELECT * FROM notify_devices WHERE revoked = 0 AND fcm_token IS NOT NULL').all()
      .filter((d) => (onlyDevice ? d.id === onlyDevice : wants(parsePrefs(d.prefs), ev.kind)));
    if (!devices.length) return 0;
    let sent = 0;
    try {
      const access = await fcmToken(service);
      for (const d of devices) {
        const quiet = ev.level !== 'critical' && parsePrefs(d.prefs).quiet && isQuietHour(ev.ts);
        const data = { id: String(ev.id), kind: ev.kind, level: ev.level, title: ev.title, body: ev.body, silent: quiet ? '1' : '0' };
        const r = await fcmSend(pushFetch, access, service.project_id, d.fcm_token, data).catch((e) => { logServerError(db, 'notifications', e); return 'error'; });
        if (r === 'unregistered') db.prepare('UPDATE notify_devices SET fcm_token = NULL WHERE id = ?').run(d.id);
        if (r === 'ok') sent++;
      }
    } catch (e) { logServerError(db, 'notifications', e); }
    return sent;
  }
  function notifyEvent(kind, level, title, body, onlyDevice = null) {
    const ts = Date.now();
    const r = db.prepare('INSERT INTO notify_events (ts, kind, level, title, body, device_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ts, kind, level, String(title).slice(0, 120), String(body).slice(0, 400), onlyDevice);
    const ev = { id: Number(r.lastInsertRowid), ts, kind, level, title: String(title).slice(0, 120), body: String(body).slice(0, 400) };
    app.locals.lastPush = pushEvent(ev, onlyDevice); // promesse gardée pour les tests ; jamais bloquante
    return ev;
  }
  app.locals.notifyEvent = notifyEvent;

  // Les badges sont datés à la seconde près : on arrondit pour qu'une connexion faite juste après reste valable.
  const validAfterNow = () => Math.floor(Date.now() / 1000) * 1000;
  const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;

  function userAuth(required) {
    return (req, res, next) => {
      const p = verifyToken(bearer(req), secret);
      if (p?.kind === 'user') {
        let u = db.prepare('SELECT * FROM users WHERE id = ?').get(p.sub);
        // Badge émis avant un changement de mot de passe : il ne vaut plus rien, le téléphone doit se reconnecter.
        if (u && (p.iat || 0) * 1000 < (u.tokens_valid_after || 0)) u = null;
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

  const recoveryLeft = (a) => { try { return JSON.parse(a.recovery_codes || '[]').length; } catch { return 0; } };
  const publicAdmin = (a) => ({ id: a.id, email: a.email, name: a.name, role: a.role, totp_enabled: !!a.totp_enabled, recovery_left: a.totp_enabled ? recoveryLeft(a) : 0 });
  const revokeSessions = (adminId, exceptId = null) =>
    Number(db.prepare('UPDATE admin_sessions SET revoked = 1 WHERE admin_id = ? AND revoked = 0 AND id != ?').run(adminId, exceptId ?? '').changes);
  // Clé d'IA : la variable d'environnement AI_API_KEY, si elle existe, remplace celle du tableau de bord.
  const aiConfig = (s) => (process.env.AI_API_KEY ? { ...s.ai, api_key: process.env.AI_API_KEY } : s.ai);

  // ------------------------------------------------------------- E-mails automatiques
  // Clé Brevo : la variable MAIL_API_KEY, si elle existe, remplace celle du tableau de bord.
  const mailConfig = (s) => (process.env.MAIL_API_KEY ? { ...s.mail, api_key: process.env.MAIL_API_KEY } : s.mail);
  const mailReady = (s) => { const m = mailConfig(s); return !!(m.enabled && m.api_key && emailOk(m.from_email)); };
  /**
   * Adresse publique du serveur pour les liens envoyés : réglage, sinon PUBLIC_URL. Jamais l'adresse de la requête :
   * l'en-tête Host est choisi par le client, et un pirate pourrait faire envoyer à sa victime un lien de nouveau mot
   * de passe pointant vers son propre site (vol du jeton, donc du compte).
   */
  const publicUrl = (s) => String(s.mail.public_url || process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  /** E-mails contenant un lien (mot de passe oublié, confirmation) : il faut en plus l'adresse publique. */
  const linksReady = (s) => mailReady(s) && /^https?:\/\//.test(publicUrl(s));
  /** Envoie un e-mail sans jamais faire échouer la requête en cours : un refus est inscrit au journal des erreurs. */
  const deliver = (s, to, message) => Promise.resolve()
    .then(() => sendMail(mailConfig(s), { to, ...message }))
    .then(() => true)
    .catch((e) => { logServerError(db, 'email', e, { path: `envoi à ${String(to).replace(/^(.).*(@.*)$/, '$1***$2')}` }); return false; });

  // Lien de confirmation de l'adresse : valable 30 jours (et renvoyable à tout moment depuis le compte).
  const verifyLink = (s, u) => {
    const token = newToken();
    db.prepare('UPDATE users SET verify_token = ?, verify_expires = ? WHERE id = ?').run(hashToken(token), Date.now() + 30 * DAY, u.id);
    return `${publicUrl(s)}/verifier?token=${token}`;
  };
  const sendVerification = (s, u) => deliver(s, u.email, messages.verify(verifyLink(s, u)));
  /** E-mail de bienvenue (information) à l'inscription, avec le lien de confirmation si l'adresse n'est pas encore confirmée. */
  const sendWelcome = (s, u) => {
    if (!linksReady(s)) return Promise.resolve(false);
    const url = !u.email_verified && s.mail.verify_signup ? verifyLink(s, u) : null;
    return deliver(s, u.email, messages.welcome(url, u.ai_credits, publicUrl(s)));
  };

  /** Applique un nouveau mot de passe à partir d'un jeton reçu par e-mail. Renvoie un message d'erreur, ou null si c'est fait. */
  function resetPassword(token, password) {
    if (!token) return 'Lien invalide.';
    const u = db.prepare('SELECT id FROM users WHERE reset_token = ? AND reset_expires > ?').get(hashToken(token), Date.now());
    if (!u) return "Ce lien a expiré ou a déjà été utilisé. Refaites une demande depuis l'application.";
    if (String(password || '').length < 8) return 'Le mot de passe doit contenir au moins 8 caractères.';
    // Recevoir le lien prouve aussi que l'adresse appartient bien à l'utilisateur.
    // Le nouveau mot de passe déconnecte tous les téléphones : un voleur du compte perd l'accès tout de suite.
    db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL, email_verified = 1, verify_token = NULL, tokens_valid_after = ? WHERE id = ?')
      .run(hashPassword(String(password)), validAfterNow(), u.id);
    return null;
  }

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
    for (const t of db.prepare('SELECT * FROM tools').all()) {
      tools[t.id] = { enabled: !!t.enabled, premium: !!t.premium, max_files: t.max_files, max_mb: t.max_mb, daily_free: t.daily_free, max_pages: t.max_pages, pdf_premium: !!t.pdf_premium };
    }
    ok(res, {
      maintenance: s.maintenance, maintenance_message: s.maintenance_message,
      announcement: s.announcement, announcement_level: s.announcement_level,
      min_version_code: s.min_version_code, latest_version_name: s.latest_version_name, update_url: s.update_url,
      tools, plans: s.plans, support_email: s.support_email,
      ai_enabled: !!(s.ai.enabled && (aiConfig(s).api_key || s.ai.base_url)),
      server_conversion: !!(s.conversion_enabled && libreOfficeAvailable()),
      registration_open: s.registration_open,
      google_client_id: s.google_client_id || '',
      ga_id: s.ga_id || '',
      prices: { currency: 'XOF', week: s.sales.price_week, month: s.sales.price_month, year: s.sales.price_year,
        ai_pack_credits: s.sales.ai_pack_credits, ai_pack_price: s.sales.ai_pack_price, premium_ai_credits: s.plans.premium.ai_credits },
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

  // ================================================================== Statistiques du site (sans cookies)
  const siteLimit = rateLimiter(120, 60_000);
  const OWN_HOSTS = ['pagio.site', 'pagio.hebergementci.com'];
  const clean = (v, max) => (v == null ? null : String(v).slice(0, max));

  // Une page vue sur pagio.site (envoyée par /site-stats.js ou par les outils en ligne). Robots ignorés.
  app.post('/api/site/hit', (req, res) => {
    const ua = String(req.headers['user-agent'] || '');
    if (isBot(ua) || !siteLimit(`h:${req.ip}`)) return res.status(204).end();
    const b = req.body || {};
    const p = String(b.path || '/').split('?')[0].split('#')[0].slice(0, 200) || '/';
    const { source, ref_domain: refDomain } = classifySource(b.ref, b.utm, OWN_HOSTS);
    const { device, browser, os: system } = parseUA(ua);
    db.prepare(`INSERT INTO site_hits (ts, visitor, path, source, ref_domain, country, lang, device, browser, os, screen_w, new_visit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(Date.now(), visitorId(req.ip, ua), p, source, refDomain, countryOf(b.tz, b.lang),
      clean(String(b.lang || '').split('-')[0].toLowerCase(), 8), device, browser, system, int(b.w, 0, 10000, 0), b.first ? 1 : 0);
    res.status(204).end();
  });

  // Utilisation d'un outil en ligne : rangée avec les statistiques de l'application (version « web »).
  app.post('/api/site/event', userAuth(false), (req, res) => {
    const ua = String(req.headers['user-agent'] || '');
    if (isBot(ua) || !siteLimit(`e:${req.ip}`)) return res.status(204).end();
    const b = req.body || {};
    const name = ['tool_run', 'limit_reached', 'signup', 'login'].includes(b.name) ? b.name : null;
    if (!name) return res.status(204).end();
    const props = { tool: clean(b.tool, 48), ok: b.ok === undefined ? undefined : !!b.ok, ms: int(b.ms, 0, 3_600_000, undefined),
      files: int(b.files, 0, 1000, undefined), bytes_in: int(b.bytes_in, 0, 2e9, undefined), error: clean(b.error, 80) ?? undefined,
      ...parseUA(ua), country: countryOf(b.tz, b.lang) };
    db.prepare('INSERT INTO events (ts, device_id, user_id, app_version, name, tool, ok, props) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(Date.now(), `web:${visitorId(req.ip, ua)}`, req.user?.id ?? null, 'web', name, props.tool, props.ok === undefined ? null : (props.ok ? 1 : 0), JSON.stringify(props));
    res.status(204).end();
  });

  // ------------------------------------------------------------- Statistiques détaillées de l'application
  // Filtres : pays et version (d'après la dernière ouverture de chaque appareil sur la période), offre du compte.
  // Un « appareil » = une installation de l'application (identifiant aléatoire) ; les outils en ligne ont leur onglet Site.
  app.get('/api/admin/app-stats', adminAuth(), (req, res) => {
    const days = int(req.query.days, 1, 395, 30);
    const now = Date.now();
    const since = now - days * DAY;
    const all = (sql, ...a) => db.prepare(sql).all(...a);
    const one = (sql, ...a) => db.prepare(sql).get(...a);
    const country = /^[A-Z]{2}$/.test(String(req.query.country || '')) ? String(req.query.country) : null;
    const version = String(req.query.version || '').slice(0, 20) || null;
    const plan = ['free', 'premium'].includes(req.query.plan) ? req.query.plan : null;
    // Appareils retenus par les filtres (sous-requête réutilisée partout).
    const devFilter = [];
    const devArgs = [];
    if (country) { devFilter.push("device_id IN (SELECT device_id FROM events WHERE name = 'app_open' AND json_extract(props, '$.country') = ?)"); devArgs.push(country); }
    if (version) { devFilter.push('app_version = ?'); devArgs.push(version); }
    if (plan) { devFilter.push('user_id IN (SELECT id FROM users WHERE plan = ?)'); devArgs.push(plan); }
    const W = (extra = '') => `app_version != 'web' AND device_id IS NOT NULL AND device_id != '' AND ts >= ? ${extra} ${devFilter.map((f) => `AND ${f}`).join(' ')}`;
    const A = (...pre) => [...pre, ...devArgs];
    const dayExpr = "date(ts / 1000, 'unixepoch')";

    // Utilisateurs actifs (appareils ayant ouvert ou utilisé l'application)
    const active = (d) => one(`SELECT COUNT(DISTINCT device_id) n FROM events WHERE ${W()}`, ...A(now - d * DAY)).n;
    const byDay = all(`SELECT ${dayExpr} day, COUNT(DISTINCT device_id) active, SUM(CASE WHEN name = 'app_open' AND json_extract(props, '$.first_open') = 1 THEN 1 ELSE 0 END) installs,
      SUM(CASE WHEN name = 'tool_run' THEN 1 ELSE 0 END) runs FROM events WHERE ${W()} GROUP BY day ORDER BY day`, ...A(since));
    const installs = one(`SELECT COUNT(*) n FROM events WHERE ${W("AND name = 'app_open' AND json_extract(props, '$.first_open') = 1")}`, ...A(since)).n;
    const accounts = one('SELECT COUNT(*) n FROM users WHERE created_at >= ?', since).n;
    const buyers = one("SELECT COUNT(DISTINCT user_id) n FROM payments WHERE ts >= ? AND refunded = 0 AND method != 'gift'", since).n;
    // Rétention : appareils installés sur la période, revenus 1, 7 et 30 jours après (au moins un événement ce jour-là ou après).
    const cohort = all(`SELECT device_id, MIN(ts) first FROM events WHERE ${W("AND name = 'app_open' AND json_extract(props, '$.first_open') = 1")} GROUP BY device_id`, ...A(since));
    const back = (d) => {
      const eligible = cohort.filter((c) => c.first + d * DAY <= now);
      if (eligible.length === 0) return null;
      const st = db.prepare('SELECT 1 FROM events WHERE device_id = ? AND ts >= ? LIMIT 1');
      return Math.round((eligible.filter((c) => st.get(c.device_id, c.first + d * DAY)).length / eligible.length) * 100);
    };
    const lost = one(`SELECT COUNT(*) n FROM (SELECT device_id, MAX(ts) last FROM events WHERE app_version != 'web' AND device_id IS NOT NULL AND device_id != '' GROUP BY device_id) WHERE last < ?`, now - 30 * DAY).n;

    // Appareils : dernière ouverture de chaque appareil sur la période
    const latest = `SELECT e.device_id, e.app_version, e.props FROM events e JOIN (SELECT device_id, MAX(id) mid FROM events WHERE ${W("AND name = 'app_open'")} GROUP BY device_id) l ON e.id = l.mid`;
    const dist = (expr, limit = 15) => all(`SELECT ${expr} k, COUNT(*) n FROM (${latest}) GROUP BY k ORDER BY n DESC LIMIT ${limit}`, ...A(since));
    const devicesCount = one(`SELECT COUNT(*) n FROM (${latest})`, ...A(since)).n;

    // Outils
    const tools = all(`SELECT tool, COUNT(*) runs, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) errors, COUNT(DISTINCT device_id) devices,
      ROUND(AVG(json_extract(props, '$.ms'))) ms, ROUND(AVG(json_extract(props, '$.bytes_in'))) bytes_in, ROUND(AVG(json_extract(props, '$.files')), 1) files
      FROM events WHERE ${W("AND name = 'tool_run' AND tool IS NOT NULL")} GROUP BY tool ORDER BY runs DESC`, ...A(since));
    const limits = Object.fromEntries(all(`SELECT tool, COUNT(*) n FROM events WHERE ${W("AND name = 'limit_reached'")} GROUP BY tool`, ...A(since)).map((r) => [r.tool, r.n]));
    const byHour = all(`SELECT CAST(strftime('%H', ts / 1000, 'unixepoch') AS INTEGER) hour, COUNT(*) runs FROM events WHERE ${W("AND name = 'tool_run'")} GROUP BY hour`, ...A(since));
    const byWeekday = all(`SELECT CAST(strftime('%w', ts / 1000, 'unixepoch') AS INTEGER) wd, COUNT(*) runs FROM events WHERE ${W("AND name = 'tool_run'")} GROUP BY wd`, ...A(since));
    const errors = all(`SELECT tool, json_extract(props, '$.error') error, COUNT(*) n FROM events WHERE ${W("AND name = 'tool_run' AND ok = 0")} GROUP BY tool, error ORDER BY n DESC LIMIT 15`, ...A(since));
    const ai = all(`SELECT json_extract(props, '$.task') task, COUNT(*) n FROM events WHERE ${W("AND name = 'ai_task'")} GROUP BY task ORDER BY n DESC`, ...A(since));
    const scans = one(`SELECT COUNT(*) n, ROUND(AVG(json_extract(props, '$.pages')), 1) pages FROM events WHERE ${W("AND name = 'scan'")}`, ...A(since));
    const crashes = all(`SELECT json_extract(props, '$.error') error, json_extract(props, '$.where') ou, app_version, COUNT(*) n FROM events WHERE ${W("AND name = 'app_crash'")} GROUP BY error, ou, app_version ORDER BY n DESC LIMIT 10`, ...A(since));

    ok(res, {
      days, filters: { country, version, plan },
      options: {
        countries: all("SELECT DISTINCT json_extract(props, '$.country') c FROM events WHERE name = 'app_open' AND json_extract(props, '$.country') IS NOT NULL ORDER BY c").map((r) => r.c),
        versions: all("SELECT DISTINCT app_version v FROM events WHERE app_version IS NOT NULL AND app_version != '' AND app_version != 'web' ORDER BY v DESC").map((r) => r.v),
      },
      users: {
        dau: active(1), wau: active(7), mau: active(30), installs, accounts, buyers, lost_30d: lost,
        retention: { d1: back(1), d7: back(7), d30: back(30), cohort: cohort.length },
        by_day: byDay,
      },
      devices: {
        count: devicesCount,
        countries: dist("json_extract(props, '$.country')", 20), languages: dist("json_extract(props, '$.lang')"),
        brands: dist("json_extract(props, '$.brand')"), models: dist("json_extract(props, '$.brand') || ' ' || json_extract(props, '$.model')", 20),
        android: dist("json_extract(props, '$.android')"), versions: dist('app_version'), installers: dist("json_extract(props, '$.installer')"),
        screens: dist("CASE WHEN json_extract(props, '$.tablet') THEN 'tablette' WHEN CAST(json_extract(props, '$.screen_dp') AS INTEGER) < 360 THEN 'petit téléphone (< 360 dp)' ELSE 'téléphone' END"),
        dark: dist("CASE WHEN json_extract(props, '$.dark') THEN 'sombre' ELSE 'clair' END"),
        timezones: dist("json_extract(props, '$.tz')"),
      },
      tools: {
        list: tools.map((t) => ({ ...t, limit_hits: limits[t.tool] || 0, error_pct: t.runs ? Math.round((t.errors / t.runs) * 100) : 0 })),
        by_hour: Array.from({ length: 24 }, (_, h) => byHour.find((r) => r.hour === h)?.runs ?? 0),
        by_weekday: Array.from({ length: 7 }, (_, d) => byWeekday.find((r) => r.wd === d)?.runs ?? 0),
        errors, ai, scans, crashes,
        limit_hits: Object.values(limits).reduce((a, b) => a + b, 0),
      },
    });
  });

  // ------------------------------------------------------------- Campagnes e-mail
  // Envoi à un segment d'utilisateurs, avec lien de désinscription personnel (sans connexion). Les désinscrits ne
  // reçoivent plus aucune campagne ; les e-mails de service (mot de passe, réponses du support) restent envoyés.
  const unsubToken = (id) => crypto.createHmac('sha256', secret).update(`unsub:${id}`).digest('base64url').slice(0, 22);
  const unsubUrl = (s, id) => `${publicUrl(s) || 'https://pagio.site'}/api/desabonnement?u=${encodeURIComponent(id)}&t=${unsubToken(id)}`;
  const SEGMENTS = {
    all: { label: 'Tous les comptes', where: '1 = 1', args: () => [] },
    free: { label: 'Gratuits', where: "plan = 'free'", args: () => [] },
    premium: { label: 'Premium', where: "plan = 'premium'", args: () => [] },
    expiring: { label: 'Premium expirant dans 7 jours', where: "plan = 'premium' AND premium_until BETWEEN ? AND ?", args: () => [today(), addDays(today(), 7)] },
    inactive: { label: 'Inactifs depuis 30 jours', where: '(last_seen IS NULL OR last_seen < ?)', args: () => [Date.now() - 30 * DAY] },
    new7: { label: 'Inscrits ces 7 derniers jours', where: 'created_at >= ?', args: () => [Date.now() - 7 * DAY] },
  };
  const segmentUsers = (seg) => {
    const g = SEGMENTS[seg];
    return db.prepare(`SELECT id, email, name FROM users WHERE banned = 0 AND marketing_unsub = 0 AND ${g.where}`).all(...g.args());
  };
  app.get('/api/desabonnement', (req, res) => {
    const id = String(req.query.u || '');
    const okTok = id && crypto.timingSafeEqual(Buffer.from(unsubToken(id).padEnd(22)), Buffer.from(String(req.query.t || '').padEnd(22).slice(0, 22)));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!okTok || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) return res.status(400).send(page('Lien invalide', '<h1>Lien invalide</h1><p>Ce lien de désinscription est incomplet ou ne correspond à aucun compte.</p>'));
    db.prepare('UPDATE users SET marketing_unsub = 1 WHERE id = ?').run(id);
    res.send(page('Désinscription', '<h1>C\'est fait</h1><p class="ok">Vous ne recevrez plus les e-mails d\'information de Pagio.</p><p class="muted">Les e-mails liés à votre compte (mot de passe oublié, réponses du support) restent envoyés.</p>'));
  });
  app.get('/api/admin/campaigns', adminAuth('admin'), (req, res) => ok(res, {
    segments: Object.fromEntries(Object.entries(SEGMENTS).map(([k, v]) => [k, { label: v.label, count: segmentUsers(k).length }])),
    campaigns: db.prepare('SELECT * FROM campaigns ORDER BY ts DESC LIMIT 50').all(),
    unsubscribed: db.prepare('SELECT COUNT(*) n FROM users WHERE marketing_unsub = 1').get().n,
  }));
  app.post('/api/admin/campaigns', adminAuth('admin'), async (req, res) => {
    const s = getSettings(db);
    if (!mailReady(s)) return fail(res, 400, 'Les e-mails ne sont pas activés (page E-mails).');
    const subject = String(req.body?.subject || '').trim().slice(0, 150);
    const body = String(req.body?.body || '').trim().slice(0, 10000);
    if (subject.length < 3 || body.length < 10) return fail(res, 400, 'Objet et message obligatoires');
    // Essai : à une seule adresse, sans rien enregistrer.
    if (req.body?.test_to) {
      if (!emailOk(req.body.test_to)) return fail(res, 400, "Adresse d'essai invalide");
      try { await sendMail(mailConfig(s), { to: req.body.test_to, ...messages.campaign(subject, body, '', unsubUrl(s, 'essai')) }); } catch (e) { return fail(res, 502, e.message); }
      return ok(res, { test: true });
    }
    const seg = SEGMENTS[req.body?.segment] ? req.body.segment : null;
    if (!seg) return fail(res, 400, 'Choisissez à qui envoyer');
    const list = segmentUsers(seg);
    if (list.length === 0) return fail(res, 400, 'Personne dans ce groupe');
    const id = db.prepare('INSERT INTO campaigns (ts, admin_email, subject, body, segment, recipients, sent, failed, status) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)')
      .run(Date.now(), req.admin.email, subject, body, seg, list.length, 'en cours').lastInsertRowid;
    audit(req.admin, 'campaign.send', SEGMENTS[seg].label, { id: Number(id), recipients: list.length, subject });
    ok(res, { id: Number(id), recipients: list.length });
    // Envoi en arrière-plan, un e-mail toutes les 300 ms (limites de Brevo), avec le compte des réussites et des échecs.
    (async () => {
      let sent = 0; let failed = 0;
      for (const u of list) {
        try { await sendMail(mailConfig(s), { to: u.email, ...messages.campaign(subject, body, u.name, unsubUrl(s, u.id)) }); sent++; }
        catch (e) { failed++; if (failed <= 3) logServerError(db, 'email', e); }
        if ((sent + failed) % 10 === 0) db.prepare('UPDATE campaigns SET sent = ?, failed = ? WHERE id = ?').run(sent, failed, id);
        await new Promise((r) => setTimeout(r, campaignDelayMs));
      }
      db.prepare("UPDATE campaigns SET sent = ?, failed = ?, status = 'terminée' WHERE id = ?").run(sent, failed, id);
    })();
  });

  // ------------------------------------------------------------- Sécurité
  // Connexions des utilisateurs (90 jours) : réussites et échecs, adresse IP tronquée, appareil. Sert à repérer les abus.
  const shortIp = (ip) => String(ip || '').replace(/^::ffff:/, '').replace(/(\d+\.\d+\.\d+)\.\d+$/, '$1.x').replace(/^([0-9a-f]+:[0-9a-f]+:[0-9a-f]+):.*$/i, '$1::x');
  function recordLogin(req, userId, email, okLogin, method) {
    db.prepare('INSERT INTO user_logins (ts, user_id, email, ip, ua, ok, method) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(Date.now(), userId ?? null, String(email || '').slice(0, 200), shortIp(req.ip), String(req.headers['user-agent'] || '').slice(0, 200), okLogin ? 1 : 0, method);
  }
  app.locals.recordLogin = recordLogin;
  app.get('/api/admin/security', adminAuth('admin'), (req, res) => {
    const since = Date.now() - DAY;
    ok(res, {
      blocked_ips: getSettings(db).blocked_ips,
      failed_24h: db.prepare('SELECT ip, COUNT(*) n, COUNT(DISTINCT email) accounts, MAX(ts) last FROM user_logins WHERE ok = 0 AND ts >= ? GROUP BY ip ORDER BY n DESC LIMIT 20').all(since),
      logins: db.prepare('SELECT * FROM user_logins ORDER BY ts DESC LIMIT 200').all(),
      admin_logins: db.prepare("SELECT ts, admin_email, action, target FROM audit WHERE action LIKE 'admin.login%' ORDER BY ts DESC LIMIT 50").all(),
    });
  });
  app.put('/api/admin/security/blocked', adminAuth('admin'), (req, res) => {
    const list = Array.isArray(req.body?.ips) ? [...new Set(req.body.ips.map((x) => String(x).trim()).filter((x) => /^[0-9a-fA-F:.x/]{3,45}$/.test(x)))].slice(0, 500) : null;
    if (!list) return fail(res, 400, 'Liste invalide');
    setSetting(db, 'blocked_ips', list);
    audit(req.admin, 'security.blocked_ips', null, { count: list.length });
    ok(res, { blocked_ips: list });
  });
  // Droit d'accès / portabilité : toutes les données d'un compte, en un fichier JSON.
  const exportUser = (id) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) return null;
    const { password_hash: _p, reset_token: _r, verify_token: _v, ...account } = u;
    return {
      exported_at: new Date().toISOString(), account,
      plan_history: db.prepare('SELECT ts, old_plan, new_plan, premium_until, reason FROM plan_history WHERE user_id = ?').all(id),
      payments: db.prepare('SELECT ts, kind, offer, amount, currency, method, reference, days, credits, premium_until, refunded FROM payments WHERE user_id = ?').all(id),
      usage_events: db.prepare('SELECT ts, name, tool, ok, app_version, props FROM events WHERE user_id = ?').all(id),
      ai_usage: db.prepare('SELECT ts, credits, chars_in, chars_out, ok FROM ai_usage WHERE user_id = ?').all(id),
      conversions: db.prepare('SELECT ts, source_ext, target, bytes, ok FROM conversions WHERE user_id = ?').all(id),
      support_messages: db.prepare('SELECT ts, kind, message, status FROM feedback WHERE user_id = ? OR lower(email) = ?').all(id, u.email),
      logins: db.prepare('SELECT ts, ip, ua, ok, method FROM user_logins WHERE user_id = ?').all(id),
    };
  };
  app.get('/api/admin/users/:id/export', adminAuth('admin'), (req, res) => {
    const data = exportUser(req.params.id);
    if (!data) return fail(res, 404, 'Utilisateur introuvable');
    audit(req.admin, 'user.export', data.account.email);
    res.setHeader('Content-Disposition', `attachment; filename="pagio-donnees-${req.params.id.slice(0, 8)}.json"`);
    ok(res, data);
  });
  app.get('/api/me/export', userAuth(true), (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="mes-donnees-pagio.json"');
    ok(res, exportUser(req.user.id));
  });

  // ------------------------------------------------------------- Recherche globale
  app.get('/api/admin/search', adminAuth(), (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q.length < 2) return ok(res, { users: [], payments: [], feedback: [], promo: [] });
    const like = `%${q}%`;
    ok(res, {
      users: db.prepare('SELECT id, email, name, plan, premium_until FROM users WHERE lower(email) LIKE ? OR lower(name) LIKE ? OR id = ? OR ref_code = ? LIMIT 10').all(like, like, q, q.toUpperCase()),
      payments: db.prepare('SELECT id, ts, user_email, amount, method, reference FROM payments WHERE lower(user_email) LIKE ? OR lower(reference) LIKE ? ORDER BY ts DESC LIMIT 10').all(like, like),
      feedback: db.prepare('SELECT id, ts, email, substr(message, 1, 120) message, status FROM feedback WHERE lower(message) LIKE ? OR lower(email) LIKE ? ORDER BY ts DESC LIMIT 10').all(like, like),
      promo: db.prepare('SELECT code, kind, value, uses FROM promo_codes WHERE lower(code) LIKE ? LIMIT 10').all(like),
    });
  });

  // Tableau de bord : fréquentation du site sur la période.
  app.get('/api/admin/site-stats', adminAuth(), (req, res) => {
    const days = int(req.query.days, 1, 395, 30);
    const since = Date.now() - days * DAY;
    const all = (sql, ...a) => db.prepare(sql).all(...a);
    const one = (sql, ...a) => db.prepare(sql).get(...a);
    const dayExpr = "date(ts / 1000, 'unixepoch')";
    // Visiteur unique = une empreinte par jour : le total d'une période additionne les visiteurs de chaque jour.
    const totals = one(`SELECT COUNT(*) views, COUNT(DISTINCT ${dayExpr} || visitor) visitors FROM site_hits WHERE ts >= ?`, since);
    const top = (col, n = 12) => all(`SELECT ${col} k, COUNT(*) views, COUNT(DISTINCT ${dayExpr} || visitor) visitors FROM site_hits WHERE ts >= ? AND ${col} IS NOT NULL GROUP BY ${col} ORDER BY visitors DESC, views DESC LIMIT ${n}`, since);
    const perVisit = one(`SELECT AVG(n) v FROM (SELECT COUNT(*) n FROM site_hits WHERE ts >= ? GROUP BY ${dayExpr}, visitor)`, since).v || 0;
    const bounces = one(`SELECT COUNT(*) n FROM (SELECT COUNT(*) c FROM site_hits WHERE ts >= ? GROUP BY ${dayExpr}, visitor HAVING c = 1)`, since).n;
    const visits = one(`SELECT COUNT(*) n FROM (SELECT 1 FROM site_hits WHERE ts >= ? GROUP BY ${dayExpr}, visitor)`, since).n;
    ok(res, {
      days, views: totals.views, visitors: totals.visitors, pages_per_visit: Math.round(perVisit * 10) / 10,
      bounce_pct: visits ? Math.round((bounces / visits) * 100) : 0,
      by_day: all(`SELECT ${dayExpr} day, COUNT(*) views, COUNT(DISTINCT visitor) visitors FROM site_hits WHERE ts >= ? GROUP BY day ORDER BY day`, since),
      by_hour: all("SELECT CAST(strftime('%H', ts / 1000, 'unixepoch') AS INTEGER) hour, COUNT(*) views FROM site_hits WHERE ts >= ? GROUP BY hour ORDER BY hour", since),
      pages: top('path', 20), sources: top('source'), referrers: top('ref_domain'), countries: top('country', 20), languages: top('lang'),
      devices: top('device', 5), browsers: top('browser'), systems: top('os'),
      online_tools: all("SELECT tool, COUNT(*) runs, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) errors, COUNT(DISTINCT device_id) visitors FROM events WHERE app_version = 'web' AND name = 'tool_run' AND ts >= ? GROUP BY tool ORDER BY runs DESC", since),
      apk_downloads: one("SELECT COUNT(*) n FROM site_hits WHERE ts >= ? AND path LIKE '/telecharger/%'", since).n,
    });
  });

  app.post('/api/app/feedback', userAuth(false), (req, res) => {
    const { kind, message, email } = req.body || {};
    if (!message || String(message).trim().length < 5) return fail(res, 400, 'Message trop court');
    if (!feedbackLimit(`f:${req.ip}`)) return fail(res, 429, 'Trop de messages envoyés. Réessayez dans une heure.');
    db.prepare('INSERT INTO feedback (ts, kind, message, email, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(Date.now(), String(kind || 'contact').slice(0, 20), String(message).slice(0, 5000), String(email || '').slice(0, 200), req.user?.id ?? null);
    notifyEvent('feedback', 'info', 'Nouveau message', String(message).trim().slice(0, 200));
    ok(res, { message: 'Merci ! Votre message a bien été envoyé.' });
  });

  // ================================================================== Comptes utilisateurs

  /** Parrain d'après le code saisi à l'inscription (null si absent, inconnu ou parrainage désactivé). */
  const referrerId = (code) => {
    const c = String(code || '').trim().toUpperCase();
    if (!c || !getSettings(db).referral.enabled) return null;
    return db.prepare('SELECT id FROM users WHERE ref_code = ?').get(c)?.id ?? null;
  };

  app.post('/api/auth/register', async (req, res) => {
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
    const passwordHash = await hashPasswordAsync(password);
    // Une autre inscription avec la même adresse a pu aboutir pendant le calcul.
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return fail(res, 409, 'Un compte existe déjà avec cette adresse');
    db.prepare('INSERT INTO users (id, email, name, password_hash, ai_credits, created_at, referred_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, email, String(req.body?.name || '').slice(0, 80), passwordHash, s.plans.free.ai_credits || 0, Date.now(), referrerId(req.body?.ref));
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    notifyEvent('signup', 'info', 'Nouvelle inscription', `${email}${u.referred_by ? ' (parrainage)' : ''}`);
    sendWelcome(s, u);
    ok(res, { token: signToken({ kind: 'user', sub: id }, secret, 90 * 86400), user: selfUser(u) });
  });

  app.post('/api/auth/login', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!loginLimit(`u:${req.ip}:${email}`) || !loginIpLimit(`ui:${req.ip}`)) return fail(res, 429, 'Trop de tentatives. Réessayez dans 15 minutes.');
    const password = String(req.body?.password || '');
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const good = u ? await verifyPasswordAsync(password, u.password_hash) : await verifyAgainstNothing(password);
    if (!good) { recordLogin(req, u?.id, email, false, 'mot de passe'); return fail(res, 401, 'E-mail ou mot de passe incorrect'); }
    if (u.banned) { recordLogin(req, u.id, email, false, 'compte suspendu'); return fail(res, 403, 'Compte suspendu. Contactez le support.'); }
    recordLogin(req, u.id, email, true, 'mot de passe');
    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), u.id);
    ok(res, { token: signToken({ kind: 'user', sub: u.id }, secret, 90 * 86400), user: selfUser(effective(u)) });
  });

  // Connexion « avec Google » (site web, plus tard l'application) : le compte est celui de l'adresse Google, créé au
  // premier passage (adresse déjà vérifiée par Google). Un compte existant avec la même adresse est simplement ouvert.
  app.post('/api/auth/google', async (req, res) => {
    if (!loginIpLimit(`ui:${req.ip}`)) return fail(res, 429, 'Trop de tentatives. Réessayez dans 15 minutes.');
    const s = getSettings(db);
    let g;
    try { g = await verifyGoogle(req.body?.credential, s.google_client_id); }
    catch (e) { return fail(res, 401, e.message); }
    let u = db.prepare('SELECT * FROM users WHERE email = ?').get(g.email);
    if (!u) {
      if (!s.registration_open) return fail(res, 403, 'Les inscriptions sont temporairement fermées.');
      const perHour = Number(s.limits.register_per_hour) || 0;
      if (perHour > 0 && !registerLimit(`r:${req.ip}`, perHour)) return fail(res, 429, 'Trop d\'inscriptions depuis cette connexion. Réessayez dans une heure.');
      const id = crypto.randomUUID();
      // Mot de passe aléatoire jamais communiqué : « Mot de passe oublié » permet d'en choisir un plus tard.
      db.prepare('INSERT INTO users (id, email, name, password_hash, ai_credits, created_at, email_verified, referred_by) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
        .run(id, g.email, g.name, await hashPasswordAsync(crypto.randomBytes(24).toString('base64url')), s.plans.free.ai_credits || 0, Date.now(), referrerId(req.body?.ref));
      u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      notifyEvent('signup', 'info', 'Nouvelle inscription', `${g.email} (Google)`);
      sendWelcome(s, u);
    } else if (!u.email_verified) {
      db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(u.id); // Google vient de confirmer l'adresse
    }
    if (u.banned) { recordLogin(req, u.id, u.email, false, 'Google (compte suspendu)'); return fail(res, 403, 'Compte suspendu. Contactez le support.'); }
    recordLogin(req, u.id, u.email, true, 'Google');
    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), u.id);
    u = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
    ok(res, { token: signToken({ kind: 'user', sub: u.id }, secret, 90 * 86400), user: selfUser(effective(u)) });
  });

  // Mot de passe oublié. Avec les e-mails activés : un lien valable 1 heure est envoyé. Sinon : la demande est
  // enregistrée et le support la traite à la main. La réponse est identique que l'adresse existe ou non.
  app.post('/api/auth/forgot', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!forgotLimit(`p:${req.ip}`)) return fail(res, 429, 'Trop de demandes. Réessayez dans une heure.');
    const s = getSettings(db);
    const u = db.prepare('SELECT id, email, banned FROM users WHERE email = ?').get(email);
    if (linksReady(s)) {
      if (u && !u.banned) {
        const token = newToken();
        db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').run(hashToken(token), Date.now() + HOUR, u.id);
        deliver(s, u.email, messages.reset(`${publicUrl(s)}/reinitialiser?token=${token}`));
      }
      return ok(res, { message: 'Si un compte existe pour cette adresse, un e-mail vient de lui être envoyé avec un lien pour choisir un nouveau mot de passe (pensez à regarder dans les courriers indésirables).' });
    }
    if (u) db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').run(hashToken(newToken()), Date.now() + DAY, u.id);
    ok(res, { message: 'Si un compte existe pour cette adresse, une demande de réinitialisation a été enregistrée. Le support vous contactera.' });
  });

  app.post('/api/auth/reset', (req, res) => {
    if (!resetLimit(`x:${req.ip}`)) return fail(res, 429, 'Trop de tentatives. Réessayez dans une heure.');
    const error = resetPassword(String(req.body?.token || ''), req.body?.password);
    if (error) return fail(res, 400, error);
    ok(res, { message: 'Mot de passe modifié. Vous pouvez vous connecter.' });
  });

  app.post('/api/auth/resend-verification', userAuth(true), async (req, res) => {
    const s = getSettings(db);
    if (req.user.email_verified) return ok(res, { message: 'Votre adresse est déjà confirmée.' });
    if (!linksReady(s)) return fail(res, 503, "L'envoi d'e-mails n'est pas activé sur ce serveur.");
    if (!resendLimit(`v:${req.user.id}`)) return fail(res, 429, 'Trop de demandes. Réessayez dans une heure.');
    if (!(await sendVerification(s, req.user))) return fail(res, 502, "L'e-mail n'a pas pu être envoyé. Réessayez plus tard.");
    ok(res, { message: 'Un e-mail de confirmation vient de vous être envoyé.' });
  });

  // Pages ouvertes depuis les liens reçus par e-mail (formulaires simples, sans script).
  const html = (res, status, body) => res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).send(body);
  app.get('/reinitialiser', (req, res) => {
    const token = String(req.query.token || '');
    const valid = token && db.prepare('SELECT 1 FROM users WHERE reset_token = ? AND reset_expires > ?').get(hashToken(token), Date.now());
    if (!valid) return html(res, 400, messagePage('Lien expiré', "Ce lien a expiré ou a déjà été utilisé. Refaites une demande depuis l'application.", false));
    html(res, 200, resetForm(token));
  });
  app.post('/reinitialiser', express.urlencoded({ extended: false, limit: '10kb' }), (req, res) => {
    if (!resetLimit(`x:${req.ip}`)) return html(res, 429, messagePage('Trop de tentatives', 'Réessayez dans une heure.', false));
    const { token = '', password = '', confirm = '' } = req.body || {};
    if (password !== confirm) return html(res, 400, resetForm(token, 'Les deux mots de passe ne sont pas identiques.'));
    const error = resetPassword(String(token), password);
    if (error) return html(res, 400, /8 caractères/.test(error) ? resetForm(token, error) : messagePage('Lien expiré', error, false));
    html(res, 200, messagePage('Mot de passe modifié', 'Votre nouveau mot de passe est enregistré.'));
  });
  app.get('/verifier', (req, res) => {
    const token = String(req.query.token || '');
    const u = token && db.prepare('SELECT id FROM users WHERE verify_token = ? AND verify_expires > ?').get(hashToken(token), Date.now());
    if (!u) return html(res, 400, messagePage('Lien expiré', "Ce lien a expiré ou a déjà été utilisé. Demandez un nouvel e-mail de confirmation depuis l'application.", false));
    db.prepare('UPDATE users SET email_verified = 1, verify_token = NULL, verify_expires = NULL WHERE id = ?').run(u.id);
    html(res, 200, messagePage('Adresse confirmée', 'Merci, votre adresse e-mail est confirmée.'));
  });

  app.get('/api/me', userAuth(true), (req, res) => ok(res, { user: selfUser(req.user) }));

  /**
   * Suppression d'un compte (par l'utilisateur ou un administrateur) : le compte, son historique d'offres et ses messages
   * au support sont effacés ; les statistiques anonymes (usage des outils, IA, conversions) sont détachées du compte.
   * Ce que promet la page publique « Suppression de compte ». Les sauvegardes disparaissent au bout de leur durée de conservation.
   */
  function eraseUser(id) {
    const u = db.prepare('SELECT email FROM users WHERE id = ?').get(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    db.prepare('DELETE FROM plan_history WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM feedback_replies WHERE feedback_id IN (SELECT id FROM feedback WHERE user_id = ? OR (? IS NOT NULL AND lower(email) = ?))').run(id, u?.email ?? null, u?.email ?? null);
    db.prepare('DELETE FROM feedback WHERE user_id = ? OR (? IS NOT NULL AND lower(email) = ?)').run(id, u?.email ?? null, u?.email ?? null);
    for (const t of ['events', 'ai_usage', 'conversions']) db.prepare(`UPDATE ${t} SET user_id = NULL WHERE user_id = ?`).run(id);
    // Les ventes restent dans les comptes (montants), sans l'identité de l'acheteur.
    db.prepare('UPDATE payments SET user_id = NULL, user_email = NULL, reference = NULL, note = NULL WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM promo_redemptions WHERE user_id = ?').run(id);
    db.prepare('UPDATE user_logins SET user_id = NULL, email = NULL WHERE user_id = ?').run(id);
    db.prepare('UPDATE users SET referred_by = NULL WHERE referred_by = ?').run(id);
  }

  app.delete('/api/me', userAuth(true), (req, res) => {
    eraseUser(req.user.id);
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
      // Le détail (parfois un morceau de la clé d'API, chez certains fournisseurs) reste dans le journal du serveur.
      fail(res, 502, "Le service d'IA est momentanément indisponible. Réessayez dans quelques minutes.");
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
    // LibreOffice est gourmand : file d'attente (Premium d'abord) plutôt que de saturer le serveur.
    try { await takeSlot(req.user?.plan === 'premium'); } catch (e) { return fail(res, e.status || 503, e.message); }
    queueStats.served++;
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
      releaseSlot();
    }
  });

  // ------------------------------------------------------------- Outils PDF du serveur (étape 4, vague 2)
  // POST /api/pdf/compress?level=low|medium|high, /repair, /protect, /unlock, /html_to_pdf ; corps = le fichier.
  // Le mot de passe (protéger, déverrouiller) passe dans l'en-tête X-Pdf-Password : jamais dans l'adresse (journaux).
  app.post('/api/pdf/:op', userAuth(false), (req, res, next) => {
    if (!PDF_OPS.includes(req.params.op)) return fail(res, 404, 'Outil inconnu');
    if (!req.user) return fail(res, 401, 'Connectez-vous à votre compte Pagio pour utiliser cet outil en ligne');
    const t = db.prepare('SELECT * FROM tools WHERE id = ?').get(req.params.op);
    if (t && !t.enabled) return fail(res, 403, 'Cet outil est momentanément désactivé');
    if (t?.premium && req.user?.plan !== 'premium') return fail(res, 402, 'Outil réservé à Premium');
    if (t?.max_mb && Number(req.headers['content-length']) > t.max_mb * 1048576) return fail(res, 413, `Fichier trop volumineux (${t.max_mb} Mo maximum)`);
    next();
  }, convertGuard, express.raw({ type: '*/*', limit: '100mb' }), async (req, res) => {
    const op = req.params.op;
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return fail(res, 400, 'Fichier vide');
    if (req.body.length > req.convertMaxBytes) return fail(res, 413, 'Fichier trop volumineux');
    try { await takeSlot(req.user?.plan === 'premium'); } catch (e) { return fail(res, e.status || 503, e.message); }
    queueStats.served++;
    const t0 = Date.now();
    const name = String(req.query.name || 'document').slice(0, 150);
    try {
      const out = await pdfTool(op, req.body, { level: String(req.query.level || 'medium'), lang: String(req.query.lang || 'fra'), password: String(req.headers['x-pdf-password'] || ''), name });
      db.prepare('INSERT INTO conversions (ts, user_id, source_ext, target, bytes, ms, ok) VALUES (?, ?, ?, ?, ?, ?, 1)')
        .run(Date.now(), req.user?.id ?? null, path.extname(name).slice(1, 10), op, req.body.length, Date.now() - t0);
      res.setHeader('Content-Type', 'application/pdf');
      if (out.note) res.setHeader('X-Pagio-Note', out.note);
      res.send(out.bytes);
    } catch (e) {
      db.prepare('INSERT INTO conversions (ts, user_id, source_ext, target, bytes, ms, ok, error) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
        .run(Date.now(), req.user?.id ?? null, path.extname(name).slice(1, 10), op, req.body.length, Date.now() - t0, String(e.message).slice(0, 500));
      if (!e.status || e.status >= 500) logServerError(db, 'outil_pdf', e, { method: req.method, path: req.path, status: e.status || 500 });
      fail(res, e.status || 500, e.status ? e.message : "Le traitement a échoué. Le fichier est peut-être trop abîmé.");
    } finally {
      releaseSlot();
    }
  });

  // ================================================================== Administration

  app.post('/api/admin/login', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!loginLimit(`a:${req.ip}:${email}`) || !loginIpLimit(`ai:${req.ip}`, 20)) return fail(res, 429, 'Trop de tentatives. Réessayez dans 15 minutes.');
    const password = String(req.body?.password || '');
    const a = db.prepare('SELECT * FROM admins WHERE email = ? AND active = 1').get(email);
    const good = a ? await verifyPasswordAsync(password, a.password_hash) : await verifyAgainstNothing(password);
    if (!good) {
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

  // Nouveaux codes de secours (les anciens cessent aussitôt de marcher) : mot de passe + code de l'application exigés.
  app.post('/api/admin/me/2fa/recovery', adminAuth(), (req, res) => {
    if (!req.admin.totp_enabled) return fail(res, 400, "La double authentification n'est pas active");
    if (!verifyPassword(String(req.body?.password || ''), req.admin.password_hash)) return fail(res, 400, 'Mot de passe incorrect');
    if (!/^\d{6}$/.test(String(req.body?.code || '').replace(/\s/g, '')) || !checkSecondFactor(req.admin, req.body?.code)) {
      return fail(res, 400, "Code de l'application d'authentification incorrect (les codes de secours ne sont pas acceptés ici)");
    }
    const codes = newRecoveryCodes();
    db.prepare('UPDATE admins SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(codes.map(hashRecoveryCode)), req.admin.id);
    audit(req.admin, 'admin.recovery_codes_renewed', req.admin.email);
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
      changes.tokens_valid_after = validAfterNow();
    }
    const keys = Object.keys(changes);
    if (keys.length === 0) return fail(res, 400, 'Aucune modification');
    db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => changes[k]), u.id);
    const newPlan = changes.plan ?? u.plan;
    const newUntil = 'premium_until' in changes ? changes.premium_until : u.premium_until;
    if (newPlan !== u.plan || newUntil !== u.premium_until) planChange(u.id, req.admin.email, u.plan, newPlan, newUntil, b.reason ? String(b.reason).slice(0, 200) : null);
    const logged = { ...changes }; delete logged.tokens_valid_after; if (logged.password_hash) { delete logged.password_hash; logged.password = 'réinitialisé'; }
    audit(req.admin, 'user.update', u.email, logged);
    ok(res, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
  });

  app.delete('/api/admin/users/:id', adminAuth('admin'), (req, res) => {
    const u = db.prepare('SELECT email FROM users WHERE id = ?').get(req.params.id);
    if (!u) return fail(res, 404, 'Utilisateur introuvable');
    eraseUser(req.params.id);
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
          eraseUser(id);
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

  // ------------------------------------------------------------- Ventes
  // Paiement enregistré à la main (mobile money, espèces, virement…) ou Premium offert (montant 0, moyen « gift », motif exigé).
  // Premium : la durée s'ajoute à l'échéance en cours (ou à aujourd'hui) et les crédits IA inclus sont remis à niveau.
  // Recharge IA : les crédits s'ajoutent au solde.
  const addDays = (isoDay, days) => { const d = new Date(`${isoDay}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  const paymentRow = (p) => ({ ...p, refunded: !!p.refunded });

  app.post('/api/admin/users/:id/payments', adminAuth('admin'), (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!u) return fail(res, 404, 'Utilisateur introuvable');
    const b = req.body || {};
    const s = getSettings(db);
    const kind = b.kind === 'ai_pack' ? 'ai_pack' : 'premium';
    const method = String(b.method || '');
    if (!PAYMENT_METHODS.includes(method)) return fail(res, 400, 'Moyen de paiement inconnu');
    const gift = method === 'gift';
    const note = String(b.note || '').trim().slice(0, 300);
    if (gift && !note) return fail(res, 400, 'Indiquez le motif du Premium offert (testeur, promotion, geste commercial…)');
    const reference = String(b.reference || '').trim().slice(0, 120) || null;
    const amount = gift ? 0 : int(b.amount, 0, 100_000_000, -1);
    if (amount < 0) return fail(res, 400, 'Montant invalide');
    let offer = null; let days = 0; let credits = 0; let until = u.premium_until;
    if (kind === 'premium') {
      offer = ['week', 'month', 'year', 'custom'].includes(b.offer) ? b.offer : '';
      if (!offer) return fail(res, 400, 'Choisissez une offre (semaine, mois, année ou durée libre)');
      days = offer === 'custom' ? int(b.days, 1, 3660, 0) : OFFER_DAYS[offer];
      if (!days) return fail(res, 400, 'Indiquez une durée en jours');
      const from = u.plan === 'premium' && u.premium_until && u.premium_until >= today() ? u.premium_until : today();
      until = addDays(from, days);
    } else {
      credits = int(b.credits ?? s.sales.ai_pack_credits, 1, 1_000_000, 0);
      if (!credits) return fail(res, 400, 'Indiquez un nombre de crédits');
    }
    if (reference && !gift && db.prepare('SELECT 1 FROM payments WHERE method = ? AND reference = ? AND refunded = 0').get(method, reference)) {
      return fail(res, 409, 'Ce paiement (même moyen, même référence) est déjà enregistré');
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      if (kind === 'premium') {
        const included = Number(s.plans.premium.ai_credits) || 0;
        db.prepare("UPDATE users SET plan = 'premium', premium_until = ?, ai_credits = MAX(ai_credits, ?), credits_month = ? WHERE id = ?").run(until, included, today().slice(0, 7), u.id);
        planChange(u.id, req.admin.email, u.plan, 'premium', until, gift ? `Premium offert : ${note}` : `Paiement ${method}${reference ? ` ${reference}` : ''}`);
      } else {
        db.prepare('UPDATE users SET ai_credits = ai_credits + ? WHERE id = ?').run(credits, u.id);
      }
      const r = db.prepare(`INSERT INTO payments (ts, user_id, user_email, kind, offer, amount, method, reference, days, credits, premium_until, actor, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(Date.now(), u.id, u.email, kind, offer, amount, method, reference, days, credits, kind === 'premium' ? until : null, req.admin.email, note || null);
      db.exec('COMMIT');
      if (!gift && amount > 0) rewardReferrer(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id));
      if (!gift && amount > 0) notifyEvent('payment', 'info', 'Nouveau paiement', `${Number(amount).toLocaleString('fr-FR')} F — ${u.email} (${method}${kind === 'premium' ? `, Premium ${days} j` : `, ${credits} crédits IA`})`);
      audit(req.admin, gift ? 'payment.gift' : 'payment.record', u.email, { kind, offer, amount, method, days, credits, premium_until: kind === 'premium' ? until : undefined });
      ok(res, { payment: paymentRow(db.prepare('SELECT * FROM payments WHERE id = ?').get(r.lastInsertRowid)), user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
    } catch (e) {
      db.exec('ROLLBACK');
      logServerError(db, 'admin', e, { method: req.method, path: req.path, status: 500 });
      fail(res, 500, `Rien n'a été enregistré : ${e.message}`);
    }
  });

  app.get('/api/admin/payments', adminAuth(), (req, res) => {
    const days = int(req.query.days, 1, 3660, 90);
    const since = Date.now() - days * DAY;
    const where = ['ts >= ?']; const args = [since];
    if (req.query.user) { where.push('user_id = ?'); args.push(String(req.query.user)); }
    if (req.query.method && PAYMENT_METHODS.includes(String(req.query.method))) { where.push('method = ?'); args.push(String(req.query.method)); }
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q) { where.push('(lower(user_email) LIKE ? OR lower(reference) LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
    ok(res, { payments: db.prepare(`SELECT * FROM payments WHERE ${where.join(' AND ')} ORDER BY ts DESC LIMIT 500`).all(...args).map(paymentRow) });
  });

  // Remboursement : la vente sort des revenus. Le Premium n'est pas retiré automatiquement (à décider compte par compte).
  app.post('/api/admin/payments/:id/refund', adminAuth('admin'), (req, res) => {
    const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
    if (!p) return fail(res, 404, 'Paiement introuvable');
    if (p.refunded) return fail(res, 400, 'Déjà remboursé');
    db.prepare('UPDATE payments SET refunded = 1, refunded_at = ? WHERE id = ?').run(Date.now(), p.id);
    audit(req.admin, 'payment.refund', p.user_email, { id: p.id, amount: p.amount, method: p.method });
    ok(res, { payment: paymentRow(db.prepare('SELECT * FROM payments WHERE id = ?').get(p.id)) });
  });

  // Revenus et coût de l'IA sur la période (francs CFA), avec les prix à saisir dans Google Play.
  app.get('/api/admin/revenue', adminAuth(), (req, res) => {
    const s = getSettings(db).sales;
    const days = int(req.query.days, 1, 3660, 30);
    const since = Date.now() - days * DAY;
    const paid = "refunded = 0 AND method != 'gift'";
    const one = (sql, ...a) => db.prepare(sql).get(...a);
    const totals = one(`SELECT COALESCE(SUM(amount), 0) amount, COUNT(*) n FROM payments WHERE ${paid} AND ts >= ?`, since);
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const month = one(`SELECT COALESCE(SUM(amount), 0) amount, COUNT(*) n FROM payments WHERE ${paid} AND ts >= ?`, monthStart.getTime());
    const byDay = db.prepare(`SELECT date(ts / 1000, 'unixepoch') day, SUM(amount) amount, COUNT(*) n FROM payments WHERE ${paid} AND ts >= ? GROUP BY day ORDER BY day`).all(since);
    const byOffer = db.prepare(`SELECT CASE WHEN kind = 'ai_pack' THEN 'ai_pack' ELSE offer END offer, SUM(amount) amount, COUNT(*) n FROM payments WHERE ${paid} AND ts >= ? GROUP BY 1 ORDER BY amount DESC`).all(since);
    const byMethod = db.prepare(`SELECT method, SUM(amount) amount, COUNT(*) n FROM payments WHERE ${paid} AND ts >= ? GROUP BY method ORDER BY amount DESC`).all(since);
    const gifts = one("SELECT COUNT(*) n, COALESCE(SUM(days), 0) days FROM payments WHERE method = 'gift' AND refunded = 0 AND ts >= ?", since);
    const refunds = one('SELECT COUNT(*) n, COALESCE(SUM(amount), 0) amount FROM payments WHERE refunded = 1 AND refunded_at >= ?', since);
    const buyers = one(`SELECT COUNT(DISTINCT user_id) n FROM payments WHERE ${paid} AND ts >= ? AND user_id IS NOT NULL`, since).n;
    const premiumActive = one("SELECT COUNT(*) n FROM users WHERE plan = 'premium' AND (premium_until IS NULL OR premium_until >= ?)", today()).n;
    const expiring7 = one("SELECT COUNT(*) n FROM users WHERE plan = 'premium' AND premium_until BETWEEN ? AND ?", today(), addDays(today(), 7)).n;
    // Coût de l'IA : caractères envoyés et reçus → jetons (≈ 4 caractères) → dollars → francs CFA.
    const cost = (cin, cout) => ((cin / 4 / 1e6) * s.ai_usd_per_m_in + (cout / 4 / 1e6) * s.ai_usd_per_m_out) * s.usd_xof;
    const ai = one('SELECT COUNT(*) requests, COALESCE(SUM(chars_in), 0) cin, COALESCE(SUM(chars_out), 0) cout, COUNT(DISTINCT user_id) users FROM ai_usage WHERE ok = 1 AND ts >= ?', since);
    const aiCost = Math.round(cost(ai.cin, ai.cout));
    const aiByDay = db.prepare("SELECT date(ts / 1000, 'unixepoch') day, SUM(chars_in) cin, SUM(chars_out) cout, COUNT(*) n FROM ai_usage WHERE ok = 1 AND ts >= ? GROUP BY day ORDER BY day").all(since)
      .map((r) => ({ day: r.day, requests: r.n, cost: Math.round(cost(r.cin, r.cout)) }));
    // Prix Google Play : majorés pour compenser la commission de 15 %, arrondis à 50 F. « net » = ce que vous touchez.
    const play = (price) => { const p = Math.round((price * (1 + s.play_markup_pct / 100)) / 50) * 50; return { base: price, price: p, net: Math.round(p * 0.85) }; };
    ok(res, {
      days, currency: 'XOF', total: totals.amount, count: totals.n, month: month.amount, month_count: month.n, buyers,
      average: totals.n ? Math.round(totals.amount / totals.n) : 0, by_day: byDay, by_offer: byOffer, by_method: byMethod,
      gifts, refunds, premium_active: premiumActive, premium_expiring_7d: expiring7,
      ai: { requests: ai.requests, users: ai.users, cost: aiCost, cost_per_request: ai.requests ? Math.round((aiCost / ai.requests) * 100) / 100 : 0, by_day: aiByDay },
      margin: totals.amount - aiCost,
      play: { markup_pct: s.play_markup_pct, week: play(s.price_week), month: play(s.price_month), year: play(s.price_year), ai_pack: play(s.ai_pack_price) },
    });
  });

  // ------------------------------------------------------------- Codes promo et parrainage
  // Code promo : Premium offert N jours, crédits IA, ou remise (%) gardée pour le prochain paiement.
  // Parrainage : chaque compte a un code ; quand un filleul fait son PREMIER paiement, le parrain reçoit N jours de Premium
  // (rien à l'inscription : impossible de tricher avec de faux comptes).
  const normCode = (c) => String(c || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 30);
  const refCodeOf = (u) => {
    if (u.ref_code) return u.ref_code;
    let code;
    do code = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 7); while (db.prepare('SELECT 1 FROM users WHERE ref_code = ?').get(code));
    db.prepare('UPDATE users SET ref_code = ? WHERE id = ?').run(code, u.id);
    return code;
  };
  /** Premium prolongé de N jours (à partir de l'échéance en cours), consigné comme un Premium offert. */
  const grantPremiumDays = (u, days, reason, actor) => {
    const from = u.plan === 'premium' && u.premium_until && u.premium_until >= today() ? u.premium_until : today();
    const until = addDays(from, days);
    const included = Number(getSettings(db).plans.premium.ai_credits) || 0;
    db.prepare("UPDATE users SET plan = 'premium', premium_until = ?, ai_credits = MAX(ai_credits, ?), credits_month = ? WHERE id = ?").run(until, included, today().slice(0, 7), u.id);
    planChange(u.id, actor, u.plan, 'premium', until, reason);
    db.prepare(`INSERT INTO payments (ts, user_id, user_email, kind, offer, amount, method, days, premium_until, actor, note) VALUES (?, ?, ?, 'premium', 'custom', 0, 'gift', ?, ?, ?, ?)`)
      .run(Date.now(), u.id, u.email, days, until, actor, reason);
    return until;
  };
  app.locals.grantPremiumDays = grantPremiumDays;

  /** Récompense du parrain au premier paiement de son filleul (appelée après chaque paiement enregistré). */
  function rewardReferrer(u) {
    const r = getSettings(db).referral;
    if (!r.enabled || !u.referred_by || u.referral_rewarded) return;
    const paid = db.prepare("SELECT COUNT(*) n FROM payments WHERE user_id = ? AND method != 'gift' AND refunded = 0 AND amount > 0").get(u.id).n;
    if (paid !== 1) return;
    const parrain = db.prepare('SELECT * FROM users WHERE id = ?').get(u.referred_by);
    db.prepare('UPDATE users SET referral_rewarded = 1 WHERE id = ?').run(u.id);
    if (parrain && r.referrer_days > 0) grantPremiumDays(parrain, r.referrer_days, `Parrainage : premier paiement de ${u.email}`, 'parrainage');
  }
  app.locals.rewardReferrer = rewardReferrer;

  // Utilisateur : saisir un code promo
  app.post('/api/me/redeem', userAuth(true), (req, res) => {
    const code = normCode(req.body?.code);
    const p = code && db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code);
    if (!p || !p.active) return fail(res, 404, 'Code inconnu ou désactivé');
    if (p.expires && p.expires < today()) return fail(res, 400, 'Ce code a expiré');
    if (p.max_uses > 0 && p.uses >= p.max_uses) return fail(res, 400, "Ce code a déjà été utilisé le nombre de fois prévu");
    if (db.prepare('SELECT 1 FROM promo_redemptions WHERE code = ? AND user_id = ?').get(code, req.user.id)) return fail(res, 400, 'Vous avez déjà utilisé ce code');
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    let message;
    if (p.kind === 'premium_days') message = `Premium activé jusqu'au ${new Date(grantPremiumDays(u, p.value, `Code promo ${code}`, 'code promo')).toLocaleDateString('fr-FR')}`;
    else if (p.kind === 'ai_credits') { db.prepare('UPDATE users SET ai_credits = ai_credits + ? WHERE id = ?').run(p.value, u.id); message = `${p.value} crédits IA ajoutés`; }
    else { db.prepare('UPDATE users SET pending_discount = ? WHERE id = ?').run(`${code}:${p.value}`, u.id); message = `Remise de ${p.value} % enregistrée pour votre prochain paiement`; }
    db.prepare('UPDATE promo_codes SET uses = uses + 1 WHERE code = ?').run(code);
    db.prepare('INSERT INTO promo_redemptions (code, user_id, ts) VALUES (?, ?, ?)').run(code, u.id, Date.now());
    ok(res, { message, user: selfUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
  });

  // Utilisateur : son lien de parrainage
  app.get('/api/me/referral', userAuth(true), (req, res) => {
    const r = getSettings(db).referral;
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const code = refCodeOf(u);
    const base = publicUrl(getSettings(db)) || 'https://pagio.site';
    ok(res, {
      enabled: r.enabled, code, link: `${base}/?ref=${code}`, referrer_days: r.referrer_days,
      invited: db.prepare('SELECT COUNT(*) n FROM users WHERE referred_by = ?').get(u.id).n,
      rewarded: db.prepare('SELECT COUNT(*) n FROM users WHERE referred_by = ? AND referral_rewarded = 1').get(u.id).n,
    });
  });

  // Tableau de bord : codes promo
  app.get('/api/admin/promo', adminAuth(), (req, res) => {
    const codes = db.prepare('SELECT * FROM promo_codes ORDER BY created_at DESC').all();
    const s = getSettings(db).referral;
    ok(res, {
      codes, referral: s,
      referral_stats: {
        invited: db.prepare('SELECT COUNT(*) n FROM users WHERE referred_by IS NOT NULL').get().n,
        rewarded: db.prepare('SELECT COUNT(*) n FROM users WHERE referral_rewarded = 1').get().n,
        top: db.prepare(`SELECT p.email, COUNT(*) invited, SUM(f.referral_rewarded) paid FROM users f JOIN users p ON p.id = f.referred_by GROUP BY p.id ORDER BY invited DESC LIMIT 10`).all(),
      },
      redemptions: db.prepare('SELECT r.code, r.ts, u.email FROM promo_redemptions r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.ts DESC LIMIT 100').all(),
    });
  });
  app.post('/api/admin/promo', adminAuth('admin'), (req, res) => {
    const b = req.body || {};
    const code = normCode(b.code);
    if (code.length < 3) return fail(res, 400, 'Code : 3 caractères au moins (lettres, chiffres, - et _)');
    if (!['premium_days', 'ai_credits', 'discount_pct'].includes(b.kind)) return fail(res, 400, 'Type de code inconnu');
    const value = int(b.value, 1, b.kind === 'discount_pct' ? 100 : 100000, 0);
    if (!value) return fail(res, 400, 'Valeur invalide');
    if (db.prepare('SELECT 1 FROM promo_codes WHERE code = ?').get(code)) return fail(res, 409, 'Ce code existe déjà');
    const expires = /^\d{4}-\d{2}-\d{2}$/.test(String(b.expires || '')) ? b.expires : null;
    db.prepare('INSERT INTO promo_codes (code, kind, value, max_uses, uses, expires, note, active, created_at) VALUES (?, ?, ?, ?, 0, ?, ?, 1, ?)')
      .run(code, b.kind, value, int(b.max_uses, 0, 1_000_000, 0), expires, String(b.note || '').slice(0, 200), Date.now());
    audit(req.admin, 'promo.create', code, { kind: b.kind, value, max_uses: b.max_uses, expires });
    ok(res, { code: db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code) });
  });
  app.patch('/api/admin/promo/:code', adminAuth('admin'), (req, res) => {
    const code = normCode(req.params.code);
    if (!db.prepare('SELECT 1 FROM promo_codes WHERE code = ?').get(code)) return fail(res, 404, 'Code introuvable');
    db.prepare('UPDATE promo_codes SET active = ? WHERE code = ?').run(req.body?.active ? 1 : 0, code);
    audit(req.admin, req.body?.active ? 'promo.enable' : 'promo.disable', code);
    ok(res, { ok: true });
  });

  // ------------------------------------------------------------- Outils
  app.get('/api/admin/tools', adminAuth(), (req, res) => {
    const since = Date.now() - 30 * DAY;
    const count = (name) => Object.fromEntries(db.prepare('SELECT tool, COUNT(*) n FROM events WHERE name = ? AND ts >= ? GROUP BY tool').all(name, since).map((r) => [r.tool, r.n]));
    const usage = count('tool_run');
    // Combien de fois la limite gratuite a été atteinte : pour ajuster les réglages sans nouvelle APK.
    const blocked = count('limit_reached');
    ok(res, { tools: db.prepare('SELECT * FROM tools').all().sort((a, b) => TOOL_IDS.indexOf(a.id) - TOOL_IDS.indexOf(b.id))
      .map((t) => ({ ...t, enabled: !!t.enabled, premium: !!t.premium, pdf_premium: !!t.pdf_premium, runs_30d: usage[t.id] || 0, limit_hits_30d: blocked[t.id] || 0 })) });
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
      daily_free: 'daily_free' in b ? Math.min(Math.max(0, Math.round(Number(b.daily_free)) || 0), 10_000) : t.daily_free,
      max_pages: 'max_pages' in b ? Math.min(Math.max(0, Math.round(Number(b.max_pages)) || 0), 1000) : t.max_pages,
      pdf_premium: 'pdf_premium' in b ? (b.pdf_premium ? 1 : 0) : t.pdf_premium,
    };
    db.prepare('UPDATE tools SET enabled = ?, premium = ?, max_files = ?, max_mb = ?, daily_free = ?, max_pages = ?, pdf_premium = ? WHERE id = ?')
      .run(next.enabled, next.premium, next.max_files, next.max_mb, next.daily_free, next.max_pages, next.pdf_premium, t.id);
    audit(req.admin, 'tool.update', t.id, next);
    ok(res, { tool: { id: t.id, ...next, enabled: !!next.enabled, premium: !!next.premium, pdf_premium: !!next.pdf_premium } });
  });

  // ------------------------------------------------------------- Réglages de l'application
  // La clé n'est jamais renvoyée au navigateur : seuls ses 4 derniers caractères sont affichés.
  const masked = (s) => {
    const key = aiConfig(s).api_key;
    const mk = mailConfig(s).api_key;
    const { mail_alert_state: _state, firebase: _fb, notify_state: _ns, ...rest } = s;
    return {
      ...rest,
      ai: { ...s.ai, api_key: key ? `••••${key.slice(-4)}` : '', has_key: !!key, key_from_env: !!process.env.AI_API_KEY, key_error: !!s.ai.key_error },
      mail: { ...s.mail, api_key: mk ? `••••${mk.slice(-4)}` : '', has_key: !!mk, key_from_env: !!process.env.MAIL_API_KEY, key_error: !!s.mail.key_error },
    };
  };
  const int = (v, min, max, fallback) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback; };

  app.get('/api/admin/settings', adminAuth(), (req, res) => ok(res, { settings: masked(getSettings(db)), libreoffice: libreOfficeAvailable() }));

  app.put('/api/admin/settings', adminAuth('admin'), (req, res) => {
    const b = req.body || {};
    const current = getSettings(db);
    const allowed = ['maintenance', 'maintenance_message', 'announcement', 'announcement_level', 'min_version_code', 'latest_version_name',
      'update_url', 'support_email', 'conversion_enabled', 'plans', 'ai', 'registration_open', 'limits', 'backup', 'mail', 'google_client_id', 'sales', 'monitor', 'referral', 'ga_id'];
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
      if (k === 'mail') {
        const m = { ...current.mail, ...(v || {}) };
        const text = (x, max) => String(x ?? '').trim().slice(0, max);
        v = {
          enabled: !!m.enabled, from_email: text(m.from_email, 200).toLowerCase(), from_name: text(m.from_name, 80) || 'Pagio',
          public_url: text(m.public_url, 200).replace(/\/+$/, ''), verify_signup: !!m.verify_signup,
          alerts_enabled: !!m.alerts_enabled, alerts_to: text(m.alerts_to, 200).toLowerCase(), weekly_report: m.weekly_report !== false,
          api_key: typeof b.mail.api_key !== 'string' || b.mail.api_key.startsWith('••••') ? current.mail.api_key : b.mail.api_key.trim(), // clé inchangée
        };
        if (v.from_email && !emailOk(v.from_email)) return fail(res, 400, "Adresse d'expéditeur invalide");
        if (v.alerts_to && !emailOk(v.alerts_to)) return fail(res, 400, 'Adresse de réception des alertes invalide');
        if (v.public_url && !/^https?:\/\/[^\s/]+/.test(v.public_url)) return fail(res, 400, 'Adresse publique invalide (elle doit commencer par https://)');
        // Les liens des e-mails sont ouverts par les utilisateurs : l'adresse de l'administration leur est fermée.
        if (/^https?:\/\/admin\./i.test(v.public_url)) return fail(res, 400, "L'adresse publique doit être celle du site ouvert aux utilisateurs (ex. https://pagio.site), pas celle de l'administration");
        if (v.api_key !== current.mail.api_key) setSetting(db, 'mail_key_check', null); // nouvelle clé : nouvelle vérification
        if (v.enabled && (!v.from_email || !(v.api_key || process.env.MAIL_API_KEY))) return fail(res, 400, "Pour activer les e-mails, renseignez la clé Brevo et l'adresse d'expéditeur");
      }
      if (k === 'ga_id') {
        v = String(v || '').trim().toUpperCase();
        if (v && !/^G-[A-Z0-9]{4,20}$/.test(v)) return fail(res, 400, 'Identifiant Google Analytics invalide (il commence par G-)');
      }
      if (k === 'referral') {
        const c = { ...current.referral, ...(v || {}) };
        v = { enabled: !!c.enabled, referrer_days: int(c.referrer_days, 0, 365, current.referral.referrer_days) };
      }
      if (k === 'monitor') {
        const c = { ...current.monitor, ...(v || {}) };
        const m = current.monitor;
        v = {
          disk_warn_pct: int(c.disk_warn_pct, 1, 90, m.disk_warn_pct), disk_crit_pct: int(c.disk_crit_pct, 1, 90, m.disk_crit_pct),
          mem_warn_pct: int(c.mem_warn_pct, 10, 100, m.mem_warn_pct), cpu_warn_pct: int(c.cpu_warn_pct, 10, 100, m.cpu_warn_pct),
          rt_warn_ms: int(c.rt_warn_ms, 100, 60000, m.rt_warn_ms), cert_warn_days: int(c.cert_warn_days, 1, 90, m.cert_warn_days),
          disk_forecast_days: int(c.disk_forecast_days, 1, 365, m.disk_forecast_days),
          other_sites_alerts: !!c.other_sites_alerts,
          sites_ignored: Array.isArray(c.sites_ignored) ? [...new Set(c.sites_ignored.map((x) => String(x).toLowerCase().slice(0, 253)))].slice(0, 100) : m.sites_ignored,
        };
        if (v.disk_crit_pct >= v.disk_warn_pct) return fail(res, 400, "Le seuil critique du disque doit être plus bas que le seuil d'avertissement");
      }
      if (k === 'sales') {
        const c = { ...current.sales, ...(v || {}) };
        const money = (x, fb) => int(x, 0, 100_000_000, fb);
        const dec = (x, fb, max) => { const n = Number(x); return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 1000) / 1000 : fb; };
        v = {
          price_week: money(c.price_week, current.sales.price_week), price_month: money(c.price_month, current.sales.price_month),
          price_year: money(c.price_year, current.sales.price_year), ai_pack_credits: int(c.ai_pack_credits, 1, 1_000_000, current.sales.ai_pack_credits),
          ai_pack_price: money(c.ai_pack_price, current.sales.ai_pack_price), play_markup_pct: dec(c.play_markup_pct, current.sales.play_markup_pct, 100),
          usd_xof: dec(c.usd_xof, current.sales.usd_xof, 100000), ai_usd_per_m_in: dec(c.ai_usd_per_m_in, current.sales.ai_usd_per_m_in, 1000),
          ai_usd_per_m_out: dec(c.ai_usd_per_m_out, current.sales.ai_usd_per_m_out, 1000),
        };
      }
      if (k === 'plans') v = { free: { ...current.plans.free, ...(v.free || {}) }, premium: { ...current.plans.premium, ...(v.premium || {}) } };
      if (k === 'min_version_code') v = Math.max(0, Number(v) || 0);
      if (k === 'google_client_id') {
        v = String(v || '').trim();
        if (v && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(v)) return fail(res, 400, "Identifiant client Google invalide (il se termine par .apps.googleusercontent.com)");
      }
      setSetting(db, k, v);
      changed.push(k);
    }
    audit(req.admin, 'settings.update', changed.join(','), Object.fromEntries(changed.filter((k) => k !== 'ai' && k !== 'mail').map((k) => [k, b[k]])));
    ok(res, { settings: masked(getSettings(db)) });
  });

  app.post('/api/admin/ai/test', adminAuth('admin'), async (req, res) => {
    const s = getSettings(db);
    try { ok(res, { text: (await aiComplete(aiConfig(s), 'Réponds en une phrase courte.', [{ role: 'user', content: 'Dis bonjour en français.' }], 40)).slice(0, 200) }); }
    catch (e) { fail(res, 502, e.message); }
  });

  // E-mail d'essai : envoyé avec les réglages enregistrés, à l'adresse indiquée (par défaut celle de l'administrateur).
  app.post('/api/admin/mail/test', adminAuth('admin'), async (req, res) => {
    const s = getSettings(db);
    const to = String(req.body?.to || req.admin.email).trim().toLowerCase();
    if (!emailOk(to)) return fail(res, 400, 'Adresse de destination invalide');
    try {
      await sendMail(mailConfig(s), { to, ...messages.test() });
      audit(req.admin, 'mail.test', to);
      ok(res, { message: `E-mail d'essai envoyé à ${to}.` });
    } catch (e) { fail(res, 502, `Envoi refusé : ${e.message}`); }
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

  app.get('/api/admin/feedback', adminAuth(), (req, res) => {
    const replies = db.prepare('SELECT * FROM feedback_replies ORDER BY ts').all();
    const feedback = db.prepare(`SELECT f.*, u.email user_email FROM feedback f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.ts DESC LIMIT 300`).all()
      .map((f) => ({ ...f, replies: replies.filter((r) => r.feedback_id === f.id) }));
    ok(res, { feedback, templates: getSettings(db).support_templates });
  });
  // Répondre à un message : e-mail envoyé à l'adresse du message (ou du compte), réponse possible vers contact@pagio.site.
  app.post('/api/admin/feedback/:id/reply', adminAuth('support'), async (req, res) => {
    const f = db.prepare('SELECT f.*, u.email user_email FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.id = ?').get(Number(req.params.id));
    if (!f) return fail(res, 404, 'Message introuvable');
    const message = String(req.body?.message || '').trim().slice(0, 5000);
    if (message.length < 2) return fail(res, 400, 'Écrivez la réponse');
    const to = emailOk(f.email) ? f.email : f.user_email;
    if (!emailOk(to)) return fail(res, 400, "Cette personne n'a pas laissé d'adresse e-mail : impossible de lui répondre.");
    const s = getSettings(db);
    if (!mailReady(s)) return fail(res, 400, "Les e-mails ne sont pas activés (page E-mails).");
    try {
      await sendMail(mailConfig(s), { to, replyTo: s.support_email || 'contact@pagio.site', ...messages.supportReply(f.message, message) });
    } catch (e) {
      logServerError(db, 'email', e, { method: req.method, path: req.path, status: 502 });
      return fail(res, 502, `Réponse non envoyée : ${e.message}`);
    }
    db.prepare('INSERT INTO feedback_replies (feedback_id, ts, admin_email, message, sent) VALUES (?, ?, ?, ?, 1)').run(f.id, Date.now(), req.admin.email, message);
    const status = ['nouveau', 'en cours', 'traité'].includes(req.body?.status) ? req.body.status : 'traité';
    db.prepare('UPDATE feedback SET status = ? WHERE id = ?').run(status, f.id);
    audit(req.admin, 'feedback.reply', to, { id: f.id, status });
    ok(res, { sent: true, to });
  });
  app.put('/api/admin/support/templates', adminAuth('admin'), (req, res) => {
    const list = Array.isArray(req.body?.templates) ? req.body.templates : null;
    if (!list) return fail(res, 400, 'Format invalide');
    const clean = list.slice(0, 30).map((t) => ({ title: String(t?.title || '').trim().slice(0, 60), body: String(t?.body || '').trim().slice(0, 3000) })).filter((t) => t.title && t.body);
    setSetting(db, 'support_templates', clean);
    audit(req.admin, 'support.templates', null, { count: clean.length });
    ok(res, { templates: clean });
  });
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
      days, libreoffice: libreOfficeAvailable(), running: runningConversions, waiting: waiting.length, queue: queueStats,
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

  /**
   * Disponibilité, d'après le gardien qui tourne sur le VPS hors du conteneur (server/deploy/pagio-gardien.sh) :
   * pannes des 30 derniers jours, pourcentage de disponibilité, certificats HTTPS. null si le gardien n'est pas installé.
   */
  function availability(now = Date.now()) {
    const dir = dataDir && path.join(dataDir, 'gardien');
    if (!dir || !fs.existsSync(dir)) return null;
    const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return null; } };
    const since = now - 30 * DAY;
    const incidents = String(read('incidents.jsonl') || '').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((i) => i && i.fin * 1000 >= since)
      .map((i) => ({ debut: i.debut * 1000, fin: i.fin * 1000, duree_s: i.duree_s, redemarre: !!i.redemarre }))
      .sort((a, b) => b.debut - a.debut);
    const down = incidents.reduce((n, i) => n + Math.max(0, i.fin - Math.max(i.debut, since)), 0);
    let certificats = [];
    // Certificats de Pagio seulement : ceux des autres sites du VPS sont suivis dans « Sites hébergés » (alerte désactivable).
    try { certificats = JSON.parse(read('certificats.json') || '[]').filter((c) => /pagio/.test(`${c.domaine} ${c.noms || ''}`)).map((c) => ({ ...c, expire: c.expire * 1000, jours: Math.floor((c.expire * 1000 - now) / DAY) })); } catch { /* fichier en cours d'écriture */ }
    const last = Number(read('derniere-verification')) * 1000 || 0;
    return { incidents, disponibilite_30j: Math.round((1 - down / (30 * DAY)) * 10000) / 100, derniere_verification: last, gardien_actif: now - last < 10 * 60_000, certificats };
  }

  /** Points à surveiller, du plus grave au moins grave. `page` : page du tableau de bord où agir. */
  function alerts() {
    const s = getSettings(db);
    const m = machine();
    const out = [];
    const add = (level, code, message, page) => out.push({ level, code, message, page });
    const now = Date.now();
    const mon = s.monitor;
    if (m.disk && m.disk.total_mb > 0) {
      const pct = Math.round((m.disk.free_mb / m.disk.total_mb) * 100);
      if (pct < mon.disk_crit_pct || m.disk.free_mb < 500) add('critical', 'disk', `Disque presque plein : ${pct} % libre (${m.disk.free_mb} Mo). Le serveur s'arrêtera s'il est saturé.`, 'system');
      else if (pct < mon.disk_warn_pct) add('warning', 'disk', `Espace disque faible : ${pct} % libre.`, 'system');
    }
    // Mesures du gardien (15 dernières minutes) : mémoire réelle du VPS, processeur, temps de réponse.
    const recent = mesures().filter((r) => r.t * 1000 >= now - 15 * 60_000);
    if (recent.length >= 5) {
      const memPct = Math.round(recent.reduce((n, r) => n + (r.mem_total ? ((r.mem_total - r.mem_dispo) / r.mem_total) * 100 : 0), 0) / recent.length);
      const cpu = Math.round(recent.reduce((n, r) => n + r.cpu, 0) / recent.length);
      const t95 = Math.max(...recent.map((r) => r.t95));
      if (memPct >= mon.mem_warn_pct) add('warning', 'memory', `Mémoire du serveur occupée à ${memPct} % depuis 15 minutes.`, 'system');
      if (cpu >= mon.cpu_warn_pct) add('warning', 'cpu', `Processeur occupé à ${cpu} % en moyenne depuis 15 minutes.`, 'system');
      if (t95 >= mon.rt_warn_ms) add('warning', 'slow', `Pagio répond lentement : jusqu'à ${(t95 / 1000).toLocaleString('fr-FR')} s sur les 15 dernières minutes.`, 'system');
    } else if (m.mem_total_mb > 0 && m.mem_free_mb / m.mem_total_mb < 0.08) add('warning', 'memory', `Mémoire presque saturée : ${m.mem_free_mb} Mo libres sur ${m.mem_total_mb} Mo.`, 'system');
    const fc = diskForecast(mesures());
    if (fc && fc.days_to_full !== null && fc.days_to_full <= mon.disk_forecast_days) add('warning', 'disk_forecast', `Au rythme actuel (${fc.mb_per_day} Mo par jour), le disque sera plein dans ${fc.days_to_full} jour(s).`, 'system');
    // Par défaut, seulement les adresses de Pagio ; les autres sites du VPS restent visibles dans le module Système.
    const watched = sites(now).filter((x) => !x.ignore && (mon.other_sites_alerts || /pagio/.test(x.domaine)));
    const down = watched.filter((x) => !x.ok);
    if (down.length) add('warning', 'sites', `${down.length} site(s) du serveur ne répondent pas : ${down.map((x) => x.domaine).join(', ')}.`, 'system');
    const certs = watched.filter((x) => x.cert_jours !== null && x.cert_jours < mon.cert_warn_days);
    if (certs.length) add('warning', 'sites_cert', `Certificat HTTPS bientôt expiré : ${certs.map((x) => `${x.domaine} (${x.cert_jours} j)`).join(', ')}.`, 'system');
    if (s.ai.key_error) add('critical', 'ai_key', "La clé d'IA ne peut plus être déchiffrée : saisissez-la de nouveau.", 'ai');
    else if (s.ai.enabled && !aiConfig(s).api_key && !s.ai.base_url) add('warning', 'ai_key', "L'IA est activée mais aucune clé d'API n'est enregistrée.", 'ai');
    if (s.mail.key_error) add('critical', 'mail_key', 'La clé Brevo ne peut plus être déchiffrée : saisissez-la de nouveau.', 'mail');
    else if (!mailReady(s)) add('info', 'mail', 'Les e-mails automatiques ne sont pas activés : les mots de passe oubliés sont à traiter à la main.', 'mail');
    else if (!linksReady(s)) add('warning', 'mail_url', "Adresse publique du site manquante (page E-mails) : les e-mails « mot de passe oublié » et de confirmation ne partent pas.", 'mail');
    const mailErrors = db.prepare("SELECT COUNT(*) n FROM server_errors WHERE source = 'email' AND ts >= ?").get(now - DAY).n;
    if (mailErrors > 0) add('warning', 'mail_errors', `${mailErrors} e-mail(s) n'ont pas pu être envoyés en 24 heures.`, 'errors');
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
    const av = availability(now);
    if (av) {
      if (!av.gardien_actif) add('warning', 'watchdog', 'Le gardien du serveur ne tourne plus : les pannes ne sont plus surveillées ni réparées automatiquement.', 'system');
      for (const c of av.certificats) {
        if (c.jours < 5) add('critical', 'cert', `Le certificat HTTPS de ${c.domaine} expire dans ${Math.max(c.jours, 0)} jour(s) : le site sera bloqué par les navigateurs.`, 'system');
        else if (c.jours < 14) add('warning', 'cert', `Le certificat HTTPS de ${c.domaine} expire dans ${c.jours} jours et ne s'est pas encore renouvelé.`, 'system');
      }
      const recent = av.incidents.filter((i) => i.fin > now - DAY);
      if (recent.length) {
        const min = Math.ceil(recent.reduce((n, i) => n + i.duree_s, 0) / 60);
        add('warning', 'outage', `Pagio a été indisponible ${recent.length} fois en 24 heures (${min} min au total)${recent.some((i) => i.redemarre) ? ', redémarré automatiquement' : ''}.`, 'system');
      }
    }
    const kc = s.mail_key_check;
    if (mailReady(s) && kc && !kc.ok && kc.status === 401) add('critical', 'mail_key_refused', `${kc.message} : les e-mails ne partent plus. Créez une nouvelle clé dans Brevo et collez-la ici.`, 'mail');
    const rank = { critical: 0, warning: 1, info: 2 };
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  }

  app.get('/api/admin/alerts', adminAuth(), (req, res) => ok(res, { alerts: alerts() }));

  // ------------------------------------------------------------- Notifications de l'APK admin
  // Chaque téléphone reçoit une clé de notification, créée depuis le tableau de bord (dans l'APK admin, automatiquement).
  // Elle ne permet QUE de lire le flux de notifications : ni données d'utilisateurs, ni réglages. Révocable à tout moment.
  // Seule l'empreinte de la clé est en base. Comme tout /api/admin, le flux n'existe que sur admin.pagio.site (certificat d'appareil).
  const notifyLimit = rateLimiter(120, HOUR);
  app.get('/api/admin/notify/devices', adminAuth(), (req, res) => ok(res, {
    kinds: NOTIFY_KINDS,
    firebase: { client: !!firebaseConf().client?.app_id, service: !!firebaseService() },
    devices: db.prepare('SELECT d.id, d.admin_id, d.name, d.created_at, d.last_seen, d.prefs, d.fcm_token IS NOT NULL push, d.fcm_at, a.email admin_email FROM notify_devices d JOIN admins a ON a.id = d.admin_id WHERE d.revoked = 0 ORDER BY d.created_at DESC').all()
      .map(({ prefs, push, admin_id, ...d }) => ({ ...d, push: !!push, mine: admin_id === req.admin.id, prefs: parsePrefs(prefs) })),
  }));
  app.post('/api/admin/notify/devices', adminAuth(), (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 60) || 'Téléphone';
    const token = newToken();
    db.prepare('INSERT INTO notify_devices (admin_id, name, token_hash, created_at) VALUES (?, ?, ?, ?)').run(req.admin.id, name, hashToken(token), Date.now());
    audit(req.admin, 'notify.device_add', name);
    ok(res, { token });
  });
  app.delete('/api/admin/notify/devices/:id', adminAuth(), (req, res) => {
    const d = db.prepare('SELECT * FROM notify_devices WHERE id = ? AND revoked = 0').get(Number(req.params.id));
    if (!d) return fail(res, 404, 'Appareil inconnu');
    if (d.admin_id !== req.admin.id && ROLES[req.admin.role] < ROLES.admin) return fail(res, 403, 'Droits insuffisants pour cette action');
    db.prepare('UPDATE notify_devices SET revoked = 1 WHERE id = ?').run(d.id);
    audit(req.admin, 'notify.device_revoke', d.name);
    ok(res, { revoked: true });
  });
  const ownDevice = (req, res) => {
    const d = db.prepare('SELECT * FROM notify_devices WHERE id = ? AND revoked = 0').get(Number(req.params.id));
    if (!d) { fail(res, 404, 'Téléphone introuvable'); return null; }
    if (d.admin_id !== req.admin.id && ROLES[req.admin.role] < ROLES.admin) { fail(res, 403, 'Droits insuffisants pour cette action'); return null; }
    return d;
  };
  /** Cases à cocher d'un téléphone : ce qu'il reçoit (et s'il reste silencieux la nuit). */
  app.put('/api/admin/notify/devices/:id/prefs', adminAuth(), (req, res) => {
    const d = ownDevice(req, res); if (!d) return;
    const prefs = cleanPrefs(req.body);
    db.prepare('UPDATE notify_devices SET prefs = ? WHERE id = ?').run(JSON.stringify(prefs), d.id);
    audit(req.admin, 'notify.prefs', d.name, prefs);
    ok(res, { prefs });
  });
  /** Notification d'essai, envoyée à ce seul téléphone (quelles que soient ses cases). */
  app.post('/api/admin/notify/devices/:id/test', adminAuth(), async (req, res) => {
    const d = ownDevice(req, res); if (!d) return;
    notifyEvent('test', 'info', 'Essai Pagio Admin', 'Les notifications arrivent bien sur ce téléphone.', d.id);
    const sent = await app.locals.lastPush;
    ok(res, { instant: sent > 0, message: sent > 0 ? 'Notification envoyée : elle doit arriver dans quelques secondes.' : 'Notification prête : elle arrivera à la prochaine vérification (15 min au plus), Firebase n’étant pas encore actif sur ce téléphone.' });
  });

  /** Réglage Firebase (propriétaire) : on colle google-services.json puis la clé de compte de service. */
  app.get('/api/admin/firebase', adminAuth('owner'), (req, res) => {
    const f = firebaseConf();
    ok(res, { client: f.client ? { project_id: f.client.project_id, app_id: f.client.app_id } : null, service: f.service ? { project_id: f.service.project_id, client_email: f.service.client_email } : null });
  });
  app.put('/api/admin/firebase', adminAuth('owner'), (req, res) => {
    let part;
    try { part = parseFirebaseJson(req.body?.json); } catch (e) { return fail(res, 400, e.message); }
    const f = firebaseConf();
    if (part.client) f.client = part.client;
    if (part.service) f.service = { ...part.service, private_key: protect(db, part.service.private_key) };
    setSetting(db, 'firebase', f);
    audit(req.admin, 'firebase.update', part.client ? 'google-services.json' : 'clé de compte de service');
    ok(res, { saved: part.client ? 'client' : 'service' });
  });
  app.delete('/api/admin/firebase', adminAuth('owner'), (req, res) => {
    db.prepare("DELETE FROM settings WHERE key = 'firebase'").run();
    db.prepare('UPDATE notify_devices SET fcm_token = NULL').run();
    audit(req.admin, 'firebase.delete', null);
    ok(res, { ok: true });
  });

  /** Côté téléphone (clé de notification) : d'abord la configuration Firebase, puis l'enregistrement de son jeton. */
  const notifyDevice = (req, res) => {
    const token = String(req.get('x-pagio-notify') || '');
    if (!notifyLimit(`n:${req.ip}`)) { fail(res, 429, 'Trop de requêtes'); return null; }
    const d = token && db.prepare('SELECT * FROM notify_devices WHERE token_hash = ? AND revoked = 0').get(hashToken(token));
    if (!d) { fail(res, 401, 'Clé de notification inconnue ou révoquée'); return null; }
    if (!db.prepare('SELECT 1 FROM admins WHERE id = ? AND active = 1').get(d.admin_id)) { fail(res, 401, 'Administrateur désactivé'); return null; }
    return d;
  };
  app.get('/api/admin/notify/firebase', (req, res) => {
    if (!notifyDevice(req, res)) return;
    const c = firebaseConf().client;
    ok(res, c?.app_id && firebaseService() ? { enabled: true, ...c } : { enabled: false });
  });
  app.post('/api/admin/notify/push-token', (req, res) => {
    const d = notifyDevice(req, res); if (!d) return;
    const t = String(req.body?.token || '');
    if (!/^[\w:.-]{20,4096}$/.test(t)) return fail(res, 400, 'Jeton invalide');
    db.prepare('UPDATE notify_devices SET fcm_token = ?, fcm_at = ? WHERE id = ?').run(t, Date.now(), d.id);
    ok(res, { ok: true });
  });

  /** Flux lu toutes les 15 minutes par l'APK admin : alertes en cours, messages des utilisateurs, pannes récentes. */
  app.get('/api/admin/notify/feed', (req, res) => {
    const token = String(req.get('x-pagio-notify') || '');
    if (!notifyLimit(`n:${req.ip}`)) return fail(res, 429, 'Trop de requêtes');
    const d = token && db.prepare('SELECT * FROM notify_devices WHERE token_hash = ? AND revoked = 0').get(hashToken(token));
    if (!d) return fail(res, 401, 'Clé de notification inconnue ou révoquée');
    const a = db.prepare('SELECT * FROM admins WHERE id = ? AND active = 1').get(d.admin_id);
    if (!a) return fail(res, 401, 'Administrateur désactivé');
    db.prepare('UPDATE notify_devices SET last_seen = ? WHERE id = ?').run(Date.now(), d.id);
    const av = availability();
    const prefs = parsePrefs(d.prefs);
    // `since` absent (première lecture, ou APK 1.0.0) : seulement le numéro du dernier événement, pour partir de là.
    const since = req.query.since === undefined ? -1 : Math.max(0, Number(req.query.since) || 0);
    const quiet = prefs.quiet && isQuietHour();
    const rows = since >= 0 ? db.prepare('SELECT id, ts, kind, level, title, body FROM notify_events WHERE id > ? AND (device_id IS NULL OR device_id = ?) ORDER BY id LIMIT 100').all(since, d.id) : [];
    ok(res, {
      now: Date.now(),
      prefs,
      // Nouveau flux : événements cochés (et l'essai envoyé à ce téléphone), du plus ancien au plus récent.
      last_event: db.prepare('SELECT COALESCE(MAX(id), 0) n FROM notify_events').get().n,
      events: rows.filter((e) => (e.kind === 'test' ? true : wants(prefs, e.kind))).map((e) => ({ ...e, silent: quiet && e.level !== 'critical' })),
      // Jusqu'où le flux a été lu (événements décochés compris) : le téléphone reprend après ce numéro.
      scanned_to: rows.length ? rows.at(-1).id : Math.max(since, 0),
      // Ancien flux (APK 1.0.0), lui aussi limité aux cases cochées.
      alerts: alerts().filter((x) => x.level !== 'info' && wants(prefs, x.level === 'critical' ? 'critical' : 'warning')).map(({ code, level, message }) => ({ code, level, message })),
      feedback: prefs.kinds.feedback ? db.prepare("SELECT id, ts, kind, substr(message, 1, 140) message FROM feedback WHERE status = 'nouveau' ORDER BY ts DESC LIMIT 20").all() : [],
      incidents: prefs.kinds.outage ? (av?.incidents || []).slice(0, 10) : [],
    });
  });

  /**
   * Garde la clé Brevo active : Brevo la désactive après 90 jours sans usage. Un contact sans envoi au plus une fois
   * par semaine (relance au bout d'une heure si le précédent a échoué). Le résultat est gardé dans `mail_key_check` ;
   * une clé refusée devient une alerte critique. Appelée régulièrement par server.js ; renvoie le résultat ou null.
   */
  app.locals.keepMailKeyAlive = async ({ force = false } = {}) => {
    const s = getSettings(db);
    const m = mailConfig(s);
    if (!mailReady(s)) return null;
    const last = s.mail_key_check;
    const wait = last?.ok ? 7 * DAY : HOUR;
    if (!force && last && Date.now() - last.ts < wait) return null;
    const r = await checkMailKey(m.api_key);
    setSetting(db, 'mail_key_check', { ts: Date.now(), ok: r.ok, status: r.status, message: r.message });
    if (!r.ok && (!last || last.ok)) logServerError(db, 'email', new Error(r.message));
    return r;
  };

  /**
   * Chaque minute : une alerte qui apparaît (urgente ou à surveiller) et une panne réparée par le gardien deviennent
   * des événements de notification. Une même alerte n'est signalée qu'une fois tant qu'elle dure. Au tout premier
   * passage, l'état actuel est seulement mémorisé (pas de rafale de vieilles alertes).
   */
  app.locals.notifyTick = () => {
    const s = getSettings(db);
    const prev = s.notify_state && typeof s.notify_state === 'object' ? s.notify_state : null;
    const active = alerts().filter((a) => a.level !== 'info' && !['two_factor', 'feedback'].includes(a.code));
    const keys = Object.fromEntries(active.map((a) => [`${a.code}|${a.message}`, a]));
    const incidents = availability()?.incidents || [];
    const lastIncident = incidents.reduce((m, i) => Math.max(m, Number(i.debut) || 0), 0);
    let n = 0;
    if (prev) {
      for (const [k, a] of Object.entries(keys)) {
        if (prev.alerts?.includes(k)) continue;
        notifyEvent(a.level === 'critical' ? 'critical' : 'warning', a.level === 'critical' ? 'critical' : 'warning', a.level === 'critical' ? '⚠ Pagio : urgent' : 'Pagio : à surveiller', a.message); n++;
      }
      for (const i of incidents.filter((x) => Number(x.debut) > (prev.last_incident || 0)).sort((a, b) => a.debut - b.debut)) {
        const sec = Number(i.duree_s) || 0;
        notifyEvent('outage', 'warning', 'Panne réparée', `Pagio a été coupé ${sec < 60 ? `${sec} s` : `${Math.ceil(sec / 60)} min`} ; ${i.redemarre ? 'le gardien l’a redémarré' : 'il est revenu tout seul'}.`); n++;
      }
    }
    const next = { alerts: Object.keys(keys), last_incident: Math.max(lastIncident, prev?.last_incident || 0) };
    if (JSON.stringify(next) !== JSON.stringify(prev)) setSetting(db, 'notify_state', next);
    return n;
  };

  /**
   * Envoie par e-mail les alertes urgentes ou à surveiller. Une même alerte n'est renvoyée qu'une fois par 24 heures
   * tant qu'elle dure. Appelée régulièrement par server.js ; renvoie le nombre d'alertes envoyées.
   */
  app.locals.sendAlertEmails = async () => {
    const s = getSettings(db);
    if (!mailReady(s) || !s.mail.alerts_enabled || !emailOk(s.mail.alerts_to)) return 0;
    const now = Date.now();
    const state = s.mail_alert_state && typeof s.mail_alert_state === 'object' ? s.mail_alert_state : {};
    // Les soucis d'e-mail eux-mêmes et la double authentification (rappel permanent) ne sont pas envoyés par e-mail.
    const active = alerts().filter((a) => a.level !== 'info' && !['mail_errors', 'mail_key', 'two_factor'].includes(a.code));
    const due = active.filter((a) => !state[a.code] || now - state[a.code] > DAY);
    // Une alerte disparue est oubliée : si elle revient, elle sera signalée de nouveau tout de suite.
    const next = Object.fromEntries(active.filter((a) => state[a.code] && !due.includes(a)).map((a) => [a.code, state[a.code]]));
    if (due.length && await deliver(s, s.mail.alerts_to, messages.alerts(due, publicUrl(s)))) for (const a of due) next[a.code] = now;
    if (JSON.stringify(next) !== JSON.stringify(state)) setSetting(db, 'mail_alert_state', next);
    return due.length;
  };

  // ------------------------------------------------------------- Rapport hebdomadaire (lundi matin)
  const TOOL_NAMES = { merge: 'Fusionner', split: 'Diviser', compress: 'Compresser', scan: 'Scanner', pdf_to_word: 'PDF en Word', images_to_pdf: 'Images en PDF',
    sign: 'Signer', edit: 'Modifier', office_to_pdf: 'Office en PDF', assistant: 'Assistant IA', ocr: 'OCR', rotate: 'Pivoter', protect: 'Protéger' };
  function weeklyNumbers(end = Date.now()) {
    const s = getSettings(db).sales;
    const one = (sql, ...a) => db.prepare(sql).get(...a);
    const all = (sql, ...a) => db.prepare(sql).all(...a);
    const span = (from, to) => {
      const ai = one('SELECT COALESCE(SUM(chars_in), 0) cin, COALESCE(SUM(chars_out), 0) cout FROM ai_usage WHERE ok = 1 AND ts >= ? AND ts < ?', from, to);
      return {
        visitors: one("SELECT COUNT(DISTINCT date(ts / 1000, 'unixepoch') || visitor) n FROM site_hits WHERE ts >= ? AND ts < ?", from, to).n,
        installs: one("SELECT COUNT(*) n FROM events WHERE name = 'app_open' AND json_extract(props, '$.first_open') = 1 AND ts >= ? AND ts < ?", from, to).n,
        active: one("SELECT COUNT(DISTINCT device_id) n FROM events WHERE app_version != 'web' AND device_id != '' AND ts >= ? AND ts < ?", from, to).n,
        accounts: one('SELECT COUNT(*) n FROM users WHERE created_at >= ? AND created_at < ?', from, to).n,
        revenue: one("SELECT COALESCE(SUM(amount), 0) n FROM payments WHERE refunded = 0 AND method != 'gift' AND ts >= ? AND ts < ?", from, to).n,
        runs: one("SELECT COUNT(*) n FROM events WHERE name = 'tool_run' AND ts >= ? AND ts < ?", from, to).n,
        errors: one('SELECT COUNT(*) n FROM server_errors WHERE ts >= ? AND ts < ?', from, to).n,
        ai_cost: Math.round(((ai.cin / 4 / 1e6) * s.ai_usd_per_m_in + (ai.cout / 4 / 1e6) * s.ai_usd_per_m_out) * s.usd_xof),
      };
    };
    const from = end - 7 * DAY;
    const fmt = (t) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    return {
      period: `du ${fmt(from)} au ${fmt(end - 1)}`, ...span(from, end), prev: span(from - 7 * DAY, from),
      premium_active: one("SELECT COUNT(*) n FROM users WHERE plan = 'premium' AND (premium_until IS NULL OR premium_until >= ?)", today()).n,
      uptime: uptime(7, end),
      top_tools: all("SELECT tool k, COUNT(*) n FROM events WHERE name = 'tool_run' AND tool IS NOT NULL AND ts >= ? GROUP BY tool ORDER BY n DESC LIMIT 5", from).map((r) => ({ ...r, k: TOOL_NAMES[r.k] ?? r.k })),
      top_countries: all("SELECT json_extract(props, '$.country') k, COUNT(DISTINCT device_id) n FROM events WHERE name = 'app_open' AND ts >= ? AND json_extract(props, '$.country') IS NOT NULL GROUP BY k ORDER BY n DESC LIMIT 5", from),
      top_sources: all("SELECT source k, COUNT(DISTINCT date(ts / 1000, 'unixepoch') || visitor) n FROM site_hits WHERE ts >= ? GROUP BY source ORDER BY n DESC LIMIT 5", from),
    };
  }
  // Envoyé le lundi à partir de 7 h (heure d'Abidjan), une seule fois par semaine, à l'adresse des alertes (page E-mails).
  app.locals.sendWeeklyReport = async ({ force = false, now = new Date() } = {}) => {
    const s = getSettings(db);
    const to = s.mail.alerts_to;
    if (!mailReady(s) || !emailOk(to) || (!force && s.mail.weekly_report === false)) return false;
    const week = `${now.getUTCFullYear()}-${Math.floor((now - new Date(Date.UTC(now.getUTCFullYear(), 0, 1))) / (7 * DAY))}`;
    if (!force && (now.getUTCDay() !== 1 || now.getUTCHours() < 7 || s.weekly_report_sent === week)) return false;
    const base = publicUrl(s);
    const sent = await deliver(s, to, messages.weekly(weeklyNumbers(now.getTime()), base ? `${base.replace('://', '://admin.')}/#stats` : ''));
    if (sent && !force) setSetting(db, 'weekly_report_sent', week);
    return sent;
  };
  app.post('/api/admin/report/send', adminAuth('admin'), async (req, res) => {
    const sent = await app.locals.sendWeeklyReport({ force: true });
    if (!sent) return fail(res, 400, "Rapport non envoyé : vérifiez les e-mails (clé Brevo, expéditeur) et l'adresse de réception des alertes (page E-mails).");
    audit(req.admin, 'report.send', getSettings(db).mail.alerts_to);
    ok(res, { sent: true });
  });
  app.get('/api/admin/report/preview', adminAuth('admin'), (req, res) => ok(res, { report: weeklyNumbers() }));

  // ------------------------------------------------------------- Mesures du VPS (relevées chaque minute par le gardien)
  // Fichier data/gardien/mesures.jsonl : une ligne par minute (30 jours). Relu seulement s'il a changé.
  let mesuresCache = { mtime: 0, size: 0, rows: [] };
  function mesures() {
    const f = dataDir && path.join(dataDir, 'gardien', 'mesures.jsonl');
    if (!f || !fs.existsSync(f)) return [];
    const st = fs.statSync(f);
    if (st.mtimeMs !== mesuresCache.mtime || st.size !== mesuresCache.size) {
      const rows = [];
      for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
        if (!l) continue;
        try { const r = JSON.parse(l); if (r && r.t) rows.push(r); } catch { /* ligne en cours d'écriture */ }
      }
      mesuresCache = { mtime: st.mtimeMs, size: st.size, rows };
    }
    return mesuresCache.rows;
  }
  const RANGES = { '24h': { ms: DAY, step: 5 * 60_000 }, '7d': { ms: 7 * DAY, step: HOUR }, '30d': { ms: 30 * DAY, step: 6 * HOUR } };

  /** Disponibilité de Pagio sur une période, d'après les pannes notées par le gardien (null si le gardien est absent). */
  function uptime(days, now = Date.now()) {
    const av = availability(now);
    if (!av) return null;
    const since = now - days * DAY;
    const down = av.incidents.reduce((n, i) => n + Math.max(0, i.fin - Math.max(i.debut, since)), 0);
    return Math.round((1 - down / (days * DAY)) * 10000) / 100;
  }

  /** Prévision : jours avant que le disque soit plein, au rythme des 7 derniers jours (régression linéaire). null si stable. */
  function diskForecast(rows) {
    const last = rows[rows.length - 1];
    const recent = rows.filter((r) => r.t * 1000 >= Date.now() - 7 * DAY && r.disque_total > 0);
    if (!last || recent.length < 60) return null;
    const n = recent.length;
    const xs = recent.map((r) => r.t / 86400); const ys = recent.map((r) => r.disque_utilise);
    const mx = xs.reduce((a, b) => a + b, 0) / n; const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0; let den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    const perDay = den ? num / den : 0; // Mo par jour
    if (perDay <= 1) return { mb_per_day: Math.round(perDay * 10) / 10, days_to_full: null };
    return { mb_per_day: Math.round(perDay * 10) / 10, days_to_full: Math.floor((last.disque_total - last.disque_utilise) / perDay) };
  }

  /** Autres sites du VPS (vérifiés toutes les 5 minutes) avec les jours restants de leur certificat HTTPS. */
  function sites(now = Date.now()) {
    const dir = dataDir && path.join(dataDir, 'gardien');
    if (!dir) return [];
    let list = []; let certs = [];
    try { list = JSON.parse(fs.readFileSync(path.join(dir, 'sites.json'), 'utf8')); } catch { /* pas encore vérifiés */ }
    try { certs = JSON.parse(fs.readFileSync(path.join(dir, 'certificats.json'), 'utf8')); } catch { /* pas encore relevés */ }
    const ignored = new Set(getSettings(db).monitor.sites_ignored || []);
    return list.map((s) => {
      const c = certs.find((x) => x.domaine === s.domaine || String(x.noms || '').split(' ').includes(s.domaine));
      return { domaine: s.domaine, code: s.code, ms: s.ms, ok: s.code >= 200 && s.code < 400, verifie: s.verifie * 1000,
        cert_jours: c ? Math.floor((c.expire * 1000 - now) / DAY) : null, ignore: ignored.has(s.domaine) };
    });
  }

  app.get('/api/admin/system/metrics', adminAuth('admin'), (req, res) => {
    const range = RANGES[req.query.range] ? String(req.query.range) : '24h';
    const { ms, step } = RANGES[range];
    const now = Date.now();
    const all = mesures();
    const rows = all.filter((r) => r.t * 1000 >= now - ms);
    // Regroupement par tranche : moyennes (et maximum pour le processeur et le 95e centile), sommes pour le trafic.
    const buckets = new Map();
    for (const r of rows) {
      const k = Math.floor((r.t * 1000) / step) * step;
      const b = buckets.get(k) || { t: k, n: 0, cpu: 0, cpu_max: 0, mem: 0, swap: 0, disk: 0, rx: 0, tx: 0, pagio_mem: 0, req: 0, r4xx: 0, r5xx: 0, tsum: 0, t95: 0, ok: 0 };
      b.n++; b.cpu += r.cpu; b.cpu_max = Math.max(b.cpu_max, r.cpu);
      b.mem += r.mem_total ? ((r.mem_total - r.mem_dispo) / r.mem_total) * 100 : 0;
      b.swap += Math.max(0, r.swap_total - r.swap_libre); b.disk += r.disque_utilise;
      b.rx += r.rx; b.tx += r.tx; b.pagio_mem += r.pagio_mem;
      b.req += r.req; b.r4xx += r.r4xx; b.r5xx += r.r5xx; b.tsum += r.tmoy * r.req; b.t95 = Math.max(b.t95, r.t95); b.ok += r.ok ? 1 : 0;
      buckets.set(k, b);
    }
    const series = [...buckets.values()].sort((a, b) => a.t - b.t).map((b) => ({
      t: b.t, cpu: Math.round(b.cpu / b.n), cpu_max: b.cpu_max, mem_pct: Math.round(b.mem / b.n), swap_mb: Math.round(b.swap / b.n),
      disk_mb: Math.round(b.disk / b.n), rx_mb: Math.round((b.rx / 1048576) * 10) / 10, tx_mb: Math.round((b.tx / 1048576) * 10) / 10,
      pagio_mem_mb: Math.round(b.pagio_mem / b.n), req: b.req, r4xx: b.r4xx, r5xx: b.r5xx,
      t_moy_ms: b.req ? Math.round(b.tsum / b.req) : 0, t95_ms: b.t95, ok_pct: Math.round((b.ok / b.n) * 1000) / 10,
    }));
    const last = all[all.length - 1] || null;
    const reqs = rows.reduce((n, r) => n + r.req, 0);
    ok(res, {
      range, step_ms: step, samples: rows.length, series,
      current: last && {
        t: last.t * 1000, cpu: last.cpu, load: last.charge, mem_total_mb: last.mem_total, mem_used_mb: last.mem_total - last.mem_dispo,
        swap_total_mb: last.swap_total, swap_used_mb: Math.max(0, last.swap_total - last.swap_libre), disk_total_mb: last.disque_total,
        disk_used_mb: last.disque_utilise, pagio_mem_mb: last.pagio_mem, pagio_limit_mb: last.pagio_limite, restarts: last.redemarrages,
        db_mb: last.base, backups_mb: last.sauvegardes,
      },
      summary: {
        cpu_avg: rows.length ? Math.round(rows.reduce((n, r) => n + r.cpu, 0) / rows.length) : 0,
        cpu_max: rows.reduce((m, r) => Math.max(m, r.cpu), 0),
        requests: reqs, r4xx: rows.reduce((n, r) => n + r.r4xx, 0), r5xx: rows.reduce((n, r) => n + r.r5xx, 0),
        t_moy_ms: reqs ? Math.round(rows.reduce((n, r) => n + r.tmoy * r.req, 0) / reqs) : 0,
        t95_ms: rows.reduce((m, r) => Math.max(m, r.t95), 0),
        rx_mb: Math.round(rows.reduce((n, r) => n + r.rx, 0) / 1048576), tx_mb: Math.round(rows.reduce((n, r) => n + r.tx, 0) / 1048576),
        restarts: rows.length ? Math.max(0, rows[rows.length - 1].redemarrages - rows[0].redemarrages) : 0,
      },
      uptime: { '24h': uptime(1, now), '7d': uptime(7, now), '30d': uptime(30, now) },
      disk_forecast: diskForecast(all),
      sites: sites(now),
      thresholds: getSettings(db).monitor,
    });
  });

  app.get('/api/admin/system', adminAuth('admin'), (req, res) => {
    const file = db.prepare('PRAGMA database_list').all()[0]?.file;
    ok(res, {
      node: process.version, uptime_s: Math.round((Date.now() - startedAt) / 1000),
      // Taille réelle : fichier principal + journal des écritures récentes (mode WAL).
      db_file: file, db_bytes: file ? [file, `${file}-wal`].reduce((n, f) => n + (fs.existsSync(f) ? fs.statSync(f).size : 0), 0) : 0,
      libreoffice: libreOfficeAvailable(), memory_mb: Math.round(process.memoryUsage().rss / 1048576),
      machine: machine(), alerts: alerts(), availability: availability(),
      backups: backupsDir ? { count: listBackups(backupsDir).length, bytes: listBackups(backupsDir).reduce((n, b) => n + b.bytes, 0) } : null,
      counts: Object.fromEntries(['users', 'events', 'ai_usage', 'conversions', 'feedback', 'audit', 'server_errors'].map((t) => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n])),
    });
  });

  /**
   * Durées de conservation annoncées dans la politique de confidentialité (pagio.site/confidentialite) : statistiques
   * d'usage, IA et conversions 13 mois, erreurs du serveur 6 mois, messages au support 2 ans. Appelée chaque jour.
   */
  app.locals.purgeOld = (now = Date.now()) => {
    const out = {};
    const rules = [['events', 395], ['site_hits', 395], ['user_logins', 90], ['ai_usage', 395], ['conversions', 395], ['server_errors', 183], ['feedback', 730], ['notify_events', 30]];
    for (const [t, days] of rules) out[t] = Number(db.prepare(`DELETE FROM ${t} WHERE ts < ?`).run(now - days * DAY).changes);
    return out;
  };

  app.post('/api/admin/system/purge-events', adminAuth('owner'), (req, res) => {
    const days = Math.max(Number(req.body?.older_than_days) || 180, 7);
    const r = db.prepare('DELETE FROM events WHERE ts < ?').run(Date.now() - days * DAY);
    audit(req.admin, 'events.purge', null, { older_than_days: days, deleted: Number(r.changes) });
    ok(res, { deleted: Number(r.changes) });
  });

  app.get('/api/admin/export/users.csv', adminAuth('admin'), (req, res) => {
    const rows = db.prepare('SELECT id, email, name, plan, premium_until, ai_credits, banned, created_at, last_seen, total_tasks FROM users ORDER BY created_at').all();
    // Une cellule commençant par = + - @ est exécutée comme une formule par Excel : un client nommé
    // « =HYPERLINK(...) » piégerait l'administrateur qui ouvre l'export. On la préfixe d'une apostrophe.
    const esc = (v) => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; };
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
