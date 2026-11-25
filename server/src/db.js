// Base de données SQLite intégrée à Node.js (node:sqlite) : aucun serveur de base à installer.
// Pour une forte charge, le même schéma se transpose sur PostgreSQL (voir docs/SERVEUR.md).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { encryptSecret, decryptSecret, isEncrypted } from './security.js';

// Clé de chiffrement des secrets, propre à chaque base ouverte (absente dans les tests : valeurs en clair).
const secretKeys = new WeakMap();
export const setSecretsKey = (db, key) => { secretKeys.set(db, key); };
/** Chiffre une valeur sensible avant de l'écrire en base. */
export const protect = (db, value) => encryptSecret(value, secretKeys.get(db));
/** Déchiffre une valeur lue en base (lève une erreur si la clé ne correspond pas). */
export const reveal = (db, value) => decryptSecret(value, secretKeys.get(db));

export const TOOL_IDS = [
  'merge', 'split', 'organize', 'extract_pages', 'delete_pages', 'rotate',
  'compress', 'repair', 'ocr', 'extract_text',
  'scan', 'id_card', 'images_to_pdf', 'office_to_pdf', 'html_to_pdf', 'txt_to_pdf', 'create_pdf',
  'pdf_to_word', 'pdf_to_excel', 'pdf_to_ppt', 'pdf_to_images', 'extract_images',
  'edit', 'sign', 'fill_forms', 'page_numbers', 'watermark', 'header_footer', 'replace_text', 'redact',
  'protect', 'unlock', 'metadata', 'strip_metadata', 'digital_sign', 'verify_sign',
  'assistant', 'translate', 'invoice', 'tables', 'classify',
];

export const DEFAULT_SETTINGS = {
  maintenance: false,
  maintenance_message: '',
  announcement: '',
  announcement_level: 'info',
  min_version_code: 0,
  latest_version_name: '',
  update_url: '',
  support_email: '',
  conversion_enabled: true,
  plans: {
    free: { daily_tasks: 0, max_files: 0, max_mb: 0, ai_credits: 20 },
    premium: { daily_tasks: 0, max_files: 0, max_mb: 0, ai_credits: 300 },
  },
  ai: { enabled: false, provider: 'openai', base_url: '', model: '', api_key: '', cost_per_request: 1, max_tokens: 1800 },
  registration_open: true,
  // Connexion « avec Google » : identifiant client OAuth (Google Cloud › Identifiants). Vide = bouton masqué.
  google_client_id: '',
  // Google Analytics 4 (identifiant G-XXXX) : chargé sur pagio.site seulement après l'accord du visiteur. Vide = désactivé.
  ga_id: '',
  // Protection contre les abus (0 = illimité, sauf convert_max_mb plafonné à 100 par le serveur).
  limits: {
    convert_require_account: false, // true : la conversion en ligne exige un compte connecté
    convert_anon_per_hour: 5,       // conversions par heure et par adresse IP, sans compte
    convert_user_per_hour: 30,      // conversions par heure et par compte
    convert_max_mb: 50,             // taille maximale d'un fichier envoyé en conversion
    register_per_hour: 10,          // inscriptions par heure et par adresse IP
  },
  // Sauvegarde automatique quotidienne de la base.
  backup: { enabled: true, hour: 3, keep_days: 30 },
  // E-mails automatiques (Brevo). public_url : adresse publique du serveur, utilisée dans les liens envoyés.
  mail: { enabled: false, api_key: '', from_email: '', from_name: 'Pagio', public_url: '', verify_signup: true, alerts_enabled: false, alerts_to: '' },
  // Tarifs (décidés le 23/11/2026), en francs CFA. Les crédits IA inclus chaque mois sont ceux de l'offre Premium (plans.premium.ai_credits).
  // play_markup_pct : majoration des prix saisis dans Google Play (Google prélève 15 %). Coût de l'IA : prix du fournisseur en
  // dollars par million de jetons (environ 4 caractères par jeton) et taux du dollar en francs CFA.
  // Adresses IP bloquées (accès aux API publiques refusé), ex. « 41.202.12.7 » ou « 41.202.12.x ».
  blocked_ips: [],
  // Parrainage : jours de Premium offerts au parrain au premier paiement de son filleul.
  referral: { enabled: true, referrer_days: 7 },
  // Réponses toutes prêtes du support (titre, texte), modifiables dans le tableau de bord.
  support_templates: [
    { title: 'Merci', body: "Merci pour votre message ! Nous l'avons bien reçu et nous en tenons compte pour les prochaines versions de Pagio." },
    { title: 'Problème corrigé', body: 'Le problème que vous avez signalé est corrigé dans la dernière version de Pagio. Mettez à jour l\'application (bouton « Nouvelle version » sur l\'accueil ou pagio.site) et dites-nous si tout fonctionne.' },
    { title: 'Besoin de précisions', body: 'Merci pour votre message. Pour vous aider, pouvez-vous nous préciser le modèle de votre téléphone, l\'outil utilisé et, si possible, une capture d\'écran du problème ?' },
    { title: 'Paiement reçu', body: 'Nous avons bien reçu votre paiement : votre offre Premium est activée. Si elle n\'apparaît pas tout de suite, déconnectez-vous puis reconnectez-vous dans l\'application.' },
  ],
  // Seuils d'alerte du module Système (réglables). other_sites_alerts : alertes aussi pour les autres sites du VPS (sinon
  // seulement Pagio) ; sites_ignored : sites à ne plus signaler quand ces alertes sont activées.
  monitor: { disk_warn_pct: 20, disk_crit_pct: 10, mem_warn_pct: 90, cpu_warn_pct: 85, rt_warn_ms: 1500, cert_warn_days: 14, disk_forecast_days: 30, sites_ignored: [], other_sites_alerts: false },
  sales: {
    price_week: 1000, price_month: 3000, price_year: 30000,
    ai_pack_credits: 100, ai_pack_price: 1000,
    play_markup_pct: 15,
    usd_xof: 600, ai_usd_per_m_in: 0.4, ai_usd_per_m_out: 1.6,
  },
};

