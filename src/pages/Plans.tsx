import { useState } from 'react';
import { PlanLimits, Sales, api, fmtMoney } from '../api';
import { Alert, Card, Field, useFlash } from '../ui';
import { useSettings } from './useSettings';

/** Prix Google Play : majorés pour compenser la commission de 15 %, arrondis à 50 F (même calcul que le serveur). */
const play = (price: number, pct: number) => { const p = Math.round((price * (1 + pct / 100)) / 50) * 50; return { price: p, net: Math.round(p * 0.85) }; };

export default function Plans() {
  const { settings, error, save } = useSettings();
  const [flash, show] = useFlash();
  const [draft, setDraft] = useState<{ free: PlanLimits; premium: PlanLimits } | null>(null);
  const [salesDraft, setSalesDraft] = useState<Sales | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!settings) return <div className="muted">Chargement…</div>;
  const plans = draft ?? settings.plans;
  const sales = salesDraft ?? settings.sales;
  const set = (p: 'free' | 'premium', k: keyof PlanLimits, v: string) => setDraft({ ...plans, [p]: { ...plans[p], [k]: Math.max(0, Number(v) || 0) } });
  const setS = (k: keyof Sales, v: string) => setSalesDraft({ ...sales, [k]: Math.max(0, Number(v) || 0) });
  const money = (k: keyof Sales, label: string, hint?: string) => (
    <Field label={label} hint={hint}><input type="number" min={0} step={50} value={sales[k]} onChange={(e) => setS(k, e.target.value)} /></Field>
  );
  const rows: [string, number][] = [['Semaine', sales.price_week], ['Mois', sales.price_month], ['Année', sales.price_year], [`Recharge IA (${sales.ai_pack_credits} crédits)`, sales.ai_pack_price]];
  const changed = !!draft || !!salesDraft;

  return (
    <div className="stack">
      {flash}
      <div className="grid2">
        <Card title="Tarifs du Premium (francs CFA)">
          <div className="grid2">
            {money('price_week', 'Semaine (7 jours)')}
            {money('price_month', 'Mois (30 jours)')}
            {money('price_year', 'Année (365 jours)', sales.price_month ? `Soit ${Math.round((1 - sales.price_year / (sales.price_month * 12)) * 100)} % d'économie par rapport à 12 mois` : undefined)}
          </div>
          <p className="muted small">Affichés dans l'application et sur le site ; proposés automatiquement quand vous enregistrez un paiement.</p>
        </Card>
        <Card title="Crédits IA">
          <div className="grid2">
            <Field label="Inclus chaque mois dans le Premium" hint="Solde remis à ce niveau chaque mois (jamais diminué)."><input type="number" min={0} value={plans.premium.ai_credits} onChange={(e) => set('premium', 'ai_credits', e.target.value)} /></Field>
            <Field label="Offerts à l'inscription (gratuit)"><input type="number" min={0} value={plans.free.ai_credits} onChange={(e) => set('free', 'ai_credits', e.target.value)} /></Field>
            <Field label="Recharge : nombre de crédits"><input type="number" min={1} value={sales.ai_pack_credits} onChange={(e) => setS('ai_pack_credits', e.target.value)} /></Field>
            {money('ai_pack_price', 'Recharge : prix (F CFA)')}
          </div>
        </Card>
      </div>

      <Card title="Prix à saisir dans Google Play">
        <div className="row gap wrap">
          <Field label="Majoration (%)" hint="15 % : prix +15 %. 17,65 % : vous touchez exactement le prix du site après la commission de Google.">
            <input type="number" min={0} max={100} step={0.05} value={sales.play_markup_pct} onChange={(e) => setS('play_markup_pct', e.target.value)} style={{ width: 120 }} />
          </Field>
          <div className="row gap" style={{ alignSelf: 'center' }}>
            <button className="btn small" onClick={() => setS('play_markup_pct', '15')}>15 %</button>
            <button className="btn small" onClick={() => setS('play_markup_pct', '17.65')}>17,65 %</button>
          </div>
        </div>
        <table className="table small"><thead><tr><th>Offre</th><th>Prix du site</th><th>Prix Google Play</th><th>Vous touchez (après 15 %)</th></tr></thead><tbody>
          {rows.map(([n, p]) => { const g = play(p, sales.play_markup_pct); return <tr key={n}><td>{n}</td><td>{fmtMoney(p)}</td><td><b>{fmtMoney(g.price)}</b></td><td>{fmtMoney(g.net)}</td></tr>; })}
        </tbody></table>
        <p className="muted small">Arrondi à 50 F. À recopier dans la console Google Play (Monétiser › Produits) lors de la publication.</p>
      </Card>

      <Card title="Coût de l'IA (pour l'écran Ventes et revenus)">
        <div className="row gap wrap">
          <Field label="Prix d'entrée ($ par million de jetons)"><input type="number" min={0} step={0.01} value={sales.ai_usd_per_m_in} onChange={(e) => setS('ai_usd_per_m_in', e.target.value)} /></Field>
          <Field label="Prix de sortie ($ par million de jetons)"><input type="number" min={0} step={0.01} value={sales.ai_usd_per_m_out} onChange={(e) => setS('ai_usd_per_m_out', e.target.value)} /></Field>
          <Field label="1 dollar = (F CFA)"><input type="number" min={1} value={sales.usd_xof} onChange={(e) => setS('usd_xof', e.target.value)} /></Field>
        </div>
        <p className="muted small">Par défaut : tarif de gpt-4.1-mini (0,40 $ / 1,60 $). Un jeton ≈ 4 caractères ; c'est une estimation, la facture exacte est sur platform.openai.com.</p>
      </Card>

      <Card title="Limites des offres">
        <Alert tone="info">0 signifie « illimité ». Les limites par outil (utilisations gratuites par jour) se règlent dans « Outils et limites ».</Alert>
        <div className="grid2">
          {(['free', 'premium'] as const).map((p) => (
            <div key={p}>
              <h4>{p === 'free' ? 'Gratuit' : 'Premium'}</h4>
              <Field label="Tâches par jour (toutes confondues)"><input type="number" min={0} value={plans[p].daily_tasks} onChange={(e) => set(p, 'daily_tasks', e.target.value)} /></Field>
              <Field label="Fichiers maximum par traitement"><input type="number" min={0} value={plans[p].max_files} onChange={(e) => set(p, 'max_files', e.target.value)} /></Field>
              <Field label="Taille maximale d'un fichier (Mo)"><input type="number" min={0} value={plans[p].max_mb} onChange={(e) => set(p, 'max_mb', e.target.value)} /></Field>
            </div>
          ))}
        </div>
      </Card>

      <div className="row gap wrap">
        <button className="btn primary" disabled={!changed} onClick={async () => {
          try { await save({ ...(draft ? { plans } : {}), ...(salesDraft ? { sales } : {}) }); setDraft(null); setSalesDraft(null); show('Tarifs et offres enregistrés'); }
          catch (e) { show((e as Error).message, 'error'); }
        }}>Enregistrer</button>
        {changed && <button className="btn ghost" onClick={() => { setDraft(null); setSalesDraft(null); }}>Annuler les modifications</button>}
        <button className="btn" onClick={async () => {
          if (!confirm('Remonter les crédits IA de chaque utilisateur au niveau de son offre ?')) return;
          try { const r = await api<{ updated: number }>('POST', '/api/admin/credits/refill'); show(`${r.updated} compte(s) rechargé(s)`); } catch (e) { show((e as Error).message, 'error'); }
        }}>Recharger les crédits IA de tous les comptes</button>
      </div>
    </div>
  );
}
