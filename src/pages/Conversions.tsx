import { useEffect, useState } from 'react';
import { api, fmtBytes, fmtDate, fmtNum } from '../api';
import { Alert, Badge, BarChart, Card, Empty, Kpi } from '../ui';

interface Data {
  days: number; libreoffice: boolean; running: number;
  totals: { total: number; ok: number; bytes: number; avg_ms: number; max_ms: number };
  by_type: { source_ext: string; target: string; total: number; failed: number; avg_ms: number | null }[];
  daily: { day: string; total: number; failed: number }[];
  top_errors: { error: string | null; n: number; last_ts: number }[];
  recent: { ts: number; source_ext: string; target: string; bytes: number; ms: number; ok: number; error: string | null; email: string | null }[];
}
const secs = (ms: number | null) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`);

export default function Conversions() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<Data>('GET', `/api/admin/conversions?days=${days}`).then(setD).catch((e) => setError(e.message)); }, [days]);
  if (error) return <Alert>{error}</Alert>;
  if (!d) return <div className="muted">Chargement…</div>;
  const failed = d.totals.total - d.totals.ok;
  const rate = d.totals.total ? Math.round((failed / d.totals.total) * 100) : 0;

  return (
    <div className="stack">
      {!d.libreoffice && <Alert tone="warning">LibreOffice n'est pas détecté sur ce serveur : toutes les conversions en ligne échouent. L'application utilise alors sa conversion interne.</Alert>}
      <div className="row gap">
        {[7, 30, 90, 365].map((n) => <button key={n} className={`chip ${n === days ? 'on' : ''}`} onClick={() => setDays(n)}>{n} jours</button>)}
      </div>
      <div className="kpis">
        <Kpi label="Conversions" value={fmtNum(d.totals.total)} hint={`${d.running} en cours`} />
        <Kpi label="Échecs" value={fmtNum(failed)} hint={`${rate} % des conversions`} tone={rate > 30 ? 'red' : rate > 5 ? 'amber' : 'teal'} />
        <Kpi label="Durée moyenne" value={secs(d.totals.avg_ms)} hint={`la plus longue : ${secs(d.totals.max_ms)}`} tone="violet" />
        <Kpi label="Volume traité" value={fmtBytes(d.totals.bytes)} hint="fichiers effacés après conversion" tone="amber" />
      </div>
      <div className="grid2">
        <Card title="Conversions par jour"><BarChart data={d.daily.map((x) => ({ label: x.day.slice(5), value: x.total }))} /></Card>
        <Card title="Échecs par jour"><BarChart data={d.daily.map((x) => ({ label: x.day.slice(5), value: x.failed }))} color="#E5484D" /></Card>
      </div>
      <div className="grid2">
        <Card title="Par type de conversion">
          {d.by_type.length === 0 ? <Empty>Aucune conversion sur la période.</Empty> :
            <table className="table"><thead><tr><th>Conversion</th><th>Nombre</th><th>Échecs</th><th>Durée moyenne</th></tr></thead><tbody>
              {d.by_type.map((t, i) => <tr key={i}><td><code>{t.source_ext || '?'}</code> → <code>{t.target}</code></td><td>{fmtNum(t.total)}</td><td>{t.failed ? <Badge tone="red">{t.failed}</Badge> : 0}</td><td>{secs(t.avg_ms)}</td></tr>)}
            </tbody></table>}
        </Card>
        <Card title="Causes d'échec les plus fréquentes">
          {d.top_errors.length === 0 ? <Empty>Aucun échec sur la période. 🎉</Empty> :
            <table className="table"><thead><tr><th>Message</th><th>Nombre</th><th>Dernier</th></tr></thead><tbody>
              {d.top_errors.map((e, i) => <tr key={i}><td className="small">{(e.error ?? '—').slice(0, 220)}</td><td>{e.n}</td><td style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.last_ts)}</td></tr>)}
            </tbody></table>}
        </Card>
      </div>
      <Card title="100 dernières conversions">
        {d.recent.length === 0 ? <Empty>Aucune conversion sur la période.</Empty> :
          <div className="table-wrap"><table className="table small">
            <thead><tr><th>Date</th><th>Conversion</th><th>Taille</th><th>Durée</th><th>Utilisateur</th><th>Résultat</th></tr></thead>
            <tbody>{d.recent.map((r, i) => (
              <tr key={i}><td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.ts)}</td><td><code>{r.source_ext || '?'}</code> → <code>{r.target}</code></td><td>{fmtBytes(r.bytes)}</td><td>{secs(r.ms)}</td>
                <td>{r.email ?? <span className="muted">sans compte</span>}</td>
                <td>{r.ok ? <Badge tone="teal">réussie</Badge> : <span title={r.error ?? ''}><Badge tone="red">échec</Badge></span>}</td></tr>))}
            </tbody>
          </table></div>}
      </Card>
    </div>
  );
}
