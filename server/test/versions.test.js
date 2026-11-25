// Versions de l'application : envoi d'une APK depuis le tableau de bord, vérifications, version d'essai, retour
// en arrière, suppression, annonce aux applications (numéro, notes, mise à jour obligatoire).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { openDb } from '../src/db.js';
import { hashPassword } from '../src/security.js';
import { createApp } from '../src/app.js';

/** Petite APK factice : archive ZIP avec un manifeste (textes en UTF-16) et classes.dex. */
function fakeApk(pkg, version) {
  const files = [
    ['AndroidManifest.xml', zlib.deflateRawSync(Buffer.concat([Buffer.from('xx'), Buffer.from(pkg, 'utf16le'), Buffer.from(version, 'utf16le')])), 8],
    ['classes.dex', Buffer.from('dex\n035'), 0],
  ];
  const parts = []; const central = []; let off = 0;
  for (const [name, data, method] of files) {
    const n = Buffer.from(name);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(method, 8); h.writeUInt32LE(data.length, 18); h.writeUInt16LE(n.length, 26);
    parts.push(h, n, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(method, 10); c.writeUInt32LE(data.length, 20); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e, Buffer.alloc(1200)]);
}

test('versions : envoi, essai, annonce, obligatoire, retour en arrière, suppression', async () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO admins (email, name, password_hash, role, created_at) VALUES ('owner@test.fr', 'O', ?, 'owner', ?)").run(hashPassword('motdepasse-admin'), Date.now());
  db.prepare("INSERT INTO admins (email, name, password_hash, role, created_at) VALUES ('admin@test.fr', 'A', ?, 'admin', ?)").run(hashPassword('motdepasse-admin2'), Date.now());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pagio-versions-'));
  const app = createApp({ db, secret: 's', dataDir: dir, releasesDir: dir });
  const http = app.listen(0); await new Promise((r) => http.once('listening', r));
  const base = `http://127.0.0.1:${http.address().port}`;
  const login = async (email, password) => (await (await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).token;
  try {
    const owner = await login('owner@test.fr', 'motdepasse-admin');
    const admin = await login('admin@test.fr', 'motdepasse-admin2');
    const send = (buf, q, tok = owner) => fetch(`${base}/api/admin/releases?${new URLSearchParams(q)}`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/octet-stream' }, body: buf });
    const json = async (method, url, body, tok = owner) => (await fetch(base + url, { method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
    const config = async () => (await fetch(`${base}/api/app/config`)).json();

    // Refus : pas le propriétaire, pas une APK, mauvaise application, mauvais numéro.
    assert.equal((await send(fakeApk('com.pagio.app', '2.3.0'), { version: '2.3.0' }, admin)).status, 403);
    assert.match((await (await send(Buffer.from('pas une apk'.repeat(200)), { version: '2.3.0' })).json()).error, /pas une APK/);
    assert.match((await (await send(fakeApk('com.pagio.admin', '1.1.0'), { version: '1.1.0' })).json()).error, /pas l'application Pagio/);
    assert.match((await (await send(fakeApk('com.pagio.app', '2.3.0'), { version: '2.4.0' })).json()).error, /ne correspond pas/);

    // Version d'essai : enregistrée, non annoncée.
    let r = await (await send(fakeApk('com.pagio.app', '2.3.0'), { version: '2.3.0', essai: '1' })).json();
    assert.equal(r.saved, 'pagio-2.3.0-essai.apk');
    assert.equal(r.current, null);
    assert.equal((await config()).latest_version_name, '');

    // Publication : lien pagio.apk, version.json, numéro et notes annoncés.
    r = await (await send(fakeApk('com.pagio.app', '2.3.0'), { version: '2.3.0', notes: 'Écran Premium\nE-mail de bienvenue' })).json();
    assert.equal(r.current, 'pagio-2.3.0.apk');
    assert.equal(fs.readFileSync(path.join(dir, 'pagio.apk')).length, fs.readFileSync(path.join(dir, 'pagio-2.3.0.apk')).length);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')).code, 20300);
    let c = await config();
    assert.equal(c.latest_version_name, '2.3.0');
    assert.match(c.release_notes, /Écran Premium/);
    assert.match(c.update_url, /\/telecharger\/pagio\.apk$/);
    assert.equal(c.min_version_code, 0);

    // Version plus ancienne refusée ; nouvelle version obligatoire.
    assert.match((await (await send(fakeApk('com.pagio.app', '2.2.0'), { version: '2.2.0' })).json()).error, /plus ancienne/);
    r = await (await send(fakeApk('com.pagio.app', '2.4.0'), { version: '2.4.0', mandatory: '1', notes: 'Correctifs' })).json();
    c = await config();
    assert.equal(c.latest_version_name, '2.4.0');
    assert.equal(c.min_version_code, 20400);

    // Retour en arrière vers 2.3.0 ; la version proposée ne peut pas être supprimée, l'autre si.
    r = await json('POST', '/api/admin/releases/current', { file: 'pagio-2.3.0.apk', notes: 'Retour à la 2.3.0' });
    assert.equal(r.current, 'pagio-2.3.0.apk');
    assert.equal((await config()).latest_version_name, '2.3.0');
    assert.match((await json('POST', '/api/admin/releases/current', { file: 'pagio-2.3.0-essai.apk' })).error, /essai/);
    assert.match((await json('DELETE', '/api/admin/releases/pagio-2.3.0.apk')).error, /Impossible/);
    r = await json('DELETE', '/api/admin/releases/pagio-2.4.0.apk');
    assert.deepEqual(r.files.map((f) => f.file), ['pagio-2.3.0.apk', 'pagio-2.3.0-essai.apk']);
    // Notes modifiables après coup ; la liste est lisible par un administrateur.
    assert.equal((await json('PUT', '/api/admin/releases/notes', { notes: 'Nouvelles notes' })).notes, 'Nouvelles notes');
    assert.equal((await json('GET', '/api/admin/releases', null, admin)).files.length, 2);
  } finally { http.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
