// Support : réponse par e-mail depuis le tableau de bord, statut, réponses toutes prêtes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, loginOwner } from './helpers.js';

test('support : réponse par e-mail depuis le tableau de bord, statut traité, réponses toutes prêtes', async () => {
  const sent = [];
  const { server, call, db } = await boot({ sendMail: async (cfg, m) => { sent.push(m); } });
  try {
    const owner = (await loginOwner(call)).json.token;
    await call('PUT', '/api/admin/settings', { mail: { enabled: true, api_key: 'xkeysib-test', from_email: 'noreply@pagio.site', public_url: 'https://pagio.site' } }, owner);
    await call('POST', '/api/app/feedback', { kind: 'bug', message: 'Le scan se ferme', email: 'client@exemple.ci' });
    await call('POST', '/api/app/feedback', { kind: 'contact', message: 'Bonjour sans adresse' });
    const list = (await call('GET', '/api/admin/feedback', null, owner)).json;
    assert.ok(list.templates.length >= 3);
    const withMail = list.feedback.find((f) => f.email);
    const r = await call('POST', `/api/admin/feedback/${withMail.id}/reply`, { message: 'Corrigé dans la 2.1.0, merci !' }, owner);
    assert.equal(r.status, 200);
    const m = sent.at(-1);
    assert.equal(m.to, 'client@exemple.ci');
    assert.equal(m.replyTo, 'contact@pagio.site');
    assert.match(m.text, /Corrigé dans la 2\.1\.0/);
    assert.match(m.text, /Le scan se ferme/);
    const after = (await call('GET', '/api/admin/feedback', null, owner)).json.feedback.find((f) => f.id === withMail.id);
    assert.equal(after.status, 'traité');
    assert.equal(after.replies.length, 1);
    // Sans adresse : refus clair
    const noMail = list.feedback.find((f) => !f.email);
    assert.equal((await call('POST', `/api/admin/feedback/${noMail.id}/reply`, { message: 'Bonjour' }, owner)).status, 400);
    // Réponses toutes prêtes modifiables (les vides sont ignorées)
    const t = await call('PUT', '/api/admin/support/templates', { templates: [{ title: 'Salut', body: 'Bonjour !' }, { title: '', body: 'vide' }] }, owner);
    assert.deepEqual(t.json.templates, [{ title: 'Salut', body: 'Bonjour !' }]);
    assert.ok(db.prepare("SELECT 1 FROM audit WHERE action = 'feedback.reply'").get());
  } finally {
    server.close();
  }
});
