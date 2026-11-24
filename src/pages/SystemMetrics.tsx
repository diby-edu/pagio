import { useCallback, useEffect, useState } from 'react';
import { api, fmtNum } from '../api';
import { BarChart, Card, Empty, Field, Kpi, Toggle } from '../ui';

export interface Thresholds {
  disk_warn_pct: number; disk_crit_pct: number; mem_warn_pct: number; cpu_warn_pct: number; rt_warn_ms: number;
  cert_warn_days: number; disk_forecast_days: number; sites_ignored: string[]; other_sites_alerts: boolean;
}
interface Point {
  t: number; cpu: number; cpu_max: number; mem_pct: number; swap_mb: number; disk_mb: number; rx_mb: number; tx_mb: number;
  pagio_mem_mb: number; req: number; r4xx: number; r5xx: number; t_moy_ms: number; t95_ms: number; ok_pct: number;
}
interface Site { domaine: string; code: number; ms: number; ok: boolean; verifie: number; cert_jours: number | null; ignore: boolean }
interface Metrics {
  range: string; samples: number; series: Point[];
  current: {
    t: number; cpu: number; load: number; mem_total_mb: number; mem_used_mb: number; swap_total_mb: number; swap_used_mb: number;
    disk_total_mb: number; disk_used_mb: number; pagio_mem_mb: number; pagio_limit_mb: number; restarts: number; db_mb: number; backups_mb: number;
  } | null;
  summary: { cpu_avg: number; cpu_max: number; requests: number; r4xx: number; r5xx: number; t_moy_ms: number; t95_ms: number; rx_mb: number; tx_mb: number; restarts: number };
  uptime: Record<'24h' | '7d' | '30d', number | null>;
  disk_forecast: { mb_per_day: number; days_to_full: number | null } | null;
  sites: Site[]; thresholds: Thresholds;
}

