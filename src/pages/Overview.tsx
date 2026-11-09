import { useEffect, useState } from 'react';
import { Stats, TOOL_LABELS, api, fmtNum } from '../api';
import { Alert, BarChart, Card, Empty, Kpi } from '../ui';

export default function Overview() {
  const [days, setDays] = useState(30);
  const [s, setS] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api<Stats>('GET', `/api/admin/stats?days=${days}`).then(setS).catch((e) => setError(e.message));
  }, [days]);

  if (error) return <Alert>{error}</Alert>;
  if (!s) return <div className="muted">Chargement des statistiques…</div>;
  const errRate = s.tasks_period ? Math.round((s.errors_period / s.tasks_period) * 100) : 0;
  const maxTool = Math.max(1, ...s.by_tool.map((t) => t.runs));

  return (
    <div className="stack">
      <div className="row gap">
        {[7, 30, 90, 365].map((d) => <button key={d} className={`chip ${d === days ? 'on' : ''}`} onClick={() => setDays(d)}>{d} jours</button>)}
      </div>
      <div className="kpis">
        <Kpi label="Utilisateurs inscrits" value={fmtNum(s.users.total)} hint={`+${s.users.new_period} sur la période`} />
        <Kpi label="Comptes Premium" value={fmtNum(s.users.premium)} hint={s.users.total ? `${Math.round((s.users.premium / s.users.total) * 100)} % des comptes` : '—'} tone="coral" />
        <Kpi label="Appareils actifs" value={fmtNum(s.devices_period)} hint="statistiques anonymes acceptées" tone="teal" />
        <Kpi label="Traitements" value={fmtNum(s.tasks_period)} hint={`${errRate} % d'erreurs`} tone={errRate > 5 ? 'red' : 'indigo'} />
        <Kpi label="Requêtes IA" value={fmtNum(s.ai_requests_period)} hint={`${fmtNum(s.ai_credits_period)} crédits consommés`} tone="violet" />
        <Kpi label="Conversions serveur" value={fmtNum(s.conversions_period)} hint={`${s.feedback_open} avis à traiter`} tone="amber" />
      </div>
      <div className="grid2">
        <Card title="Traitements par jour"><BarChart data={s.daily.map((d) => ({ label: d.day.slice(5), value: d.tasks }))} /></Card>
        <Card title="Appareils actifs par jour"><BarChart data={s.daily.map((d) => ({ label: d.day.slice(5), value: d.devices }))} color="#14A37F" /></Card>
      </div>
      <div className="grid2">
        <Card title="Outils les plus utilisés">
          {s.by_tool.length === 0 ? <Empty>Aucun traitement reçu. Les statistiques arrivent quand des utilisateurs acceptent l'envoi anonyme.</Empty> :
            <div className="bars">{s.by_tool.slice(0, 12).map((t) => (
              <div key={t.tool} className="bar-row">
                <span className="bar-label">{TOOL_LABELS[t.tool] ?? t.tool}</span>
                <span className="bar-track"><span className="bar-fill" style={{ width: `${(t.runs / maxTool) * 100}%` }} /></span>
                <span className="bar-value">{t.runs}{t.errors ? <em> · {t.errors} err.</em> : null}</span>
              </div>))}
            </div>}
        </Card>
        <Card title="Erreurs les plus fréquentes">
          {s.top_errors.length === 0 ? <Empty>Aucune erreur sur la période. 🎉</Empty> :
            <table className="table"><thead><tr><th>Outil</th><th>Code</th><th>Nombre</th></tr></thead><tbody>
              {s.top_errors.map((e, i) => <tr key={i}><td>{TOOL_LABELS[e.tool] ?? e.tool}</td><td><code>{e.error ?? '—'}</code></td><td>{e.n}</td></tr>)}
            </tbody></table>}
        </Card>
      </div>
      <div className="grid2">
        <Card title="Inscriptions"><BarChart data={s.signups.map((d) => ({ label: d.day.slice(5), value: d.n }))} color="#FF6B57" /></Card>
        <Card title="Versions de l'application">
          {s.versions.length === 0 ? <Empty>Aucune donnée.</Empty> :
            <table className="table"><thead><tr><th>Version</th><th>Appareils</th></tr></thead><tbody>
              {s.versions.map((v) => <tr key={v.app_version}><td>{v.app_version || 'inconnue'}</td><td>{v.devices}</td></tr>)}
            </tbody></table>}
        </Card>
      </div>
    </div>
  );
}
