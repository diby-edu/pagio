import { useCallback, useEffect, useState } from 'react';
import { TOOL_LABELS, api, fmtBytes, fmtNum } from '../api';
import { Alert, BarChart, Card, Empty, Kpi } from '../ui';
import { countryName, exportCsv } from './Stats';

interface KN { k: string | null; n: number }
export interface AppStats {
  days: number; filters: { country: string | null; version: string | null; plan: string | null };
  options: { countries: string[]; versions: string[] };
  users: {
    dau: number; wau: number; mau: number; installs: number; accounts: number; buyers: number; lost_30d: number;
    retention: { d1: number | null; d7: number | null; d30: number | null; cohort: number };
    by_day: { day: string; active: number; installs: number; runs: number }[];
  };
  devices: { count: number; countries: KN[]; languages: KN[]; brands: KN[]; models: KN[]; android: KN[]; versions: KN[]; installers: KN[]; screens: KN[]; dark: KN[]; timezones: KN[] };
  tools: {
    list: { tool: string; runs: number; errors: number; devices: number; ms: number | null; bytes_in: number | null; files: number | null; limit_hits: number; error_pct: number }[];
    by_hour: number[]; by_weekday: number[]; errors: { tool: string; error: string | null; n: number }[]; ai: { task: string | null; n: number }[];
    scans: { n: number; pages: number | null }; crashes: { error: string | null; ou: string | null; app_version: string; n: number }[]; limit_hits: number;
  };
}
export interface Filters { country: string; version: string; plan: string }

const short = (day: string) => day.slice(5).split('-').reverse().join('/');
const pct = (n: number | null) => (n === null ? '—' : `${n} %`);
const WEEKDAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const INSTALLERS: Record<string, string> = { apk: 'Site (fichier APK)', play_store: 'Google Play', unknown: 'Inconnue' };

/** Liste « valeur / nombre / part » avec barre et export. */
function Dist({ title, rows, total, name = (k) => k ?? 'Inconnu', file }: { title: string; rows: KN[]; total: number; name?: (k: string | null) => string; file: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <Card title={title} actions={rows.length > 0 ? <button className="btn small ghost" onClick={() => exportCsv(file, [title, 'Appareils', 'Part (%)'], rows.map((r) => [name(r.k), r.n, total ? Math.round((r.n / total) * 100) : 0]))}>⇩ Excel</button> : undefined}>
      {rows.length === 0 ? <Empty>Aucune donnée.</Empty> :
        <table className="table small"><tbody>{rows.map((r) => (
          <tr key={r.k ?? '—'}><td><div style={{ position: 'relative' }}><span style={{ position: 'absolute', inset: '-4px auto -4px -6px', width: `${(r.n / max) * 100}%`, background: 'rgba(91,75,219,.08)', borderRadius: 6 }} /><span style={{ position: 'relative' }}>{name(r.k)}</span></div></td>
            <td style={{ textAlign: 'right' }}>{fmtNum(r.n)}</td><td style={{ textAlign: 'right' }} className="muted">{total ? Math.round((r.n / total) * 100) : 0} %</td></tr>))}
        </tbody></table>}
    </Card>
  );
}

export function useAppStats(days: number, f: Filters) {
  const [s, setS] = useState<AppStats | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    const q = new URLSearchParams({ days: String(days), ...(f.country ? { country: f.country } : {}), ...(f.version ? { version: f.version } : {}), ...(f.plan ? { plan: f.plan } : {}) });
    api<AppStats>('GET', `/api/admin/app-stats?${q}`).then(setS).catch((e) => setError(e.message));
  }, [days, f.country, f.version, f.plan]);
  useEffect(() => { load(); }, [load]);
  return { s, error };
}

/** Filtres communs aux onglets de l'application. */
export function FilterBar({ s, f, setF }: { s: AppStats | null; f: Filters; setF: (f: Filters) => void }) {
  return (
    <div className="row gap wrap" style={{ alignItems: 'center' }}>
      <span className="muted small">Filtres :</span>
      <select value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}><option value="">Tous les pays</option>{s?.options.countries.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}</select>
      <select value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })}><option value="">Toutes les versions</option>{s?.options.versions.map((v) => <option key={v} value={v}>{v}</option>)}</select>
      <select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}><option value="">Toutes les offres</option><option value="free">Gratuit (connectés)</option><option value="premium">Premium</option></select>
      {(f.country || f.version || f.plan) && <button className="btn small ghost" onClick={() => setF({ country: '', version: '', plan: '' })}>Effacer</button>}
    </div>
  );
}

