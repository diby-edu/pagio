// Démarre un serveur de test : base en mémoire, dossier de données temporaire, aucun réseau externe.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, setSecretsKey } from '../src/db.js';
import { hashPassword, deriveKey } from '../src/security.js';
import { createApp } from '../src/app.js';

export async function boot({ secretsKey } = {}) {
  const db = openDb(':memory:');
  if (secretsKey) setSecretsKey(db, deriveKey(secretsKey));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pagio-test-'));
  db.prepare("INSERT INTO admins (email, name, password_hash, role, created_at) VALUES ('owner@test.fr', 'O', ?, 'owner', ?)").run(hashPassword('motdepasse-admin'), Date.now());
  db.prepare("INSERT INTO admins (email, name, password_hash, role, created_at) VALUES ('support@test.fr', 'S', ?, 'support', ?)").run(hashPassword('motdepasse-support'), Date.now());
  const http = createApp({ db, secret: 'test-secret', dataDir }).listen(0);
  await new Promise((r) => http.once('listening', r));
  const base = `http://127.0.0.1:${http.address().port}`;
  const call = async (method, url, body, token) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  /** Envoi d'un fichier brut (conversion, import de sauvegarde). */
  const raw = (method, url, body, token) => fetch(base + url, { method, headers: { 'content-type': 'application/octet-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body });
  const server = { base, close() { http.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
  return { server, call, raw, db, dataDir };
}

export const loginOwner = (call, extra = {}) => call('POST', '/api/admin/login', { email: 'owner@test.fr', password: 'motdepasse-admin', ...extra });
