// Point d'entrée du serveur Pagio.
// Variables d'environnement (voir .env.example) : PORT, DATA_DIR, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, SOFFICE_PATH, DIST_DIR.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashPassword, randomPassword } from './security.js';
import { detectLibreOffice } from './services.js';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
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

const app = createApp({ db, secret, distDir: DIST_DIR });
app.listen(PORT, () => {
  console.log(`Serveur Pagio prêt sur http://localhost:${PORT}`);
  console.log(fs.existsSync(DIST_DIR) ? `Tableau de bord : http://localhost:${PORT}/` : `Tableau de bord non construit (${DIST_DIR}) : lancez « npm run build » dans app/`);
});
