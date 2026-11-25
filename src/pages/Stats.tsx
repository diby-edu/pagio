import { useCallback, useEffect, useState } from 'react';
import { TOOL_LABELS, api, fmtNum } from '../api';
import { Alert, BarChart, Card, Empty, Kpi } from '../ui';
import { AppTabs, Filters } from './StatsApp';

/** Export d'un tableau en CSV lisible par Excel (séparateur « ; », accents conservés). */
export function exportCsv(name: string, head: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: unknown) => { const t = v == null ? '' : String(v); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = '﻿' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `pagio-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}


const PERIODS = [7, 30, 90, 365];
const short = (day: string) => day.slice(5).split('-').reverse().join('/');
const region = (() => { try { return new Intl.DisplayNames(['fr'], { type: 'region' }); } catch { return null; } })();
const langName = (() => { try { return new Intl.DisplayNames(['fr'], { type: 'language' }); } catch { return null; } })();
export const countryName = (c: string | null) => (!c ? 'Inconnu' : `${region?.of(c) ?? c} (${c})`);

interface Row { k: string | null; views: number; visitors: number }
interface SiteStats {
  days: number; views: number; visitors: number; pages_per_visit: number; bounce_pct: number; apk_downloads: number;
  by_day: { day: string; views: number; visitors: number }[]; by_hour: { hour: number; views: number }[];
  pages: Row[]; sources: Row[]; referrers: Row[]; countries: Row[]; languages: Row[]; devices: Row[]; browsers: Row[]; systems: Row[];
  online_tools: { tool: string; runs: number; errors: number; visitors: number }[];
}

/** Tableau « libellé / visiteurs / pages vues / part » avec une barre proportionnelle. */
function Top({ rows, label, total, name = (k) => k ?? '—' }: { rows: Row[]; label: string; total: number; name?: (k: string | null) => string }) {
  if (rows.length === 0) return <Empty>Aucune donnée sur la période.</Empty>;
  const max = Math.max(1, ...rows.map((r) => r.visitors));
  return (
    <>
    <button className="btn small ghost" style={{ float: 'right', marginTop: -6 }} onClick={() => exportCsv(`site-${label.toLowerCase()}`, [label, 'Visiteurs', 'Pages vues'], rows.map((r) => [name(r.k), r.visitors, r.views]))}>⇩ Excel</button>
    <table className="table small"><thead><tr><th>{label}</th><th>Visiteurs</th><th>Pages vues</th><th>Part</th></tr></thead><tbody>
      {rows.map((r) => (
        <tr key={r.k ?? '—'}>
          <td><div style={{ position: 'relative' }}><span style={{ position: 'absolute', inset: '-4px auto -4px -6px', width: `${(r.visitors / max) * 100}%`, background: 'rgba(91,75,219,.08)', borderRadius: 6 }} />
            <span style={{ position: 'relative' }}>{name(r.k)}</span></div></td>
          <td>{fmtNum(r.visitors)}</td><td>{fmtNum(r.views)}</td><td>{total ? Math.round((r.visitors / total) * 100) : 0} %</td>
        </tr>))}
    </tbody></table>
    </>
  );
}

function SiteTab({ days }: { days: number }) {
  const [s, setS] = useState<SiteStats | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api<SiteStats>('GET', `/api/admin/site-stats?days=${days}`).then(setS).catch((e) => setError(e.message)), [days]);
  useEffect(() => { load(); }, [load]);
  if (error) return <Alert>{error}</Alert>;
  if (!s) return <div className="muted">Chargement…</div>;
  const v = s.visitors;
  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label="Visiteurs" value={fmtNum(v)} hint="un visiteur = une personne un jour donné (sans cookies)" />
        <Kpi label="Pages vues" value={fmtNum(s.views)} hint={`${s.pages_per_visit.toLocaleString('fr-FR')} page(s) par visite`} tone="violet" />
        <Kpi label="Visites d'une seule page" value={`${s.bounce_pct} %`} hint="repartis sans voir une 2e page" tone="amber" />
        <Kpi label="Clics « Télécharger l'APK »" value={fmtNum(s.apk_downloads)} hint={v ? `${Math.round((s.apk_downloads / v) * 1000) / 10} % des visiteurs` : '—'} tone="teal" />
        <Kpi label="Outils en ligne utilisés" value={fmtNum(s.online_tools.reduce((n, t) => n + t.runs, 0))} hint={`${s.online_tools.length} outil(s) différents`} tone="coral" />
      </div>
      <div className="grid2">
        <Card title="Visiteurs par jour"><BarChart data={s.by_day.map((d) => ({ label: short(d.day), value: d.visitors }))} /></Card>
        <Card title="Pages vues par heure (heure GMT, celle d'Abidjan)"><BarChart data={Array.from({ length: 24 }, (_, h) => ({ label: `${h} h`, value: s.by_hour.find((x) => x.hour === h)?.views ?? 0 }))} color="#7A5CF0" /></Card>
      </div>
      <div className="grid2">
        <Card title="Provenance"><Top rows={s.sources} label="Source" total={v} /></Card>
        <Card title="Sites qui envoient des visiteurs"><Top rows={s.referrers} label="Site" total={v} /></Card>
        <Card title="Pays"><Top rows={s.countries} label="Pays" total={v} name={countryName} /></Card>
        <Card title="Pages les plus vues"><Top rows={s.pages} label="Page" total={v} /></Card>
        <Card title="Appareils"><Top rows={s.devices} label="Appareil" total={v} /></Card>
        <Card title="Langue du navigateur"><Top rows={s.languages} label="Langue" total={v} name={(k) => (k ? `${langName?.of(k) ?? k}` : 'Inconnue')} /></Card>
        <Card title="Navigateurs"><Top rows={s.browsers} label="Navigateur" total={v} /></Card>
        <Card title="Systèmes"><Top rows={s.systems} label="Système" total={v} /></Card>
      </div>
      <Card title="Outils en ligne (pagio.site/app)">
        {s.online_tools.length === 0 ? <Empty>Aucun outil utilisé en ligne sur la période.</Empty> :
          <table className="table small"><thead><tr><th>Outil</th><th>Utilisations</th><th>Visiteurs</th><th>Échecs</th></tr></thead><tbody>
            {s.online_tools.map((t) => <tr key={t.tool}><td>{TOOL_LABELS[t.tool] ?? t.tool}</td><td>{fmtNum(t.runs)}</td><td>{fmtNum(t.visitors)}</td><td>{t.errors ? `${fmtNum(t.errors)} (${Math.round((t.errors / t.runs) * 100)} %)` : '—'}</td></tr>)}
          </tbody></table>}
      </Card>
      <p className="muted small">Mesuré sans cookies ni stockage dans le navigateur ; les robots (Google, aperçus de liens…) sont exclus. Provenance « direct » :
        adresse tapée, favori ou lien ouvert depuis une application (WhatsApp n'indique souvent pas la provenance : ajoutez <code>?utm_source=whatsapp</code> aux liens que vous partagez).</p>
    </div>
  );
}

/** Statistiques détaillées : utilisateurs, appareils et outils de l'application, fréquentation du site. */
export default function Stats() {
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState('users');
  const [f, setF] = useState<Filters>({ country: '', version: '', plan: '' });
  return (
    <div className="stack">
      <div className="row gap wrap" style={{ alignItems: 'center' }}>
        {[['users', 'Utilisateurs'], ['devices', 'Appareils'], ['tools', 'Outils'], ['site', 'Site pagio.site']].map(([k, l]) => <button key={k} className={`btn${tab === k ? ' primary' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
        <span style={{ flex: 1 }} />
        {PERIODS.map((d) => <button key={d} className={`btn small${d === days ? ' primary' : ''}`} onClick={() => setDays(d)}>{d === 365 ? '1 an' : `${d} jours`}</button>)}
      </div>
      {tab === 'site' ? <SiteTab days={days} /> : <AppTabs tab={tab} days={days} f={f} setF={setF} />}
    </div>
  );
}
