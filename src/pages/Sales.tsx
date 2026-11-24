import { useCallback, useEffect, useState } from 'react';
import { METHOD_LABELS, OFFER_LABELS, Payment, Revenue, User, api, fmtDate, fmtMoney, fmtNum } from '../api';
import { Alert, Badge, BarChart, Card, Empty, Field, Kpi, useFlash } from '../ui';

const PERIODS = [7, 30, 90, 365];
const short = (day: string) => day.slice(5).split('-').reverse().join('/');

/** Ventes et revenus : chiffre d'affaires, offres, moyens de paiement, coût de l'IA, marge, et liste des paiements. */
export default function Sales({ canEdit }: { canEdit: boolean }) {
  const [days, setDays] = useState(30);
  const [rev, setRev] = useState<Revenue | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [flash, show] = useFlash();

  const load = useCallback(() => {
    api<Revenue>('GET', `/api/admin/revenue?days=${days}`).then(setRev).catch((e) => setError(e.message));
    api<{ payments: Payment[] }>('GET', `/api/admin/payments?days=${days}&q=${encodeURIComponent(q)}`).then((r) => setPayments(r.payments)).catch((e) => setError(e.message));
  }, [days, q]);
  useEffect(() => { load(); }, [load]);

  if (error) return <Alert>{error}</Alert>;
  if (!rev) return <div className="muted">Chargement…</div>;

  return (
    <div className="stack">
      {flash}
      <div className="row gap wrap">
        {PERIODS.map((d) => <button key={d} className={`btn small${d === days ? ' primary' : ''}`} onClick={() => setDays(d)}>{d === 365 ? '1 an' : `${d} jours`}</button>)}
      </div>
      <div className="kpis">
        <Kpi label={`Revenus (${days} j)`} value={fmtMoney(rev.total)} hint={`${fmtNum(rev.count)} paiement(s) · panier moyen ${fmtMoney(rev.average)}`} />
        <Kpi label="Ce mois-ci" value={fmtMoney(rev.month)} hint={`${fmtNum(rev.month_count)} paiement(s)`} tone="teal" />
        <Kpi label="Premium actifs" value={fmtNum(rev.premium_active)} hint={`${fmtNum(rev.premium_expiring_7d)} échéance(s) dans 7 jours`} tone="violet" />
        <Kpi label="Clients payants" value={fmtNum(rev.buyers)} hint={`${fmtNum(rev.gifts.n)} Premium offert(s) · ${fmtNum(rev.refunds.n)} remboursement(s)`} tone="coral" />
        <Kpi label={`Coût de l'IA (${days} j)`} value={fmtMoney(rev.ai.cost)} hint={`${fmtNum(rev.ai.requests)} requête(s) · ${rev.ai.cost_per_request.toLocaleString('fr-FR')} F par requête`} tone="amber" />
        <Kpi label="Marge (revenus − IA)" value={fmtMoney(rev.margin)} hint="avant commissions des opérateurs" tone={rev.margin >= 0 ? 'teal' : 'coral'} />
      </div>
      <div className="grid2">
        <Card title="Revenus par jour"><BarChart data={rev.by_day.map((d) => ({ label: short(d.day), value: d.amount }))} /></Card>
        <Card title="Coût de l'IA par jour (F)"><BarChart data={rev.ai.by_day.map((d) => ({ label: short(d.day), value: d.cost }))} color="#E08A1E" /></Card>
      </div>
      <div className="grid2">
        <Card title="Par offre">
          {rev.by_offer.length === 0 ? <Empty>Aucune vente sur la période.</Empty> :
            <table className="table small"><thead><tr><th>Offre</th><th>Ventes</th><th>Montant</th><th>Part</th></tr></thead><tbody>
              {rev.by_offer.map((o) => <tr key={o.offer}><td>{OFFER_LABELS[o.offer] ?? o.offer}</td><td>{fmtNum(o.n)}</td><td>{fmtMoney(o.amount)}</td><td>{rev.total ? Math.round((o.amount / rev.total) * 100) : 0} %</td></tr>)}
            </tbody></table>}
        </Card>
        <Card title="Par moyen de paiement">
          {rev.by_method.length === 0 ? <Empty>Aucune vente sur la période.</Empty> :
            <table className="table small"><thead><tr><th>Moyen</th><th>Ventes</th><th>Montant</th><th>Part</th></tr></thead><tbody>
              {rev.by_method.map((m) => <tr key={m.method}><td>{METHOD_LABELS[m.method] ?? m.method}</td><td>{fmtNum(m.n)}</td><td>{fmtMoney(m.amount)}</td><td>{rev.total ? Math.round((m.amount / rev.total) * 100) : 0} %</td></tr>)}
            </tbody></table>}
        </Card>
      </div>
      <Card title="Paiements" actions={<input placeholder="Rechercher (e-mail, référence)" value={q} onChange={(e) => setQ(e.target.value)} />}>
        <p className="muted small">Pour enregistrer un paiement ou offrir le Premium : page Utilisateurs, ouvrez la fiche du client.</p>
        {!payments ? <div className="muted">Chargement…</div> : payments.length === 0 ? <Empty>Aucun paiement sur la période.</Empty> :
          <div className="table-wrap"><table className="table small"><thead><tr><th>Date</th><th>Client</th><th>Offre</th><th>Montant</th><th>Moyen</th><th>Référence</th><th>Premium jusqu'au</th><th>Par</th><th /></tr></thead><tbody>
            {payments.map((p) => (
              <tr key={p.id} style={p.refunded ? { opacity: 0.55 } : undefined}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(p.ts)}</td>
                <td>{p.user_email ?? <span className="muted">compte supprimé</span>}</td>
                <td>{p.kind === 'ai_pack' ? `Recharge IA (+${fmtNum(p.credits)})` : `${OFFER_LABELS[p.offer ?? ''] ?? p.offer}${p.offer === 'custom' ? ` (${p.days} j)` : ''}`}</td>
                <td>{p.method === 'gift' ? <Badge tone="violet">offert</Badge> : fmtMoney(p.amount)}</td>
                <td>{METHOD_LABELS[p.method] ?? p.method}</td>
                <td>{p.reference ?? '—'}{p.note && <><br /><span className="muted">{p.note}</span></>}</td>
                <td>{p.premium_until ?? '—'}</td>
                <td className="muted">{p.actor ?? '—'}</td>
                <td>{p.refunded ? <Badge tone="red">remboursé</Badge> : canEdit && p.method !== 'gift' &&
                  <button className="btn small ghost" onClick={async () => {
                    if (!confirm(`Marquer ce paiement de ${fmtMoney(p.amount)} comme remboursé ? Il sortira des revenus ; le Premium du client n'est pas retiré automatiquement.`)) return;
                    try { await api('POST', `/api/admin/payments/${p.id}/refund`); show('Paiement marqué remboursé'); load(); } catch (e) { show((e as Error).message, 'error'); }
                  }}>Rembourser</button>}</td>
              </tr>))}
          </tbody></table></div>}
      </Card>
    </div>
  );
}

