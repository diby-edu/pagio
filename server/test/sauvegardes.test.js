// Tests des sauvegardes : création, vérification, téléchargement, restauration, import, planification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runScheduledBackup, listBackups, pruneBackups } from '../src/backup.js';
import { boot, loginOwner } from './helpers.js';

test('sauvegardes : création, vérification, restauration, import', async () => {
  const { server, call, raw } = await boot();
  try {
    const owner = (await loginOwner(call)).json.token;
    const support = (await call('POST', '/api/admin/login', { email: 'support@test.fr', password: 'motdepasse-support' })).json.token;
    assert.equal((await call('GET', '/api/admin/backups', null, support)).status, 403);

    // État de départ : un utilisateur, une annonce
    await call('POST', '/api/auth/register', { email: 'avant@test.fr', password: 'secret123', name: 'Avant' });
    await call('PUT', '/api/admin/settings', { announcement: 'Version sauvegardée' }, owner);
    const made = await call('POST', '/api/admin/backups', null, owner);
    assert.equal(made.status, 200);
    const name = made.json.backup.name;
    assert.match(name, /^pagio-\d{8}-\d{6}-manuelle\.db\.gz$/);
    assert.ok(made.json.backup.bytes > 0);
    assert.equal((await call('GET', '/api/admin/backups', null, owner)).json.backups.length, 1);
    assert.equal((await call('POST', `/api/admin/backups/${name}/verify`, null, owner)).json.counts.users, 1);

    // Téléchargement : fichier gzip, et impossible de sortir du dossier des sauvegardes
    const dl = await raw('GET', `/api/admin/backups/${name}`, undefined, owner);
    assert.equal(dl.status, 200);
    const bytes = Buffer.from(await dl.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 2)], [0x1f, 0x8b]);
    assert.equal((await call('GET', '/api/admin/backups/..%2Fpagio.db', null, owner)).status, 404);
    assert.equal((await call('GET', '/api/admin/backups/pagio-20310101-000000-absente.db.gz', null, owner)).status, 404);

    // On abîme les données, puis on restaure
    const id = (await call('GET', '/api/admin/users', null, owner)).json.users[0].id;
    await call('DELETE', `/api/admin/users/${id}`, null, owner);
    await call('POST', '/api/auth/register', { email: 'apres@test.fr', password: 'secret123' });
    await call('PUT', '/api/admin/settings', { announcement: 'Modifiée après' }, owner);
    assert.equal((await call('POST', `/api/admin/backups/${name}/restore`, { password: 'faux' }, owner)).status, 400);
    assert.equal((await call('GET', '/api/admin/users', null, owner)).json.users[0].email, 'apres@test.fr'); // rien n'a bougé
    const restored = await call('POST', `/api/admin/backups/${name}/restore`, { password: 'motdepasse-admin' }, owner);
    assert.equal(restored.status, 200);
    assert.match(restored.json.safety, /avant-restauration/);
    const users = (await call('GET', '/api/admin/users', null, owner)).json; // la session du propriétaire reste valide
    assert.equal(users.total, 1);
    assert.equal(users.users[0].email, 'avant@test.fr');
    assert.equal((await call('GET', '/api/app/config')).json.announcement, 'Version sauvegardée');
    assert.equal((await call('POST', '/api/auth/login', { email: 'avant@test.fr', password: 'secret123' })).status, 200);
    assert.equal(Object.keys((await call('GET', '/api/app/config')).json.tools).length, 40);
    // L'état d'avant la restauration a été mis de côté et peut lui aussi être restauré
    const safety = await call('POST', `/api/admin/backups/${restored.json.safety}/restore`, { password: 'motdepasse-admin' }, owner);
    assert.equal(safety.status, 200);
    assert.equal((await call('GET', '/api/admin/users', null, owner)).json.users[0].email, 'apres@test.fr');

    // Import : un fichier quelconque est refusé, une vraie sauvegarde est acceptée
    const before = (await call('GET', '/api/admin/backups', null, owner)).json.backups.length;
    assert.equal((await raw('POST', '/api/admin/backups/import', Buffer.from('pas une base'), owner)).status, 400);
    assert.equal((await call('GET', '/api/admin/backups', null, owner)).json.backups.length, before); // rien n'est resté sur le disque
    const imp = await raw('POST', '/api/admin/backups/import', bytes, owner);
    assert.equal(imp.status, 200);
    assert.match((await imp.json()).backup.name, /importee/);
    assert.equal((await call('DELETE', `/api/admin/backups/${name}`, null, owner)).status, 200);
    assert.ok((await call('GET', '/api/admin/audit', null, owner)).json.audit.some((a) => a.action === 'backup.delete'));
  } finally {
    server.close();
  }
});

test('sauvegarde automatique : une par jour à partir de l\'heure choisie, purge des anciennes', async () => {
  const { server, db, dataDir } = await boot();
  try {
    const dir = path.join(dataDir, 'backups');
    const conf = { enabled: true, hour: 3, keep_days: 30 };
    assert.equal(runScheduledBackup(db, dir, conf, new Date(2031, 0, 15, 2, 0, 0)), null); // trop tôt
    assert.equal(runScheduledBackup(db, dir, { ...conf, enabled: false }, new Date(2031, 0, 15, 4)), null); // désactivée
    const auto = runScheduledBackup(db, dir, conf, new Date(2031, 0, 15, 4, 0, 0));
    assert.equal(auto.kind, 'auto');
    assert.equal(runScheduledBackup(db, dir, conf, new Date(2031, 0, 15, 9, 0, 0)), null); // déjà faite aujourd'hui
    assert.equal(runScheduledBackup(db, dir, conf, new Date(2031, 0, 16, 3, 5, 0)).kind, 'auto'); // le lendemain
    assert.equal(listBackups(dir).length, 2);
    assert.equal(pruneBackups(dir, 30, new Date(2031, 1, 14, 3).getTime()), 0); // 30 jours pas encore écoulés
    assert.equal(pruneBackups(dir, 30, new Date(2031, 1, 15, 3).getTime()), 1); // la plus ancienne expire
    assert.equal(listBackups(dir).length, 1);
  } finally {
    server.close();
  }
});