const RANGES: [string, string][] = [['24h', '24 heures'], ['7d', '7 jours'], ['30d', '30 jours']];
const gb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go` : `${fmtNum(mb)} Mo`);
const pct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('fr-FR')} %`);
const sec = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s` : `${ms} ms`);
const tone = (v: number, warn: number, crit = 101) => (v >= crit ? 'red' : v >= warn ? 'amber' : 'teal');

/** Libellé court d'une tranche selon la période (heure pour 24 h, jour et heure sinon). */
function label(t: number, range: string) {
  const d = new Date(t);
  return range === '24h' ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit' });
}

/** Mesures relevées chaque minute par le gardien du VPS : graphiques, disponibilité, prévision du disque, autres sites. */
export function SystemMetrics({ onSaveThresholds }: { onSaveThresholds: (t: Partial<Thresholds>) => Promise<void> }) {
  const [range, setRange] = useState('24h');
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api<Metrics>('GET', `/api/admin/system/metrics?range=${range}`).then(setM).catch((e) => setError(e.message)), [range]);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
  if (error) return <Card title="Mesures du serveur"><p className="muted">{error}</p></Card>;
  if (!m) return <Card title="Mesures du serveur"><p className="muted">Chargement…</p></Card>;
  if (!m.current) return <Card title="Mesures du serveur"><p className="muted">Aucune mesure : le gardien du serveur n'est pas installé ou vient de démarrer (une mesure par minute).</p></Card>;
  const c = m.current; const th = m.thresholds; const s = m.summary;
  const series = (k: keyof Point) => m.series.map((p) => ({ label: label(p.t, range), value: p[k] as number }));
  const diskPct = c.disk_total_mb ? Math.round((c.disk_used_mb / c.disk_total_mb) * 100) : 0;
  const memPct = c.mem_total_mb ? Math.round((c.mem_used_mb / c.mem_total_mb) * 100) : 0;
  const errRate = s.requests ? Math.round(((s.r4xx + s.r5xx) / s.requests) * 1000) / 10 : 0;

  return (
    <>
      <div className="row gap wrap" style={{ alignItems: 'center' }}>
        <b>Mesures du serveur</b>
        {RANGES.map(([k, l]) => <button key={k} className={`btn small${k === range ? ' primary' : ''}`} onClick={() => setRange(k)}>{l}</button>)}
        <span className="muted small">dernière mesure : {new Date(c.t).toLocaleTimeString('fr-FR')} · {fmtNum(m.samples)} mesure(s) sur la période</span>
      </div>
      <div className="kpis">
        <Kpi label="Disponibilité 24 h / 7 j / 30 j" value={pct(m.uptime['24h'])} hint={`7 j : ${pct(m.uptime['7d'])} · 30 j : ${pct(m.uptime['30d'])}`} tone={(m.uptime['30d'] ?? 100) >= 99.9 ? 'teal' : 'amber'} />
        <Kpi label="Processeur" value={`${c.cpu} %`} hint={`moyenne ${s.cpu_avg} % · pointe ${s.cpu_max} % · charge ${c.load}`} tone={tone(s.cpu_avg, th.cpu_warn_pct)} />
        <Kpi label="Mémoire du serveur" value={`${memPct} %`} hint={`${gb(c.mem_used_mb)} sur ${gb(c.mem_total_mb)} · échange ${gb(c.swap_used_mb)}`} tone={tone(memPct, th.mem_warn_pct)} />
        <Kpi label="Disque" value={`${diskPct} %`} hint={`${gb(c.disk_total_mb - c.disk_used_mb)} libres · ${m.disk_forecast?.days_to_full != null ? `plein dans ${m.disk_forecast.days_to_full} j` : 'stable'}${m.disk_forecast ? ` (${m.disk_forecast.mb_per_day} Mo/j)` : ''}`} tone={tone(diskPct, 100 - th.disk_warn_pct, 100 - th.disk_crit_pct)} />
        <Kpi label="Temps de réponse de Pagio" value={sec(s.t_moy_ms)} hint={`95 % des requêtes sous ${sec(s.t95_ms)}`} tone={tone(s.t95_ms, th.rt_warn_ms)} />
        <Kpi label="Requêtes sur pagio.site" value={fmtNum(s.requests)} hint={`erreurs : ${fmtNum(s.r4xx)} (4xx) · ${fmtNum(s.r5xx)} (5xx) · ${errRate} %`} tone={s.r5xx > 0 ? 'amber' : 'indigo'} />
        <Kpi label="Trafic réseau" value={`${gb(s.rx_mb + s.tx_mb)}`} hint={`reçu ${gb(s.rx_mb)} · envoyé ${gb(s.tx_mb)}`} tone="violet" />
        <Kpi label="Conteneur Pagio" value={gb(c.pagio_mem_mb)} hint={`limite ${gb(c.pagio_limit_mb)} · ${s.restarts} redémarrage(s) sur la période · base ${gb(c.db_mb)} · sauvegardes ${gb(c.backups_mb)}`} tone="coral" />
      </div>
      <div className="grid2">
        <Card title="Processeur (%)"><BarChart data={series('cpu')} color="#5B4BDB" /></Card>
        <Card title="Mémoire occupée (%)"><BarChart data={series('mem_pct')} color="#7A5CF0" /></Card>
        <Card title="Requêtes sur pagio.site"><BarChart data={series('req')} color="#14A37F" /></Card>
        <Card title="Temps de réponse, 95e centile (ms)"><BarChart data={series('t95_ms')} color="#E08A1E" /></Card>
        <Card title="Trafic reçu (Mo)"><BarChart data={series('rx_mb')} color="#2C6FE0" /></Card>
        <Card title="Disque utilisé (Mo)"><BarChart data={series('disk_mb')} color="#FF7A66" /></Card>
      </div>
      <div className="grid2">
        <SitesCard sites={m.sites} ignored={th.sites_ignored} others={th.other_sites_alerts}
          onSave={async (t) => { await onSaveThresholds(t); load(); }} />
        <ThresholdsCard th={th} onSave={async (t) => { await onSaveThresholds(t); load(); }} />
      </div>
    </>
  );
}

/** Autres sites hébergés sur le VPS : réponse et certificat. « Surveiller » décoché = plus d'alerte pour ce site. */
function SitesCard({ sites, ignored, others, onSave }: { sites: Site[]; ignored: string[]; others: boolean; onSave: (t: Partial<Thresholds>) => Promise<void> }) {
  const isPagio = (d: string) => /pagio/.test(d);
  return (
    <Card title="Sites hébergés sur le serveur">
      <Toggle checked={others} onChange={(v) => onSave({ other_sites_alerts: v })} label="Alertes aussi pour les autres sites (sinon seulement Pagio)" />
      {sites.length === 0 ? <Empty>Pas encore vérifiés (toutes les 5 minutes).</Empty> :
        <div className="table-wrap"><table className="table small"><thead><tr><th>Site</th><th>État</th><th>Réponse</th><th>Certificat</th><th>Alertes</th></tr></thead><tbody>
          {sites.map((x) => (
            <tr key={x.domaine} style={x.ignore ? { opacity: 0.55 } : undefined}>
              <td><a href={`https://${x.domaine}/`} target="_blank" rel="noreferrer">{x.domaine}</a></td>
              <td>{x.ok ? <span style={{ color: '#14A37F' }}>✔ répond ({x.code})</span> : <span style={{ color: '#E5484D' }}>✘ {x.code ? `erreur ${x.code}` : 'injoignable'}</span>}</td>
              <td>{x.ok ? sec(x.ms) : '—'}</td>
              <td style={{ color: x.cert_jours !== null && x.cert_jours < 14 ? '#E5484D' : undefined }}>{x.cert_jours === null ? '—' : x.cert_jours < 0 ? 'expiré' : `${x.cert_jours} j`}</td>
              <td>{isPagio(x.domaine) || others
                ? <Toggle checked={!x.ignore} onChange={(v) => onSave({ sites_ignored: v ? ignored.filter((d) => d !== x.domaine) : [...ignored, x.domaine] })} />
                : <span className="muted small">affichage seul</span>}</td>
            </tr>))}
        </tbody></table></div>}
      <p className="muted small">Vérifiés toutes les 5 minutes, en lecture seule : Pagio ne modifie jamais ces sites. Les alertes portent sur Pagio ;
        les autres sites restent affichés ici pour information.</p>
    </Card>
  );
}

