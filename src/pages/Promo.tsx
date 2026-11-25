import { useCallback, useEffect, useState } from 'react';
import { api, fmtDate, fmtNum } from '../api';
import { Alert, Badge, Card, Empty, Field, Kpi, Toggle, useFlash } from '../ui';

interface Code { code: string; kind: 'premium_days' | 'ai_credits' | 'discount_pct'; value: number; max_uses: number; uses: number; expires: string | null; note: string; active: number; created_at: number }
interface Data {
  codes: Code[]; referral: { enabled: boolean; referrer_days: number };
  referral_stats: { invited: number; rewarded: number; top: { email: string; invited: number; paid: number }[] };
  redemptions: { code: string; ts: number; email: string | null }[];
}
const KIND: Record<Code['kind'], (v: number) => string> = {
  premium_days: (v) => `${v} jour(s) de Premium`, ai_credits: (v) => `${v} crédits IA`, discount_pct: (v) => `${v} % de remise`,
};

/** Codes promo (Premium offert, crédits IA, remise) et parrainage. */
export default function Promo({ canEdit }: { canEdit: boolean }) {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [flash, show] = useFlash();
  const [form, setForm] = useState({ code: '', kind: 'premium_days', value: '7', max_uses: '100', expires: '', note: '' });
  const load = useCallback(() => api<Data>('GET', '/api/admin/promo').then(setD).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (error) return <Alert>{error}</Alert>;
  if (!d) return <div className="muted">Chargement…</div>;
  const set = (k: string, v: string) => setForm({ ...form, [k]: v });

  return (
    <div className="stack">
      {flash}
      {canEdit && <Card title="Nouveau code promo">
        <div className="grid2">
          <Field label="Code" hint="Lettres et chiffres, ex. BIENVENUE7"><input value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} maxLength={30} /></Field>
          <Field label="Ce que le code donne"><select value={form.kind} onChange={(e) => set('kind', e.target.value)}>
            <option value="premium_days">Premium offert (jours)</option><option value="ai_credits">Crédits IA</option><option value="discount_pct">Remise sur le prochain paiement (%)</option></select></Field>
          <Field label={form.kind === 'premium_days' ? 'Nombre de jours' : form.kind === 'ai_credits' ? 'Nombre de crédits' : 'Remise (%)'}><input type="number" min={1} value={form.value} onChange={(e) => set('value', e.target.value)} /></Field>
          <Field label="Utilisations maximum" hint="0 = sans limite ; chaque compte ne peut l'utiliser qu'une fois."><input type="number" min={0} value={form.max_uses} onChange={(e) => set('max_uses', e.target.value)} /></Field>
          <Field label="Valable jusqu'au (facultatif)"><input type="date" value={form.expires} onChange={(e) => set('expires', e.target.value)} /></Field>
          <Field label="Note (facultatif)"><input value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="Campagne Facebook novembre…" /></Field>
        </div>
        {form.kind === 'discount_pct' && <p className="muted small">La remise est gardée sur le compte et sera appliquée au prochain paiement en ligne (étape « paiement sur le site »). Pour un paiement enregistré à la main, appliquez-la vous-même.</p>}
        <button className="btn primary" disabled={form.code.length < 3} onClick={async () => {
          try { await api('POST', '/api/admin/promo', { ...form, value: Number(form.value), max_uses: Number(form.max_uses) }); show(`Code ${form.code} créé`); setForm({ ...form, code: '' }); load(); }
          catch (e) { show((e as Error).message, 'error'); }
        }}>Créer le code</button>
      </Card>}

      <Card title="Codes promo">
        {d.codes.length === 0 ? <Empty>Aucun code pour l'instant.</Empty> :
          <div className="table-wrap"><table className="table small"><thead><tr><th>Code</th><th>Donne</th><th>Utilisations</th><th>Valable jusqu'au</th><th>Note</th><th>Actif</th></tr></thead><tbody>
            {d.codes.map((c) => <tr key={c.code} style={c.active ? undefined : { opacity: 0.55 }}>
              <td><code>{c.code}</code></td><td>{KIND[c.kind](c.value)}</td><td>{fmtNum(c.uses)}{c.max_uses ? ` / ${fmtNum(c.max_uses)}` : ''}</td>
              <td>{c.expires ?? '—'}</td><td className="muted">{c.note || '—'}</td>
              <td>{canEdit ? <Toggle checked={!!c.active} onChange={async (v) => { try { await api('PATCH', `/api/admin/promo/${c.code}`, { active: v }); load(); } catch (e) { show((e as Error).message, 'error'); } }} /> : (c.active ? 'oui' : 'non')}</td>
            </tr>)}
          </tbody></table></div>}
        {d.redemptions.length > 0 && <><h4>Dernières utilisations</h4>
          <table className="table small"><tbody>{d.redemptions.slice(0, 20).map((r, i) => <tr key={i}><td>{fmtDate(r.ts)}</td><td><code>{r.code}</code></td><td>{r.email ?? <span className="muted">compte supprimé</span>}</td></tr>)}</tbody></table></>}
      </Card>

      <Card title="Parrainage">
        <div className="kpis">
          <Kpi label="Filleuls inscrits" value={fmtNum(d.referral_stats.invited)} />
          <Kpi label="Filleuls ayant payé" value={fmtNum(d.referral_stats.rewarded)} hint="parrains récompensés" tone="teal" />
        </div>
        <p>Chaque utilisateur a un lien personnel (dans son compte). Quand une personne inscrite avec ce lien fait son <b>premier paiement</b>, le parrain reçoit des jours de Premium. Rien n'est donné à l'inscription : les faux comptes ne rapportent rien.</p>
        {canEdit && <div className="row gap wrap" style={{ alignItems: 'end' }}>
          <Toggle checked={d.referral.enabled} onChange={async (v) => { try { await api('PUT', '/api/admin/settings', { referral: { ...d.referral, enabled: v } }); load(); } catch (e) { show((e as Error).message, 'error'); } }} label="Parrainage actif" />
          <Field label="Jours de Premium pour le parrain"><input type="number" min={0} max={365} defaultValue={d.referral.referrer_days} onBlur={async (e) => {
            try { await api('PUT', '/api/admin/settings', { referral: { ...d.referral, referrer_days: Number(e.target.value) } }); show('Enregistré'); load(); } catch (err) { show((err as Error).message, 'error'); }
          }} style={{ width: 100 }} /></Field>
        </div>}
        {d.referral_stats.top.length > 0 && <><h4>Meilleurs parrains</h4>
          <table className="table small"><thead><tr><th>Parrain</th><th>Filleuls</th><th>Ont payé</th></tr></thead><tbody>
            {d.referral_stats.top.map((t) => <tr key={t.email}><td>{t.email}</td><td>{t.invited}</td><td>{t.paid ? <Badge tone="teal">{t.paid}</Badge> : 0}</td></tr>)}
          </tbody></table></>}
      </Card>
    </div>
  );
}
