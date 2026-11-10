// Point d'entrée du serveur Pagio.
// Variables d'environnement (voir .env.example) : PORT, DATA_DIR, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, SOFFICE_PATH, DIST_DIR.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, getSettings, setSecretsKey, encryptStoredSecrets, logServerError } from './db.js';
import { hashPassword, randomPassword, deriveKey } from './security.js';
import { detectLibreOffice } from './services.js';
import { createApp } from './app.js';
import { runScheduledBackup } from './backup.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Fichier server/.env (facultatif) : chargé ici, les variables déjà définies par l'hébergeur restent prioritaires.
const envFile = path.join(here, '..', '.env');
if (fs.existsSync(envFile)) {
  const before = { ...process.env };
  process.loadEnvFile(envFile);
  for (const [k, v] of Object.entries(before)) process.env[k] = v;
}

const PORT = Number(process.env.PORT) || 8787;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(here, '..', 'data'));
const DIST_DIR = path.resolve(process.env.DIST_DIR || path.join(here, '..', '..', 'dist'));
fs.mkdirSync(DATA_DIR, { recursive: true });

// Secret de signature des sessions : fourni, ou généré une fois et conservé dans data/.
let secret = process.env.JWT_SECRET;
const secretFile = path.join(DATA_DIR, 'jwt-secret.key');
if (!secret) {
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  secret = fs.readFileSync(secretFile, 'utf8').trim();
}

const db = openDb(path.join(DATA_DIR, 'pagio.db'));

// Clé de chiffrement des secrets stockés en base (clé d'IA, double authentification) : SECRETS_KEY, ou un fichier
// généré une fois dans data/. Elle n'est jamais dans la base ni dans ses sauvegardes : conservez-en une copie à part.
let secretsKey = process.env.SECRETS_KEY;
const secretsFile = path.join(DATA_DIR, 'secrets.key');
if (!secretsKey) {
  if (!fs.existsSync(secretsFile)) fs.writeFileSync(secretsFile, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  secretsKey = fs.readFileSync(secretsFile, 'utf8').trim();
}
setSecretsKey(db, deriveKey(secretsKey));
if (encryptStoredSecrets(db)) console.log("La clé d'IA enregistrée en clair par une version précédente a été chiffrée.");
if (getSettings(db).ai.key_error) console.warn("ATTENTION : la clé d'IA en base ne peut pas être déchiffrée (clé SECRETS_KEY différente). Saisissez-la de nouveau dans le tableau de bord.");

// Premier démarrage : création du compte propriétaire du tableau de bord.
if (db.prepare('SELECT COUNT(*) n FROM admins').get().n === 0) {
  const email = (process.env.ADMIN_EMAIL || 'admin@pagio.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || randomPassword(16);
  db.prepare("INSERT INTO admins (email, name, password_hash, role, created_at) VALUES (?, 'Propriétaire', ?, 'owner', ?)")
    .run(email, hashPassword(password), Date.now());
  const note = path.join(DATA_DIR, 'premier-admin.txt');
  if (!process.env.ADMIN_PASSWORD) fs.writeFileSync(note, `Compte administrateur créé le ${new Date().toISOString()}\nE-mail : ${email}\nMot de passe : ${password}\n\nChangez ce mot de passe dès la première connexion puis supprimez ce fichier.\n`, { mode: 0o600 });
  console.log('==============================================================');
  console.log(' Premier compte administrateur créé');
  console.log(`   E-mail       : ${email}`);
  console.log(`   Mot de passe : ${process.env.ADMIN_PASSWORD ? '(celui de ADMIN_PASSWORD)' : password}`);
  if (!process.env.ADMIN_PASSWORD) console.log(`   (aussi enregistré dans ${note})`);
  console.log('==============================================================');
}

const lo = await detectLibreOffice();
console.log(lo ? `LibreOffice détecté : ${lo}` : 'LibreOffice non détecté : la conversion haute fidélité est désactivée (installez LibreOffice ou utilisez l\'image Docker).');

// TRUST_PROXY=1 derrière un proxy HTTPS (Caddy, Nginx) : indispensable pour que les limites par adresse IP
// s'appliquent au visiteur et non au proxy. À laisser vide si le serveur est joint directement.
const trustProxy = /^\d+$/.test(process.env.TRUST_PROXY || '') ? Number(process.env.TRUST_PROXY) : false;
const app = createApp({ db, secret, distDir: DIST_DIR, dataDir: DATA_DIR, trustProxy });

// Sauvegarde automatique quotidienne (réglages dans le tableau de bord › Sauvegardes).
const backupsDir = path.join(DATA_DIR, 'backups');
const backupTick = () => {
  try {
    const made = runScheduledBackup(db, backupsDir, getSettings(db).backup);
    if (made) {
      console.log(`Sauvegarde automatique créée : ${made.name}`);
      db.prepare('INSERT INTO audit (ts, admin_email, action, target, details) VALUES (?, NULL, ?, ?, ?)').run(Date.now(), 'backup.auto', made.name, JSON.stringify({ bytes: made.bytes }));
    }
  } catch (e) {
    console.error('Sauvegarde automatique en échec :', e.message);
    logServerError(db, 'sauvegarde', e);
    db.prepare('INSERT INTO audit (ts, admin_email, action, target, details) VALUES (?, NULL, ?, NULL, ?)').run(Date.now(), 'backup.auto_failed', JSON.stringify({ error: String(e.message).slice(0, 300) }));
  }
};
// Une erreur imprévue hors d'une requête est inscrite au journal au lieu d'arrêter le serveur.
process.on('unhandledRejection', (e) => { console.error('Erreur non gérée :', e); logServerError(db, 'serveur', e instanceof Error ? e : new Error(String(e))); });
process.on('uncaughtException', (e) => { console.error('Exception non gérée :', e); logServerError(db, 'serveur', e); });

setTimeout(backupTick, 20_000).unref();
setInterval(backupTick, 10 * 60_000).unref();

app.listen(PORT, () => {
  console.log(`Serveur Pagio prêt sur http://localhost:${PORT}`);
  console.log(fs.existsSync(DIST_DIR) ? `Tableau de bord : http://localhost:${PORT}/` : `Tableau de bord non construit (${DIST_DIR}) : lancez « npm run build » dans app/`);
});
