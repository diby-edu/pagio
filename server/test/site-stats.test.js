// Statistiques du site sans cookies : pages vues, provenance, pays, appareils, robots exclus, outils en ligne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, loginOwner } from './helpers.js';
import { classifySource, countryOf, parseUA, visitorId } from '../src/sitestats.js';

const PHONE = 'Mozilla/5.0 (Linux; Android 14; 22071212AG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

test('statistiques du site : classement de la provenance, du pays et de l\'appareil', () => {
  assert.equal(classifySource('https://www.google.com/', '', []).source, 'Google');
  assert.equal(classifySource('https://l.facebook.com/l.php?u=x', '', []).source, 'Facebook');
  assert.equal(classifySource('', 'WhatsApp', []).source, 'whatsapp');
  assert.equal(classifySource('https://pagio.site/outils/', '', ['pagio.site']).source, 'interne');
  assert.deepEqual(classifySource('https://blog.exemple.ci/x', '', []), { source: 'autre site', ref_domain: 'blog.exemple.ci' });
  assert.equal(classifySource('', '', []).source, 'direct');
  assert.equal(countryOf('Africa/Abidjan', 'fr'), 'CI');
  assert.equal(countryOf('', 'fr-SN'), 'SN');
  assert.equal(parseUA(PHONE).device, 'téléphone');
  assert.deepEqual(parseUA(PC), { device: 'ordinateur', browser: 'Chrome', os: 'Windows' });
  // Empreinte : stable dans la journée, différente le lendemain (le sel change)
  const d1 = new Date('2026-11-25T10:00:00Z');
  assert.equal(visitorId('1.2.3.4', PC, d1), visitorId('1.2.3.4', PC, new Date('2026-11-25T18:00:00Z')));
  assert.notEqual(visitorId('1.2.3.4', PC, d1), visitorId('1.2.3.4', PC, new Date('2026-11-26T10:00:00Z')));
});

test('statistiques du site : pages vues, visiteurs, robots ignorés, outils en ligne, tableau de bord', async () => {
  const { server, call, db } = await boot();
  const hit = (body, ua) => fetch(`${server.base}/api/site/hit`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': ua }, body: JSON.stringify(body) });
  try {
    await hit({ path: '/', ref: 'https://www.google.com/', tz: 'Africa/Abidjan', lang: 'fr-FR', w: 400 }, PHONE);
    await hit({ path: '/compresser-pdf/?x=1', ref: 'https://pagio.site/', tz: 'Africa/Abidjan', lang: 'fr' }, PHONE);
    await hit({ path: '/telecharger/pagio.apk', ref: 'https://pagio.site/' }, PHONE);
    await hit({ path: '/', ref: '', tz: 'Europe/Paris', lang: 'fr-FR', w: 1920 }, PC);
    await hit({ path: '/', ref: '' }, 'Googlebot/2.1 (+http://www.google.com/bot.html)'); // robot : ignoré
    await fetch(`${server.base}/api/site/event`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': PC },
      body: JSON.stringify({ name: 'tool_run', tool: 'merge', ok: true, ms: 800, files: 2, bytes_in: 5000, tz: 'Europe/Paris' }) });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM site_hits').get().n, 4);
    assert.ok(!db.prepare('SELECT 1 FROM site_hits WHERE path LIKE ?').get('%?%')); // paramètres retirés de l'adresse
    const owner = (await loginOwner(call)).json.token;
    const s = (await call('GET', '/api/admin/site-stats?days=7', null, owner)).json;
    assert.equal(s.views, 4);
    assert.equal(s.visitors, 2);
    assert.equal(s.apk_downloads, 1);
    assert.equal(s.countries.find((c) => c.k === 'CI').visitors, 1);
    assert.equal(s.sources.find((c) => c.k === 'Google').visitors, 1);
    assert.equal(s.devices.find((c) => c.k === 'téléphone').views, 3);
    assert.equal(s.online_tools[0].tool, 'merge');
    assert.equal(s.bounce_pct, 50); // le visiteur sur ordinateur n'a vu qu'une page
    // Événement inconnu : ignoré
    await fetch(`${server.base}/api/site/event`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': PC }, body: JSON.stringify({ name: 'x' }) });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM events WHERE app_version = 'web'").get().n, 1);
  } finally {
    server.close();
  }
});
