import { useEffect, useState } from 'react';
import { api, fmtDate, fmtNum } from '../api';
import { Alert, Badge, BarChart, Card, Empty, Kpi } from '../ui';

interface Data {
  days: number; enabled: boolean; provider: string; model: string; cost_per_request: number;
  totals: { requests: number; ok: number; credits: number; chars_in: number; chars_out: number; users: number };
  daily: { day: string; requests: number; credits: number; failed: number }[];
  top_users: { user_id: string | null; email: string | null; plan: string | null; credits_left: number | null; requests: number; credits: number; chars_in: number }[];
  top_errors: { error: string | null; n: number; last_ts: number }[];
  credits_outstanding: number; users_out_of_credits: number;
}

export default function AiUsage() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<Data>('GET', `/api/admin/ai-usage?days=${days}`).then(setD).catch((e) => setError(e.message)); }, [days]);
  if (error) return <Alert>{error}</Alert>;
  if (!d) return <div className="muted">Chargement…</div>;
  const failed = d.totals.requests - d.totals.ok;
  const rate = d.totals.requests ? Math.round((failed / d.totals.requests) * 100) : 0;
  // Ordre de grandeur : environ 4 caractères par jeton. Le coût réel se lit chez le fournisseur.
  const tokens = Math.round((d.totals.chars_in + d.totals.chars_out) / 4);

  return (
    <div className="stack">
      {!d.enabled && <Alert tone="info">L'IA du serveur est désactivée (page « Intelligence artificielle »). Les utilisateurs ne peuvent utiliser que leur propre clé.</Alert>}
      <div className="row gap">
        {[7, 30, 90, 365].map((n) => <button key={n} className={`chip ${n === days ? 'on' : ''}`} onClick={() => setDays(n)}>{n} jours</button>)}
      </div>
      <div className="kpis">
        <Kpi label="Requêtes IA" value={fmtNum(d.totals.requests)} hint={`${fmtNum(d.totals.users)} utilisateur(s)`} tone="violet" />
        <Kpi label="Crédits consommés" value={fmtNum(d.totals.credits)} hint={`${d.cost_per_request} crédit(s) par requête`} />
        <Kpi label="Échecs" value={fmtNum(failed)} hint={`${rate} % des requêtes`} tone={rate > 30 ? 'red' : rate > 5 ? 'amber' : 'teal'} />
        <Kpi label="Volume estimé" value={`${fmtNum(tokens)} jetons`} hint="estimation : 4 caractères par jeton" tone="amber" />
        <Kpi label="Crédits en circulation" value={fmtNum(d.credits_outstanding)} hint={`${fmtNum(d.users_out_of_credits)} compte(s) à sec`} tone="coral" />
      </div>
      <p className="muted small">Fournisseur actuel : <b>{d.provider}</b>{d.model ? <> · modèle <b>{d.model}</b></> : null}. Le montant facturé se consulte chez le fournisseur ;
        fixez-y un plafond de dépense mensuel.</p>
      <div className="grid2">
        <Card title="Requêtes par jour"><BarChart data={d.daily.map((x) => ({ label: x.day.slice(5), value: x.requests }))} color="#8E4EC6" /></Card>
        <Card title="Crédits consommés par jour"><BarChart data={d.daily.map((x) => ({ label: x.day.slice(5), value: x.credits }))} /></Card>
      </div>
      <div className="grid2">
        <Card title="Plus gros consommateurs">
          {d.top_users.length === 0 ? <Empty>Aucune requête IA sur la période.</Empty> :
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Utilisateur</th><th>Requêtes</th><th>Crédits</th><th>Solde</th></tr></thead>
              <tbody>{d.top_users.map((u, i) => (
                <tr key={i}><td>{u.email ?? <span className="muted">compte supprimé</span>} {u.plan === 'premium' && <Badge tone="coral">Premium</Badge>}</td>
                  <td>{fmtNum(u.requests)}</td><td>{fmtNum(u.credits)}</td><td>{u.credits_left == null ? '—' : fmtNum(u.credits_left)}</td></tr>))}
              </tbody>
            </table></div>}
        </Card>
        <Card title="Refus du fournisseur">
          {d.top_errors.length === 0 ? <Empty>Aucun échec sur la période. 🎉</Empty> :
            <table className="table"><thead><tr><th>Message</th><th>Nombre</th><th>Dernier</th></tr></thead><tbody>
              {d.top_errors.map((e, i) => <tr key={i}><td className="small">{(e.error ?? '—').slice(0, 220)}</td><td>{e.n}</td><td style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.last_ts)}</td></tr>)}
            </tbody></table>}
        </Card>
      </div>
    </div>
  );
}
