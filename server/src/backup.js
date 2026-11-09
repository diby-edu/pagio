// Sauvegardes de la base SQLite : copie cohérente (VACUUM INTO) compressée en gzip, conservation limitée,
// vérification d'intégrité et restauration à chaud. Les fichiers vivent dans DATA_DIR/backups.
// Une sauvegarde contient les comptes et les empreintes de mots de passe : seul le propriétaire peut la télécharger.
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA_TABLES, seedTools } from './db.js';

const NAME_RE = /^pagio-(\d{8})-(\d{6})-([a-z-]{1,24})\.db\.gz$/;
const SQLITE_MAGIC = Buffer.from('SQLite format 3\u0000', 'latin1');
const pad = (n) => String(n).padStart(2, '0');
const dayStamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const timeStamp = (d) => `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

export const isBackupName = (name) => NAME_RE.test(String(name));

/** Chemin d'une sauvegarde, ou null si le nom n'a pas la forme attendue (empêche toute sortie du dossier). */
export function backupPath(dir, name) {
  if (!isBackupName(name)) return null;
  const file = path.join(dir, name);
  return fs.existsSync(file) ? file : null;
}

export function listBackups(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(isBackupName).map((name) => {
    const m = NAME_RE.exec(name);
    // La date vient du nom du fichier (et non de sa date de modification, qui change quand on le recopie).
    const [d, t] = [m[1], m[2]];
    const created = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6)).getTime();
    return { name, kind: m[3], day: d, bytes: fs.statSync(path.join(dir, name)).size, created_at: created };
  }).sort((a, b) => b.name.localeCompare(a.name));
}

/** Crée une sauvegarde cohérente de la base ouverte, sans interrompre le serveur. */
export function createBackup(db, dir, kind = 'manuelle', now = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  let name = `pagio-${dayStamp(now)}-${timeStamp(now)}-${kind}.db.gz`;
  if (fs.existsSync(path.join(dir, name))) name = `pagio-${dayStamp(now)}-${timeStamp(new Date(now.getTime() + 1000))}-${kind}.db.gz`;
  const tmp = path.join(dir, `.${crypto.randomUUID()}.tmp`);
  try {
    db.exec(`VACUUM INTO ${sqlString(tmp)}`);
    fs.writeFileSync(path.join(dir, name), zlib.gzipSync(fs.readFileSync(tmp)), { mode: 0o600 });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return listBackups(dir).find((b) => b.name === name);
}

/** Supprime les sauvegardes automatiques plus anciennes que `keepDays` jours (les autres ne sont jamais supprimées seules). */
export function pruneBackups(dir, keepDays, now = Date.now()) {
  if (!(keepDays > 0)) return 0;
  let removed = 0;
  for (const b of listBackups(dir)) {
    if (b.kind === 'auto' && now - b.created_at > keepDays * 86_400_000) { fs.rmSync(path.join(dir, b.name), { force: true }); removed++; }
  }
  return removed;
}

/** Sauvegarde automatique : une par jour, à partir de l'heure choisie. Renvoie la sauvegarde créée, ou null. */
export function runScheduledBackup(db, dir, conf, now = new Date()) {
  if (!conf?.enabled) return null;
  if (now.getHours() < (Number(conf.hour) || 0)) return null;
  if (listBackups(dir).some((b) => b.kind === 'auto' && b.day === dayStamp(now))) return null;
  const created = createBackup(db, dir, 'auto', now);
  pruneBackups(dir, Number(conf.keep_days) || 0, now.getTime());
  return created;
}

/** Décompresse une sauvegarde dans un fichier temporaire et vérifie que c'est une base Pagio intacte. */
function unpackAndVerify(file) {
  const raw = fs.readFileSync(file);
  let data;
  try { data = raw.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])) ? zlib.gunzipSync(raw) : raw; } catch { throw new Error('Fichier de sauvegarde illisible (compression endommagée)'); }
  if (!data.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)) throw new Error("Ce fichier n'est pas une base de données SQLite");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pagio-restore-'));
  const tmp = path.join(tmpDir, 'backup.db');
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  let src;
  try {
    src = new DatabaseSync(tmp, { readOnly: true });
    const check = src.prepare('PRAGMA integrity_check').get();
    if (Object.values(check)[0] !== 'ok') throw new Error('La sauvegarde est endommagée (contrôle d\'intégrité en échec)');
    const tables = src.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
    for (const t of ['admins', 'users', 'settings']) if (!tables.includes(t)) throw new Error(`Ce fichier n'est pas une sauvegarde Pagio (table « ${t} » absente)`);
    if (src.prepare('SELECT COUNT(*) n FROM admins WHERE active = 1').get().n === 0) throw new Error('Cette sauvegarde ne contient aucun administrateur actif : restauration refusée');
    const counts = Object.fromEntries(DATA_TABLES.filter((t) => tables.includes(t)).map((t) => [t, src.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));
    return { tmp, tmpDir, tables, counts };
  } catch (e) {
    try { src?.close(); } catch { /* déjà fermée */ }
    src = null;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw e;
  } finally {
    try { src?.close(); } catch { /* déjà fermée */ }
  }
}

/** Contrôle une sauvegarde sans rien modifier. Renvoie le nombre de lignes par table. */
export function verifyBackup(file) {
  const { tmpDir, counts } = unpackAndVerify(file);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return counts;
}

/**
 * Remplace le contenu de la base ouverte par celui de la sauvegarde, en une seule transaction
 * (tout ou rien). Les colonnes communes sont recopiées, ce qui accepte une sauvegarde d'une version antérieure.
 */
export function restoreBackup(db, file) {
  const { tmp, tmpDir, tables, counts } = unpackAndVerify(file);
  db.exec(`ATTACH DATABASE ${sqlString(tmp)} AS bak`);
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const t of DATA_TABLES) {
        if (!tables.includes(t)) continue;
        const mainCols = db.prepare(`PRAGMA main.table_info(${t})`).all().map((c) => c.name);
        const bakCols = db.prepare(`PRAGMA bak.table_info(${t})`).all().map((c) => c.name);
        const cols = mainCols.filter((c) => bakCols.includes(c)).join(', ');
        db.exec(`DELETE FROM main.${t}`);
        db.exec(`INSERT INTO main.${t} (${cols}) SELECT ${cols} FROM bak.${t}`);
      }
      db.exec('DELETE FROM main.admin_sessions WHERE admin_id NOT IN (SELECT id FROM main.admins WHERE active = 1)');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } finally {
    db.exec('DETACH DATABASE bak');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  seedTools(db);
  return counts;
}

/** Enregistre un fichier importé (base brute ou .gz) comme sauvegarde, après vérification. */
export function importBackup(dir, buffer, now = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const isGzip = buffer.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]));
  const name = `pagio-${dayStamp(now)}-${timeStamp(now)}-importee.db.gz`;
  const file = path.join(dir, name);
  fs.writeFileSync(file, isGzip ? buffer : zlib.gzipSync(buffer), { mode: 0o600 });
  try { verifyBackup(file); } catch (e) { fs.rmSync(file, { force: true }); throw e; }
  return listBackups(dir).find((b) => b.name === name);
}
