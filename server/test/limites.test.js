// Limites de l'offre gratuite par outil : réglages de départ, modification par l'administrateur, envoi à l'application.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db.js';
import { boot, loginOwner } from './helpers.js';

test('limites gratuites : réglages de départ, modification, configuration de l\'application', async () => {
  const { server, call, db } = await boot();
  try {
    const owner = (await loginOwner(call)).json.token;
    // Réglages de départ : 10 scans de 20 pages, 5 opérations pour les autres outils, IA limitée par les crédits seulement
    let cfg = (await call('GET', '/api/app/config')).json.tools;
    assert.deepEqual([cfg.scan.daily_free, cfg.scan.max_pages], [10, 20]);
    assert.equal(cfg.merge.daily_free, 5);
    assert.equal(cfg.assistant.daily_free, 0);

    // Modification depuis le tableau de bord, valeurs aberrantes ramenées dans les bornes
    const r = await call('PUT', '/api/admin/tools/scan', { daily_free: 15, max_pages: 30 }, owner);
    assert.equal(r.status, 200);
    assert.equal((await call('PUT', '/api/admin/tools/merge', { daily_free: -4 }, owner)).json.tool.daily_free, 0);
    cfg = (await call('GET', '/api/app/config')).json.tools;
    assert.deepEqual([cfg.scan.daily_free, cfg.scan.max_pages, cfg.merge.daily_free], [15, 30, 0]);

    // Le support ne peut pas modifier ; les limites atteintes remontent dans la liste des outils
    const support = (await call('POST', '/api/admin/login', { email: 'support@test.fr', password: 'motdepasse-support' })).json.token;
    assert.equal((await call('PUT', '/api/admin/tools/scan', { daily_free: 1 }, support)).status, 403);
    db.prepare("INSERT INTO events (ts, name, tool) VALUES (?, 'limit_reached', 'scan')").run(Date.now());
    const tools = (await call('GET', '/api/admin/tools', null, owner)).json.tools;
    assert.equal(tools.find((t) => t.id === 'scan').limit_hits_30d, 1);
  } finally { server.close(); }
});

test('limites gratuites : base d\'une version précédente migrée une seule fois', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pagio-limites-'));
  const file = path.join(dir, 'pagio.db');
  try {
    // Base d'avant les limites : outils sans colonnes daily_free / max_pages
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE tools (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, premium INTEGER NOT NULL DEFAULT 0, max_files INTEGER NOT NULL DEFAULT 0, max_mb INTEGER NOT NULL DEFAULT 0); INSERT INTO tools (id) VALUES ('scan'), ('merge'), ('assistant');");
    old.close();
    let db = openDb(file);
    assert.deepEqual({ ...db.prepare("SELECT daily_free, max_pages FROM tools WHERE id = 'scan'").get() }, { daily_free: 10, max_pages: 20 });
    assert.equal(db.prepare("SELECT daily_free FROM tools WHERE id = 'merge'").get().daily_free, 5);
    assert.equal(db.prepare("SELECT daily_free FROM tools WHERE id = 'assistant'").get().daily_free, 0);
    // L'administrateur change un réglage : un redémarrage ne l'écrase pas
    db.prepare("UPDATE tools SET daily_free = 3 WHERE id = 'scan'").run();
    db.close();
    db = openDb(file);
    assert.equal(db.prepare("SELECT daily_free FROM tools WHERE id = 'scan'").get().daily_free, 3);
    db.close();
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows : fichier encore verrouillé, dossier temporaire */ } }
});
