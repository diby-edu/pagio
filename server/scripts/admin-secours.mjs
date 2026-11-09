// Accès de secours au tableau de bord, à lancer SUR LE SERVEUR (il faut donc déjà avoir accès à la machine).
// À utiliser si un administrateur a perdu son mot de passe, son téléphone et ses codes de secours.
//
//   node scripts/admin-secours.mjs --liste
//   node scripts/admin-secours.mjs vous@domaine.com --2fa            retire la double authentification
//   node scripts/admin-secours.mjs vous@domaine.com --mot-de-passe   génère un nouveau mot de passe
//
// Toutes les sessions ouvertes de ce compte sont fermées et l'opération est inscrite au journal d'audit.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { hashPassword, randomPassword } from '../src/security.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const dataDir = path.resolve(process.env.DATA_DIR || path.join(here, '..', 'data'));
const file = path.join(dataDir, 'pagio.db');
if (!fs.existsSync(file)) { console.error(`Base introuvable : ${file}`); process.exit(1); }

const args = process.argv.slice(2);
const db = openDb(file);

if (args.includes('--liste')) {
  for (const a of db.prepare('SELECT email, role, active, totp_enabled FROM admins ORDER BY id').all()) {
    console.log(`${a.email}  rôle=${a.role}  ${a.active ? 'actif' : 'désactivé'}  double authentification=${a.totp_enabled ? 'oui' : 'non'}`);
  }
  process.exit(0);
}

const email = String(args.find((a) => !a.startsWith('--')) || '').toLowerCase();
const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
if (!admin || !(args.includes('--2fa') || args.includes('--mot-de-passe'))) {
  console.error(admin ? 'Précisez --2fa et/ou --mot-de-passe.' : `Administrateur introuvable : « ${email} ». Utilisez --liste.`);
  process.exit(1);
}

const done = [];
if (args.includes('--2fa')) {
  db.prepare('UPDATE admins SET totp_enabled = 0, totp_secret = NULL, totp_last_step = 0, recovery_codes = NULL WHERE id = ?').run(admin.id);
  done.push('double authentification retirée');
}
if (args.includes('--mot-de-passe')) {
  const password = randomPassword(18);
  db.prepare('UPDATE admins SET password_hash = ?, active = 1 WHERE id = ?').run(hashPassword(password), admin.id);
  done.push('mot de passe réinitialisé');
  console.log(`Nouveau mot de passe pour ${email} : ${password}`);
  console.log('Changez-le dès la connexion (Mon compte).');
}
db.prepare('UPDATE admin_sessions SET revoked = 1 WHERE admin_id = ?').run(admin.id);
db.prepare('INSERT INTO audit (ts, admin_email, action, target, details) VALUES (?, NULL, ?, ?, ?)').run(Date.now(), 'admin.secours', email, JSON.stringify({ actions: done }));
console.log(`${email} : ${done.join(', ')}. Sessions fermées.`);