/** Fiche utilisateur : enregistrer un paiement (Premium ou recharge IA) ou offrir le Premium. */
export function PaymentForm({ user, onDone, onError }: { user: User; onDone: (u: User, msg: string) => void; onError: (m: string) => void }) {
  const [kind, setKind] = useState<'premium' | 'ai_pack' | 'gift'>('premium');
  const [offer, setOffer] = useState('month');
  const [days, setDays] = useState('7');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('orange_money');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [credits, setCredits] = useState('');
  const [prices, setPrices] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Payment[]>([]);
  useEffect(() => {
    api<{ prices: Record<string, number> }>('GET', '/api/app/config').then((c) => setPrices(c.prices)).catch(() => {});
    api<{ payments: Payment[] }>('GET', `/api/admin/payments?days=3660&user=${user.id}`).then((r) => setHistory(r.payments)).catch(() => {});
  }, [user.id, user.premium_until, user.ai_credits]);
  // Montant proposé selon le tarif en vigueur (modifiable : promotion, prix négocié…).
  useEffect(() => {
    if (!prices) return;
    if (kind === 'ai_pack') { setAmount(String(prices.ai_pack_price)); setCredits(String(prices.ai_pack_credits)); }
    else if (kind === 'premium' && offer !== 'custom') setAmount(String(prices[offer] ?? ''));
  }, [kind, offer, prices]);

  const submit = async () => {
    setBusy(true);
    try {
      const body = kind === 'gift'
        ? { kind: 'premium', offer, days: Number(days), method: 'gift', note }
        : { kind, offer, days: Number(days), amount: Number(amount), method, reference, note, credits: Number(credits) };
      const r = await api<{ user: User }>('POST', `/api/admin/users/${user.id}/payments`, body);
      setReference(''); setNote('');
      onDone(r.user, kind === 'gift' ? 'Premium offert' : kind === 'ai_pack' ? 'Recharge IA enregistrée' : 'Paiement enregistré, Premium activé');
    } catch (e) { onError((e as Error).message); }
    setBusy(false);
  };

  return (
    <>
      <div className="row gap wrap">
        {([['premium', 'Paiement Premium'], ['ai_pack', 'Recharge IA'], ['gift', 'Offrir le Premium']] as const).map(([k, l]) =>
          <button key={k} className={`btn small${kind === k ? ' primary' : ''}`} onClick={() => setKind(k)}>{l}</button>)}
      </div>
      <div className="grid2" style={{ marginTop: 8 }}>
        {kind !== 'ai_pack' && <Field label="Durée">
          <select value={offer} onChange={(e) => setOffer(e.target.value)}>
            <option value="week">Semaine (7 jours)</option><option value="month">Mois (30 jours)</option><option value="year">Année (365 jours)</option><option value="custom">Durée libre</option>
          </select></Field>}
        {kind !== 'ai_pack' && offer === 'custom' && <Field label="Nombre de jours"><input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} /></Field>}
        {kind === 'ai_pack' && <Field label="Crédits ajoutés"><input type="number" min={1} value={credits} onChange={(e) => setCredits(e.target.value)} /></Field>}
        {kind !== 'gift' && <Field label="Montant reçu (F CFA)"><input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
        {kind !== 'gift' && <Field label="Moyen de paiement">
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {Object.entries(METHOD_LABELS).filter(([k]) => k !== 'gift' && k !== 'google_play').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></Field>}
        {kind !== 'gift' && <Field label="Référence de la transaction" hint="Numéro du reçu ou de l'opération : évite les doublons."><input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} /></Field>}
        <Field label={kind === 'gift' ? 'Motif (obligatoire)' : 'Note (facultatif)'}><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={kind === 'gift' ? 'Testeur, promotion, geste commercial…' : ''} /></Field>
      </div>
      <button className="btn primary" disabled={busy || (kind === 'gift' && !note.trim()) || (kind !== 'gift' && amount === '')} onClick={submit}>
        {kind === 'gift' ? 'Offrir le Premium' : kind === 'ai_pack' ? 'Enregistrer la recharge' : 'Enregistrer le paiement'}
      </button>
      {kind === 'premium' && <p className="muted small">La durée s'ajoute à l'échéance en cours. Les crédits IA inclus dans le Premium sont remis à niveau.</p>}
      {history.length > 0 && (
        <table className="table small" style={{ marginTop: 8 }}><tbody>{history.map((p) => (
          <tr key={p.id} style={p.refunded ? { opacity: 0.55 } : undefined}><td style={{ whiteSpace: 'nowrap' }}>{fmtDate(p.ts)}</td>
            <td>{p.kind === 'ai_pack' ? `Recharge IA +${p.credits}` : `${OFFER_LABELS[p.offer ?? ''] ?? p.offer}${p.premium_until ? ` → ${p.premium_until}` : ''}`}</td>
            <td>{p.method === 'gift' ? 'offert' : `${fmtMoney(p.amount)} · ${METHOD_LABELS[p.method] ?? p.method}`}{p.refunded ? ' · remboursé' : ''}</td></tr>))}
        </tbody></table>
      )}
    </>
  );
}
