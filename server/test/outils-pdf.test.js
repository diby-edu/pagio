// Outils PDF du serveur (étape 4, vague 2) : contrôles d'accès, fichiers refusés, nettoyage des pages HTML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';
import { cleanHtml } from '../src/services.js';

test('outils PDF du serveur : outil inconnu, compte exigé, fichier qui n\'est pas un PDF, outil désactivé', async () => {
  const { server, call, raw, db } = await boot();
  try {
    const token = (await call('POST', '/api/auth/register', { email: 'u@x.ci', password: 'motdepasse1' })).json.token;
    assert.equal((await raw('POST', '/api/pdf/inconnu', Buffer.from('%PDF-1.4'), token)).status, 404);
    assert.equal((await raw('POST', '/api/pdf/compress', Buffer.from('%PDF-1.4'))).status, 401); // compte exigé par défaut
    const r = await raw('POST', '/api/pdf/compress', Buffer.from('bonjour'), token);
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /pas un PDF/);
    assert.equal((await raw('POST', '/api/pdf/protect', Buffer.from('%PDF-1.4\n'), token)).status, 400); // mot de passe manquant
    db.prepare("INSERT OR REPLACE INTO tools (id, enabled) VALUES ('repair', 0)").run();
    assert.equal((await raw('POST', '/api/pdf/repair', Buffer.from('%PDF-1.4'), token)).status, 403);
    // Les échecs sont comptés dans les conversions (tableau de bord).
    assert.ok(db.prepare("SELECT COUNT(*) n FROM conversions WHERE target IN ('compress', 'protect') AND ok = 0").get().n >= 2);
  } finally { server.close(); }
});

test('HTML en PDF : scripts, cadres et ressources externes retirés, images intégrées gardées', () => {
  const out = cleanHtml(`<style>p{background:url(http://10.0.0.1/x)}</style><p>Texte<img src="http://169.254.169.254/">
    <img src='data:image/png;base64,AA'><a href="file:///etc/passwd">l</a><script>alert(1)</script><SCRIPT src=y></SCRIPT>
    <iframe src="http://intra"></iframe><link rel=stylesheet href="https://x/a.css"><base href="http://x/"></p>`);
  assert.doesNotMatch(out, /http|file:|script|iframe|<link|<base/i);
  assert.match(out, /data:image\/png;base64,AA/);
  assert.match(out, /Texte/);
});