/** Durée de chaque offre Premium, en jours. */
export const OFFER_DAYS = { week: 7, month: 30, year: 365 };
/** Moyens de paiement enregistrables à la main dans le tableau de bord. */
export const PAYMENT_METHODS = ['orange_money', 'wave', 'mtn', 'moov', 'cash', 'transfer', 'card', 'google_play', 'other', 'gift'];

/** Tables recopiées lors d'une restauration (les sessions d'administration en cours sont conservées). */
export const DATA_TABLES = ['admins', 'users', 'settings', 'tools', 'events', 'ai_usage', 'conversions', 'feedback', 'audit', 'plan_history', 'server_errors', 'payments', 'site_hits', 'feedback_replies', 'promo_codes', 'promo_redemptions', 'campaigns', 'user_logins'];

/** Inscrit une erreur du serveur au journal consultable dans le tableau de bord. Ne lève jamais d'erreur. */
export function logServerError(db, source, error, context = {}) {
  try {
    db.prepare('INSERT INTO server_errors (ts, source, message, stack, method, path, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      Date.now(), String(source).slice(0, 40), String(error?.message ?? error).slice(0, 1000), error?.stack ? String(error.stack).slice(0, 4000) : null,
      context.method ?? null, context.path ? String(context.path).slice(0, 300) : null, context.status ?? null);
  } catch { /* la journalisation ne doit jamais faire tomber le serveur */ }
}

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin', active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, last_login INTEGER);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free', premium_until TEXT, ai_credits INTEGER NOT NULL DEFAULT 0,
      banned INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, last_seen INTEGER,
      tasks_day TEXT, tasks_count INTEGER NOT NULL DEFAULT 0, total_tasks INTEGER NOT NULL DEFAULT 0, reset_token TEXT, reset_expires INTEGER);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tools (
      id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, premium INTEGER NOT NULL DEFAULT 0,
      max_files INTEGER NOT NULL DEFAULT 0, max_mb INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, device_id TEXT, user_id TEXT,
      app_version TEXT, name TEXT NOT NULL, tool TEXT, ok INTEGER, props TEXT);
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
    CREATE INDEX IF NOT EXISTS idx_events_name ON events(name, tool);
    CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, user_id TEXT, chars_in INTEGER, chars_out INTEGER,
      credits INTEGER, provider TEXT, ok INTEGER, error TEXT);
    CREATE TABLE IF NOT EXISTS conversions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, user_id TEXT, source_ext TEXT, target TEXT,
      bytes INTEGER, ms INTEGER, ok INTEGER, error TEXT);
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT, message TEXT, email TEXT,
      user_id TEXT, status TEXT NOT NULL DEFAULT 'nouveau');
    -- Réponses du support envoyées depuis le tableau de bord (par e-mail).
    CREATE TABLE IF NOT EXISTS feedback_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT, feedback_id INTEGER NOT NULL, ts INTEGER NOT NULL, admin_email TEXT, message TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0);
    -- Codes promo (Premium offert N jours, crédits IA, remise en %) et leurs utilisations.
    CREATE TABLE IF NOT EXISTS promo_codes (
      code TEXT PRIMARY KEY, kind TEXT NOT NULL, value INTEGER NOT NULL, max_uses INTEGER NOT NULL DEFAULT 0, uses INTEGER NOT NULL DEFAULT 0,
      expires TEXT, note TEXT, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS promo_redemptions (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, user_id TEXT, ts INTEGER NOT NULL);
    -- Campagnes e-mail envoyées depuis le tableau de bord.
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, admin_email TEXT, subject TEXT NOT NULL, body TEXT NOT NULL, segment TEXT,
      recipients INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, status TEXT);
    -- Connexions des utilisateurs (sécurité, 90 jours) : adresse IP tronquée, appareil, réussite.
    CREATE TABLE IF NOT EXISTS user_logins (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, user_id TEXT, email TEXT, ip TEXT, ua TEXT, ok INTEGER NOT NULL, method TEXT);
    CREATE INDEX IF NOT EXISTS idx_user_logins_ts ON user_logins(ts);
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, admin_email TEXT, action TEXT NOT NULL,
      target TEXT, details TEXT);
    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, ip TEXT, user_agent TEXT, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id);
    CREATE TABLE IF NOT EXISTS notify_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER NOT NULL, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL, last_seen INTEGER, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS plan_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, user_id TEXT NOT NULL, actor TEXT,
      old_plan TEXT, new_plan TEXT, premium_until TEXT, reason TEXT);
    CREATE INDEX IF NOT EXISTS idx_plan_history_user ON plan_history(user_id);
    CREATE TABLE IF NOT EXISTS server_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, source TEXT NOT NULL, message TEXT NOT NULL,
      stack TEXT, method TEXT, path TEXT, status INTEGER);
    CREATE INDEX IF NOT EXISTS idx_server_errors_ts ON server_errors(ts);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_ts ON ai_usage(ts);
    CREATE INDEX IF NOT EXISTS idx_conversions_ts ON conversions(ts);
    -- Ventes : paiements enregistrés (à la main pour l'instant : mobile money, espèces…) et Premium offerts (montant 0).
    -- kind : premium | ai_pack ; offer : week | month | year | custom ; days et credits : ce que le paiement a apporté.
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, user_id TEXT, user_email TEXT, kind TEXT NOT NULL,
      offer TEXT, amount INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'XOF', method TEXT NOT NULL,
      reference TEXT, days INTEGER NOT NULL DEFAULT 0, credits INTEGER NOT NULL DEFAULT 0, premium_until TEXT,
      actor TEXT, note TEXT, refunded INTEGER NOT NULL DEFAULT 0, refunded_at INTEGER);
    CREATE INDEX IF NOT EXISTS idx_payments_ts ON payments(ts);
    CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
    -- Pages vues sur pagio.site, sans cookies : visitor = empreinte valable un seul jour (aucune adresse IP enregistrée).
    CREATE TABLE IF NOT EXISTS site_hits (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, visitor TEXT NOT NULL, path TEXT NOT NULL, source TEXT,
      ref_domain TEXT, country TEXT, lang TEXT, device TEXT, browser TEXT, os TEXT, screen_w INTEGER, new_visit INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS idx_site_hits_ts ON site_hits(ts);
  `);
  // Évolutions du schéma : colonnes ajoutées aux bases créées par une version précédente.
  const addColumn = (table, column, definition) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  addColumn('admins', 'totp_secret', 'TEXT');
  addColumn('admins', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('admins', 'totp_last_step', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('admins', 'recovery_codes', 'TEXT');
  addColumn('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');
  // Moment (ms) avant lequel les badges de connexion de ce compte ne valent plus : nouveau mot de passe, etc.
  addColumn('users', 'tokens_valid_after', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('users', 'verify_token', 'TEXT');
  addColumn('users', 'verify_expires', 'INTEGER');
  // Mois (AAAA-MM) de la dernière remise à niveau des crédits IA inclus dans le Premium.
  addColumn('users', 'credits_month', 'TEXT');
  // Parrainage : code personnel, parrain, récompense déjà versée ; remise d'un code promo en attente du prochain paiement.
  addColumn('users', 'ref_code', 'TEXT');
  addColumn('users', 'referred_by', 'TEXT');
  addColumn('users', 'referral_rewarded', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('users', 'pending_discount', 'TEXT');
  // Désinscription des campagnes e-mail (lien en bas de chaque campagne).
  addColumn('users', 'marketing_unsub', 'INTEGER NOT NULL DEFAULT 0');
  // Notifications de Pagio Admin : préférences (cases à cocher) et jeton Firebase de chaque téléphone.
  addColumn('notify_devices', 'prefs', 'TEXT');
  addColumn('notify_devices', 'fcm_token', 'TEXT');
  addColumn('notify_devices', 'fcm_at', 'INTEGER');
  db.exec(`CREATE TABLE IF NOT EXISTS notify_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, level TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT NOT NULL, device_id INTEGER);
    CREATE INDEX IF NOT EXISTS idx_notify_events_ts ON notify_events(ts);`);
  // Offre gratuite : opérations par jour pour chaque outil (0 = illimité) et pages maximum par scan (0 = illimité).
  const hadDailyFree = db.prepare('PRAGMA table_info(tools)').all().some((c) => c.name === 'daily_free');
  addColumn('tools', 'daily_free', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('tools', 'max_pages', 'INTEGER NOT NULL DEFAULT 0');
  if (!hadDailyFree) {
    const set = db.prepare('UPDATE tools SET daily_free = ?, max_pages = ? WHERE id = ?');
    for (const t of db.prepare('SELECT id FROM tools').all()) { const d = freeDefaults(t.id); set.run(d.daily_free, d.max_pages, t.id); }
  }
  // Scanner : enregistrement en PDF réservé au Premium (sinon les pages sont enregistrées en images JPG).
  const hadPdfPremium = db.prepare('PRAGMA table_info(tools)').all().some((c) => c.name === 'pdf_premium');
  addColumn('tools', 'pdf_premium', 'INTEGER NOT NULL DEFAULT 0');
  if (!hadPdfPremium) db.prepare("UPDATE tools SET pdf_premium = 1 WHERE id = 'scan'").run();
  seedTools(db);
  return db;
}

/** Outils d'IA : déjà limités par les crédits IA, pas de limite quotidienne en plus. */
export const AI_TOOL_IDS = ['assistant', 'translate', 'invoice', 'classify'];

/** Réglages de départ de l'offre gratuite (décidés le 20/11/2026) : 10 scans de 20 pages, 5 opérations pour les autres outils. */
export function freeDefaults(id) {
  if (id === 'scan') return { daily_free: 10, max_pages: 20, pdf_premium: 1 };
  return { daily_free: AI_TOOL_IDS.includes(id) ? 0 : 5, max_pages: 0, pdf_premium: 0 };
}

export function seedTools(db) {
  const insertTool = db.prepare('INSERT OR IGNORE INTO tools (id, daily_free, max_pages, pdf_premium) VALUES (?, ?, ?, ?)');
  for (const id of TOOL_IDS) { const d = freeDefaults(id); insertTool.run(id, d.daily_free, d.max_pages, d.pdf_premium); }
}

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) {
    try { s[r.key] = JSON.parse(r.value); } catch { /* valeur ignorée */ }
  }
  s.plans = { ...DEFAULT_SETTINGS.plans, ...s.plans };
  s.ai = { ...DEFAULT_SETTINGS.ai, ...s.ai };
  s.limits = { ...DEFAULT_SETTINGS.limits, ...s.limits };
  s.backup = { ...DEFAULT_SETTINGS.backup, ...s.backup };
  s.sales = { ...DEFAULT_SETTINGS.sales, ...s.sales };
  s.monitor = { ...DEFAULT_SETTINGS.monitor, ...s.monitor };
  s.referral = { ...DEFAULT_SETTINGS.referral, ...s.referral };
  // La clé d'IA est chiffrée en base ; elle n'est en clair qu'en mémoire, le temps de la requête.
  try { s.ai.api_key = reveal(db, s.ai.api_key); } catch { s.ai.api_key = ''; s.ai.key_error = true; }
  s.mail = { ...DEFAULT_SETTINGS.mail, ...s.mail };
  try { s.mail.api_key = reveal(db, s.mail.api_key); } catch { s.mail.api_key = ''; s.mail.key_error = true; }
  return s;
}

export function setSetting(db, key, value) {
  if ((key === 'ai' || key === 'mail') && value && typeof value === 'object') value = { ...value, api_key: protect(db, value.api_key) };
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

/** Au démarrage : chiffre une clé d'IA qu'une version précédente aurait enregistrée en clair. Renvoie true si une clé a été chiffrée. */
export function encryptStoredSecrets(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ai'").get();
  if (!row) return false;
  let ai;
  try { ai = JSON.parse(row.value); } catch { return false; }
  if (!ai?.api_key || isEncrypted(ai.api_key) || !secretKeys.get(db)) return false;
  setSetting(db, 'ai', ai);
  return true;
}