/** Seuils des alertes (page d'accueil du tableau de bord, notifications de l'APK admin). */
function ThresholdsCard({ th, onSave }: { th: Thresholds; onSave: (t: Partial<Thresholds>) => Promise<void> }) {
  const [d, setD] = useState(th);
  const [busy, setBusy] = useState(false);
  useEffect(() => setD(th), [th]);
  const num = (k: keyof Thresholds, l: string, hint?: string) => (
    <Field label={l} hint={hint}><input type="number" value={d[k] as number} onChange={(e) => setD({ ...d, [k]: Number(e.target.value) })} /></Field>
  );
  return (
    <Card title="Seuils d'alerte">
      <div className="grid2">
        {num('disk_warn_pct', 'Disque : avertir sous (% libre)')}
        {num('disk_crit_pct', 'Disque : critique sous (% libre)')}
        {num('disk_forecast_days', 'Disque plein prévu dans moins de (jours)')}
        {num('mem_warn_pct', 'Mémoire occupée au-delà de (%)', 'Moyenne sur 15 minutes.')}
        {num('cpu_warn_pct', 'Processeur occupé au-delà de (%)', 'Moyenne sur 15 minutes.')}
        {num('rt_warn_ms', 'Pagio lent au-delà de (ms)', '95e centile sur 15 minutes.')}
        {num('cert_warn_days', 'Certificat expirant dans moins de (jours)')}
      </div>
      <button className="btn primary" disabled={busy || JSON.stringify(d) === JSON.stringify(th)} onClick={async () => { setBusy(true); try { await onSave(d); } finally { setBusy(false); } }}>Enregistrer les seuils</button>
    </Card>
  );
}