export function UsersTab({ s }: { s: AppStats }) {
  const u = s.users;
  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label="Actifs aujourd'hui (24 h)" value={fmtNum(u.dau)} hint={`7 jours : ${fmtNum(u.wau)} · 30 jours : ${fmtNum(u.mau)}`} />
        <Kpi label="Fidélité (actifs jour / mois)" value={u.mau ? `${Math.round((u.dau / u.mau) * 100)} %` : '—'} hint="part des actifs du mois venus aujourd'hui" tone="violet" />
        <Kpi label={`Installations (${s.days} j)`} value={fmtNum(u.installs)} hint="premières ouvertures (2.2.0 et plus)" tone="teal" />
        <Kpi label="Reviennent après 1 / 7 / 30 j" value={pct(u.retention.d7)} hint={`1 j : ${pct(u.retention.d1)} · 7 j : ${pct(u.retention.d7)} · 30 j : ${pct(u.retention.d30)} (sur ${u.retention.cohort} installation(s))`} tone="amber" />
        <Kpi label="Comptes créés" value={fmtNum(u.accounts)} hint={u.installs ? `${Math.round((u.accounts / u.installs) * 100)} % des installations` : '—'} tone="coral" />
        <Kpi label="Clients payants" value={fmtNum(u.buyers)} hint={u.accounts ? `${Math.round((u.buyers / u.accounts) * 100)} % des comptes` : '—'} tone="teal" />
        <Kpi label="Appareils perdus (30 j sans ouverture)" value={fmtNum(u.lost_30d)} hint="désinstallations probables" tone="red" />
      </div>
      <Card title="Parcours : installation → compte → Premium">
        {[['Installations', u.installs], ['Comptes créés', u.accounts], ['Clients payants', u.buyers]].map(([l, n], i, a) => (
          <div key={l as string} style={{ margin: '6px 0' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><span>{l}</span><b>{fmtNum(n as number)}{i > 0 && (a[i - 1][1] as number) ? ` · ${Math.round(((n as number) / (a[i - 1][1] as number)) * 100)} % de l'étape précédente` : ''}</b></div>
            <div style={{ height: 10, background: 'var(--line)', borderRadius: 6, overflow: 'hidden' }}><div style={{ width: `${u.installs ? Math.min(100, ((n as number) / Math.max(u.installs, 1)) * 100) : 0}%`, height: '100%', background: 'var(--indigo)' }} /></div>
          </div>))}
      </Card>
      <div className="grid2">
        <Card title="Appareils actifs par jour"><BarChart data={u.by_day.map((d) => ({ label: short(d.day), value: d.active }))} /></Card>
        <Card title="Installations par jour"><BarChart data={u.by_day.map((d) => ({ label: short(d.day), value: d.installs }))} color="#14A37F" /></Card>
      </div>
      <button className="btn small ghost" style={{ alignSelf: 'flex-start' }} onClick={() => exportCsv('activite-par-jour', ['Jour', 'Appareils actifs', 'Installations', 'Utilisations d\'outils'], u.by_day.map((d) => [d.day, d.active, d.installs, d.runs]))}>⇩ Excel : activité par jour</button>
    </div>
  );
}

export function DevicesTab({ s }: { s: AppStats }) {
  const d = s.devices; const t = d.count;
  if (t === 0) return <Empty>Aucun appareil sur la période (les descriptions d'appareil arrivent avec la version 2.2.0).</Empty>;
  return (
    <div className="stack">
      <div className="kpis"><Kpi label="Appareils actifs sur la période" value={fmtNum(t)} hint="chacun compté une fois, d'après sa dernière ouverture" /></div>
      <div className="grid2">
        <Dist title="Pays" rows={d.countries} total={t} name={countryName} file="pays" />
        <Dist title="Modèles" rows={d.models} total={t} file="modeles" />
        <Dist title="Marques" rows={d.brands} total={t} file="marques" />
        <Dist title="Version d'Android" rows={d.android} total={t} name={(k) => (k ? `Android ${k}` : 'Inconnue')} file="android" />
        <Dist title="Version de Pagio" rows={d.versions} total={t} file="versions-pagio" />
        <Dist title="Origine de l'installation" rows={d.installers} total={t} name={(k) => INSTALLERS[k ?? 'unknown'] ?? k ?? 'Inconnue'} file="origine" />
        <Dist title="Langue du téléphone" rows={d.languages} total={t} file="langues" />
        <Dist title="Écran" rows={d.screens} total={t} file="ecrans" />
        <Dist title="Thème" rows={d.dark} total={t} file="theme" />
        <Dist title="Fuseau horaire" rows={d.timezones} total={t} file="fuseaux" />
      </div>
    </div>
  );
}

export function ToolsTab({ s }: { s: AppStats }) {
  const t = s.tools;
  const total = t.list.reduce((n, x) => n + x.runs, 0);
  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label="Utilisations d'outils" value={fmtNum(total)} hint={`${t.list.length} outil(s) différents`} />
        <Kpi label="Échecs" value={fmtNum(t.list.reduce((n, x) => n + x.errors, 0))} hint={total ? `${Math.round((t.list.reduce((n, x) => n + x.errors, 0) / total) * 100)} % des utilisations` : '—'} tone="red" />
        <Kpi label="Limites gratuites atteintes" value={fmtNum(t.limit_hits)} hint="occasions de proposer Premium" tone="coral" />
        <Kpi label="Scans" value={fmtNum(t.scans.n)} hint={t.scans.pages ? `${t.scans.pages.toLocaleString('fr-FR')} page(s) en moyenne` : '—'} tone="teal" />
      </div>
      <Card title="Par outil" actions={<button className="btn small ghost" onClick={() => exportCsv('outils', ['Outil', 'Utilisations', 'Appareils', 'Échecs (%)', 'Durée moyenne (s)', 'Taille moyenne (octets)', 'Fichiers par utilisation', 'Limites atteintes'],
        t.list.map((x) => [TOOL_LABELS[x.tool] ?? x.tool, x.runs, x.devices, x.error_pct, x.ms ? Math.round(x.ms / 100) / 10 : '', x.bytes_in ?? '', x.files ?? '', x.limit_hits]))}>⇩ Excel</button>}>
        {t.list.length === 0 ? <Empty>Aucune utilisation sur la période.</Empty> :
          <div className="table-wrap"><table className="table small"><thead><tr><th>Outil</th><th>Utilisations</th><th>Appareils</th><th>Échecs</th><th>Durée moy.</th><th>Taille moy.</th><th>Fichiers</th><th>Limite atteinte</th></tr></thead><tbody>
            {t.list.map((x) => <tr key={x.tool}><td>{TOOL_LABELS[x.tool] ?? x.tool}</td><td>{fmtNum(x.runs)}</td><td>{fmtNum(x.devices)}</td>
              <td style={{ color: x.error_pct >= 20 ? '#E5484D' : undefined }}>{x.errors ? `${x.errors} (${x.error_pct} %)` : '—'}</td>
              <td>{x.ms ? `${(x.ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s` : '—'}</td><td>{x.bytes_in ? fmtBytes(x.bytes_in) : '—'}</td><td>{x.files ?? '—'}</td><td>{x.limit_hits || '—'}</td></tr>)}
          </tbody></table></div>}
      </Card>
      <div className="grid2">
        <Card title="Utilisations par heure (GMT)"><BarChart data={t.by_hour.map((v, h) => ({ label: `${h} h`, value: v }))} color="#7A5CF0" /></Card>
        <Card title="Utilisations par jour de la semaine"><BarChart data={t.by_weekday.map((v, d) => ({ label: WEEKDAYS[d], value: v }))} color="#14A37F" /></Card>
        <Card title="Erreurs les plus fréquentes">
          {t.errors.length === 0 ? <Empty>Aucune erreur. 🎉</Empty> : <table className="table small"><tbody>{t.errors.map((e, i) => <tr key={i}><td>{TOOL_LABELS[e.tool] ?? e.tool}</td><td><code>{e.error ?? '?'}</code></td><td>{e.n}</td></tr>)}</tbody></table>}
        </Card>
        <Card title="Assistant IA : tâches demandées">
          {t.ai.length === 0 ? <Empty>Aucune tâche IA.</Empty> : <table className="table small"><tbody>{t.ai.map((a) => <tr key={a.task ?? '?'}><td>{a.task ?? '?'}</td><td>{a.n}</td></tr>)}</tbody></table>}
        </Card>
      </div>
      {t.crashes.length > 0 && <Card title="Plantages de l'application">
        <table className="table small"><thead><tr><th>Erreur</th><th>Où</th><th>Version</th><th>Nombre</th></tr></thead><tbody>
          {t.crashes.map((c, i) => <tr key={i}><td><code>{c.error}</code></td><td><code style={{ whiteSpace: 'pre-wrap' }}>{(c.ou ?? '').split('\n')[0]}</code></td><td>{c.app_version}</td><td>{c.n}</td></tr>)}
        </tbody></table></Card>}
    </div>
  );
}

export function AppTabs({ tab, days, f, setF }: { tab: string; days: number; f: Filters; setF: (f: Filters) => void }) {
  const { s, error } = useAppStats(days, f);
  if (error) return <Alert>{error}</Alert>;
  return (
    <div className="stack">
      <FilterBar s={s} f={f} setF={setF} />
      {!s ? <div className="muted">Chargement…</div> : tab === 'users' ? <UsersTab s={s} /> : tab === 'devices' ? <DevicesTab s={s} /> : <ToolsTab s={s} />}
    </div>
  );
}
