// Base de données SQLite intégrée à Node.js (node:sqlite) : aucun serveur de base à installer.
// Pour une forte charge, le même schéma se transpose sur PostgreSQL (voir docs/SERVEUR.md).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const TOOL_IDS = [
  'merge', 'split', 'organize', 'extract_pages', 'delete_pages', 'rotate',
  'compress', 'repair', 'ocr', 'extract_text',
  'scan', 'images_to_pdf', 'office_to_pdf', 'html_to_pdf', 'txt_to_pdf', 'create_pdf',
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
    premium: { daily_tasks: 0, max_files: 0, max_mb: 0, ai_credits: 500 },
  },
  ai: { enabled: false, provider: 'openai', base_url: '', model: '', api_key: '', cost_per_request: 1, max_tokens: 1800 },
  registration_open: true,
};

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
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, admin_email TEXT, action TEXT NOT NULL,
      target TEXT, details TEXT);
  `);
  const insertTool = db.prepare('INSERT OR IGNORE INTO tools (id) VALUES (?)');
  for (const id of TOOL_IDS) insertTool.run(id);
  return db;
}

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) {
    try { s[r.key] = JSON.parse(r.value); } catch { /* valeur ignorée */ }
  }
  s.plans = { ...DEFAULT_SETTINGS.plans, ...s.plans };
  s.ai = { ...DEFAULT_SETTINGS.ai, ...s.ai };
  return s;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}
