// Lance le serveur pour une durée limitée (test de recette), avec une base temporaire, puis s'arrête seul.
// Usage : node scripts/smoke-run.mjs [secondes]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { hashPassword } from '../src/security.js';
import { createApp } from '../src/app.js';

const seconds = Number(process.argv[2]) || 120;
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pagio-smoke-'));
const db = openDb(path.join(dir, 'pagio.db'));
db.prepare("INSERT INTO admins (email, name, password_hash, role, created_at) VALUES ('recette@pagio.local', 'Recette', ?, 'owner', ?)").run(hashPassword('Recette-2026!'), Date.now());
const server = createApp({ db, secret: 'smoke', distDir: path.join(here, '..', '..', 'dist') }).listen(8787, () => console.log(`Recette : http://localhost:8787 pendant ${seconds} s`));
setTimeout(() => { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(0); }, seconds * 1000);
