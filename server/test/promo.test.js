// Codes promo (Premium, crédits, remise) et parrainage (récompense au premier paiement du filleul).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, loginOwner } from './helpers.js';

const day = (offset = 0) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };

test('codes promo : création, utilisation unique par compte, limite, expiration, désactivation', async () => {
  const { server, call } = await boot();
  try {
    const owner = (await loginOwner(call)).json.token;
    assert.equal((await call('POST', '/api/admin/promo', { code: 'bienvenue7', kind: 'premium_days', value: 7, max_uses: 2 }, owner)).status, 200);
    assert.equal((await call('POST', '/api/admin/promo', { code: 'BIENVENUE7', kind: 'premium_days', value: 7 }, owner)).status, 409);
    await call('POST', '/api/admin/promo', { code: 'IA50', kind: 'ai_credits', value: 50 }, owner);
    await call('POST', '/api/admin/promo', { code: 'MOINS20', kind: 'discount_pct', value: 20 }, owner);
    await call('POST', '/api/admin/promo', { code: 'VIEUX', kind: 'ai_credits', value: 5, expires: day(-1) }, owner);

    const users = [];
    for (const e of ['a@x.ci', 'b@x.ci', 'c@x.ci']) users.push((await call('POST', '/api/auth/register', { email: e, password: 'motdepasse1' })).json.token);
    const r = await call('POST', '/api/me/redeem', { code: ' bienvenue7 ' }, users[0]);
    assert.equal(r.status, 200);
    assert.equal(r.json.user.plan, 'premium');
    assert.equal(r.json.user.premium_until, day(7));
    assert.equal((await call('POST', '/api/me/redeem', { code: 'BIENVENUE7' }, users[0])).status, 400); // déjà utilisé par ce compte
    assert.equal((await call('POST', '/api/me/redeem', { code: 'BIENVENUE7' }, users[1])).status, 200);
    assert.equal((await call('POST', '/api/me/redeem', { code: 'BIENVENUE7' }, users[2])).status, 400); // limite de 2 atteinte
    assert.equal((await call('POST', '/api/me/redeem', { code: 'IA50' }, users[2])).json.user.ai_credits, 20 + 50);
    assert.match((await call('POST', '/api/me/redeem', { code: 'MOINS20' }, users[2])).json.message, /20 %/);
    assert.equal((await call('POST', '/api/me/redeem', { code: 'VIEUX' }, users[2])).status, 400);
    assert.equal((await call('POST', '/api/me/redeem', { code: 'INCONNU' }, users[2])).status, 404);
    await call('PATCH', '/api/admin/promo/IA50', { active: false }, owner);
    assert.equal((await call('POST', '/api/me/redeem', { code: 'IA50' }, users[0])).status, 404);
    const list = (await call('GET', '/api/admin/promo', null, owner)).json;
    assert.equal(list.codes.find((c) => c.code === 'BIENVENUE7').uses, 2);
    assert.equal(list.redemptions.length, 4);
  } finally {
    server.close();
  }
});

test('parrainage : lien personnel, filleul inscrit, parrain récompensé au premier paiement seulement', async () => {
  const { server, call } = await boot();
  try {
    const owner = (await loginOwner(call)).json.token;
    const parrain = (await call('POST', '/api/auth/register', { email: 'parrain@x.ci', password: 'motdepasse1' })).json.token;
    const ref = (await call('GET', '/api/me/referral', null, parrain)).json;
    assert.match(ref.link, /\?ref=[A-F0-9]{7}$/);
    const filleul = await call('POST', '/api/auth/register', { email: 'filleul@x.ci', password: 'motdepasse1', ref: ref.code.toLowerCase() });
    assert.equal(filleul.status, 200);
    assert.equal((await call('GET', '/api/me/referral', null, parrain)).json.invited, 1);
    const fid = filleul.json.user.id;
    // Un Premium offert au filleul ne récompense pas le parrain ; son premier vrai paiement, si.
    await call('POST', `/api/admin/users/${fid}/payments`, { offer: 'custom', days: 3, method: 'gift', note: 'test' }, owner);
    assert.equal((await call('GET', '/api/me', null, parrain)).json.user.plan, 'free');
    await call('POST', `/api/admin/users/${fid}/payments`, { offer: 'month', amount: 3000, method: 'wave', reference: 'W1' }, owner);
    let me = (await call('GET', '/api/me', null, parrain)).json.user;
    assert.equal(me.plan, 'premium');
    assert.equal(me.premium_until, day(7));
    // Deuxième paiement du filleul : pas de nouvelle récompense
    await call('POST', `/api/admin/users/${fid}/payments`, { offer: 'month', amount: 3000, method: 'wave', reference: 'W2' }, owner);
    me = (await call('GET', '/api/me', null, parrain)).json.user;
    assert.equal(me.premium_until, day(7));
    const r = (await call('GET', '/api/me/referral', null, parrain)).json;
    assert.equal(r.rewarded, 1);
    assert.equal((await call('GET', '/api/admin/promo', null, owner)).json.referral_stats.top[0].email, 'parrain@x.ci');
  } finally {
    server.close();
  }
});
