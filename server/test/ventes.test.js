// Ventes : tarifs réglables, paiements enregistrés à la main, Premium offert, revenus, coût de l'IA, crédits mensuels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, loginOwner } from './helpers.js';

const day = (offset = 0) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };

test('ventes : tarifs, paiement mobile money, prolongation, Premium offert, recharge IA, remboursement, revenus', async () => {
  const { server, call, db } = await boot();
  try {
    const admin = (await loginOwner(call)).json.token;
    const support = (await call('POST', '/api/admin/login', { email: 'support@test.fr', password: 'motdepasse-support' })).json.token;

    // Tarifs par défaut, visibles par l'application et le site ; modifiables par l'administrateur
    let cfg = (await call('GET', '/api/app/config')).json.prices;
    assert.deepEqual([cfg.week, cfg.month, cfg.year], [1000, 3000, 30000]);
    await call('PUT', '/api/admin/settings', { sales: { price_month: 3500, play_markup_pct: 17.65, usd_xof: 'abc' } }, admin);
    cfg = (await call('GET', '/api/app/config')).json.prices;
    assert.equal(cfg.month, 3500);

    const u = (await call('POST', '/api/admin/users', { email: 'client@test.fr', password: 'motdepasse1' }, admin)).json.user;

    // Le rôle support ne peut pas enregistrer de vente
    assert.equal((await call('POST', `/api/admin/users/${u.id}/payments`, { offer: 'month', amount: 3500, method: 'wave' }, support)).status, 403);
    // Contrôles
    assert.equal((await call('POST', `/api/admin/users/${u.id}/payments`, { offer: 'month', amount: 3500, method: 'paypal' }, admin)).status, 400);
    assert.equal((await call('POST', `/api/admin/users/${u.id}/payments`, { offer: 'month', method: 'gift' }, admin)).status, 400); // motif exigé

    // Paiement d'un mois : Premium jusqu'à J+30, crédits IA inclus
    const p1 = await call('POST', `/api/admin/users/${u.id}/payments`, { offer: 'month', amount: 3500, method: 'orange_money', reference: 'OM123' }, admin);
    assert.equal(p1.status, 200);
    assert.equal(p1.json.user.plan, 'premium');
    assert.equal(p1.json.user.premium_until, day(30));
    assert.equal(p1.json.user.ai_credits, 300);
    // Même référence : refusée (doublon)
    assert.equal((await call('POST', `/api/admin/users/${u.id}/payments`, { offer: 'month', amount: 3500, method: 'orange_money', reference: 'OM123' }, admin)).status, 409);

    // Une semaine de plus s'ajoute à l'échéance en cours
    const p2 = await call('POST', `/api/admin/users/${u.id}/payments`, { offer: 'week', amount: 1000, method: 'wave' }, admin);
    assert.equal(p2.json.user.premium_until, day(37));

    // Premium offert (testeur) : montant 0, hors revenus
    const g = await call('POST', `/api/admin/users/${u.id}/payments`, { offer: 'custom', days: 3, method: 'gift', note: 'Testeur' }, admin);
    assert.equal(g.status, 200);
    assert.equal(g.json.payment.amount, 0);
    assert.equal(g.json.user.premium_until, day(40));

    // Recharge IA : crédits ajoutés au solde
    const pack = await call('POST', `/api/admin/users/${u.id}/payments`, { kind: 'ai_pack', amount: 1000, method: 'mtn' }, admin);
    assert.equal(pack.json.user.ai_credits, 400);

    // Historique des offres et journal d'audit
    const fiche = (await call('GET', `/api/admin/users/${u.id}`, null, admin)).json;
    assert.ok(fiche.plan_history.some((h) => /Premium offert : Testeur/.test(h.reason || '')));
    assert.ok(db.prepare("SELECT 1 FROM audit WHERE action = 'payment.gift'").get());

    // Coût de l'IA : 4 millions de caractères envoyés = 1 million de jetons à 0,40 $ = 240 F au taux de 600
    db.prepare('INSERT INTO ai_usage (ts, user_id, chars_in, chars_out, credits, provider, ok) VALUES (?, ?, 4000000, 0, 1, ?, 1)').run(Date.now(), u.id, 'openai');

    let r = (await call('GET', '/api/admin/revenue?days=30', null, admin)).json;
    assert.equal(r.total, 3500 + 1000 + 1000);
    assert.equal(r.count, 3);
    assert.equal(r.gifts.n, 1);
    assert.equal(r.buyers, 1);
    assert.equal(r.premium_active, 1);
    assert.equal(r.ai.cost, 240);
    assert.equal(r.margin, 5500 - 240);
    assert.equal(r.by_method.find((m) => m.method === 'orange_money').amount, 3500);
    // Google Play : 3 500 × 1,1765 = 4 118 → arrondi à 4 100 ; net après 15 % = 3 485
    assert.deepEqual(r.play.month, { base: 3500, price: 4100, net: 3485 });

    // Remboursement : sort des revenus, Premium conservé
    assert.equal((await call('POST', `/api/admin/payments/${p2.json.payment.id}/refund`, {}, admin)).status, 200);
    assert.equal((await call('POST', `/api/admin/payments/${p2.json.payment.id}/refund`, {}, admin)).status, 400);
    r = (await call('GET', '/api/admin/revenue?days=30', null, admin)).json;
    assert.equal(r.total, 4500);
    assert.equal(r.refunds.n, 1);
    const list = (await call('GET', '/api/admin/payments?q=client', null, admin)).json.payments;
    assert.equal(list.length, 4);

    // Suppression du compte : la vente reste comptée, sans l'identité de l'acheteur
    await call('DELETE', `/api/admin/users/${u.id}`, null, admin);
    const rows = db.prepare('SELECT user_id, user_email, reference FROM payments').all();
    assert.ok(rows.every((x) => x.user_id === null && x.user_email === null && x.reference === null));
    assert.equal((await call('GET', '/api/admin/revenue?days=30', null, admin)).json.total, 4500);
  } finally {
    server.close();
  }
});

test('Premium : crédits IA inclus remis à niveau une fois par mois, jamais diminués', async () => {
  const { server, call, db } = await boot();
  try {
    const admin = (await loginOwner(call)).json.token;
    const u = (await call('POST', '/api/admin/users', { email: 'mensuel@test.fr', password: 'motdepasse1' }, admin)).json.user;
    await call('POST', `/api/admin/users/${u.id}/payments`, { offer: 'year', amount: 30000, method: 'cash' }, admin);
    // Le mois dernier, il a consommé presque tous ses crédits
    db.prepare("UPDATE users SET ai_credits = 12, credits_month = '2000-01' WHERE id = ?").run(u.id);
    const token = (await call('POST', '/api/auth/login', { email: 'mensuel@test.fr', password: 'motdepasse1' })).json.token;
    const me = (await call('GET', '/api/me', null, token)).json.user;
    assert.equal(me.ai_credits, 300);
    // Un solde plus élevé (recharges achetées) n'est jamais réduit
    db.prepare("UPDATE users SET ai_credits = 900, credits_month = '2000-01' WHERE id = ?").run(u.id);
    assert.equal((await call('GET', '/api/me', null, token)).json.user.ai_credits, 900);
  } finally {
    server.close();
  }
});
