// Serveur d'essai JETABLE pour l'audit (tests d'intrusion, charge, QA du tableau de bord).
// Base en mémoire, dossier temporaire supprimé à l'arrêt : aucune donnée réelle n'est touchée.
// Les identifiants d'essai sont générés au démarrage et écrits dans un fichier local hors du dépôt (argument 2).
//   node server/test/audit/serveur-essai.mjs 8899 <fichier-identifiants>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDb, setSecretsKey } from '../../src/db.js';
import { hashPassword, deriveKey } from '../../src/security.js';
import { createApp } from '../../src/app.js';

const port = Number(process.argv[2] || 8899);
const credsFile = process.argv[3];
const db = openDb(':memory:');
setSecretsKey(db, deriveKey(crypto.randomBytes(32).toString('hex')));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pagio-audit-'));
const pw = () => crypto.randomBytes(12).toString('base64url');
const creds = { owner: { email: 'owner@audit.test', password: pw() }, support: { email: 'support@audit.test', password: pw() } };
db.prepare("INSERT INTO admins (email, name, password_hash, role, created_at) VALUES (?, 'Audit', ?, 'owner', ?)").run(creds.owner.email, hashPassword(creds.owner.password), Date.now());
db.prepare("INSERT INTO admins (email, name, password_hash, role, created_at) VALUES (?, 'Support', ?, 'support', ?)").run(creds.support.email, hashPassword(creds.support.password), Date.now());
if (credsFile) fs.writeFileSync(credsFile, JSON.stringify(creds));
const distDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../../dist');
const app = createApp({ db, secret: crypto.randomBytes(32).toString('hex'), distDir, dataDir });
app.listen(port, '127.0.0.1', () => console.log(`serveur d'essai prêt sur http://127.0.0.1:${port}`));
const stop = () => { fs.rmSync(dataDir, { recursive: true, force: true }); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
