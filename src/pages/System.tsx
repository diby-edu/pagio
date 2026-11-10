import { Fragment, useEffect, useState } from 'react';
import { api, download, fmtBytes, fmtNum } from '../api';
import { Alert, Card, useFlash } from '../ui';
import { AlertList, ServerAlert } from './AlertList';

interface Machine { disk: { total_mb: number; free_mb: number } | null; cpus: number; load: number[]; platform: string; mem_total_mb: number; mem_free_mb: number }
interface Sys {
  node: string; uptime_s: number; db_file: string; db_bytes: number; libreoffice: boolean; memory_mb: number; counts: Record<string, number>;
  machine: Machine; alerts: ServerAlert[]; backups: { count: number; bytes: number } | null;
}

const COUNT_LABEL: Record<string, string> = {
  users: 'Utilisateurs', events: 'Événements', ai_usage: 'Requêtes IA', conversions: 'Conversions', feedback: 'Messages reçus', audit: "Entrées du journal d'audit", server_errors: 'Erreurs du serveur',
};
const gb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} Go` : `${mb} Mo`);

/** Jauge d'occupation : verte, puis orange au-delà de 80 %, rouge au-delà de 90 %. */
function Gauge({ label, used, total, unit }: { label: string; used: number; total: number; unit: (n: number) => string }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const color = pct >= 90 ? '#E5484D' : pct >= 80 ? '#F5A524' : '#14A37F';
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', fontSize: 14 }}><span>{label}</span><b>{pct} % — {unit(used)} sur {unit(total)}</b></div>
      <div style={{ height: 10, borderRadius: 6, background: 'var(--line)', overflow: 'hidden', marginTop: 4 }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
      </div>
    </div>
  );
}

export default function System({ go }: { go?: (page: string) => void }) {
  const [s, setS] = useState<Sys | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, show] = useFlash();
  const load = () => api<Sys>('GET', '/api/admin/system').then(setS).catch((e) => setError(e.message));
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, []);
  if (error) return <Alert>{error}</Alert>;
  if (!s) return <div className="muted">Chargement…</div>;
  const m = s.machine;
  const days = Math.floor(s.uptime_s / 86400);

  return (
    <div className="stack">
      {flash}
      {s.alerts.length === 0 ? <Alert tone="success">Tout est en ordre : aucun point à surveiller.</Alert> : <AlertList alerts={s.alerts} go={go} />}
      <div className="grid2">
        <Card title="État de la machine" actions={<button className="btn small" onClick={load}>Actualiser</button>}>
          {m.disk ? <Gauge label="Disque" used={m.disk.total_mb - m.disk.free_mb} total={m.disk.total_mb} unit={gb} /> : <p className="muted">Espace disque : information indisponible sur ce système.</p>}
          <Gauge label="Mémoire" used={m.mem_total_mb - m.mem_free_mb} total={m.mem_total_mb} unit={gb} />
          <div className="kv">
            <span>Système</span><b>{m.platform}</b>
            <span>Processeurs</span><b>{m.cpus}</b>
            <span>Charge (1 / 5 / 15 min)</span><b>{m.load.every((n) => n === 0) ? 'non mesurée sous Windows' : m.load.join(' / ')}</b>
          </div>
          <p className="muted small">Actualisé toutes les 30 secondes.</p>
        </Card>
        <Card title="Serveur Pagio">
          <div className="kv">
            <span>Node.js</span><b>{s.node}</b>
            <span>En ligne depuis</span><b>{days > 0 ? `${days} j ` : ''}{Math.floor((s.uptime_s % 86400) / 3600)} h {Math.floor((s.uptime_s % 3600) / 60)} min</b>
            <span>Mémoire du serveur</span><b>{s.memory_mb} Mo</b>
            <span>LibreOffice</span><b>{s.libreoffice ? '✔ installé' : '✘ absent'}</b>
            <span>Base de données</span><b>{fmtBytes(s.db_bytes)}</b>
            {s.backups && <><span>Sauvegardes</span><b>{s.backups.count} fichier(s), {fmtBytes(s.backups.bytes)}</b></>}
          </div>
          <p className="muted small"><code>{s.db_file}</code> — sauvegardé chaque jour (voir la page Sauvegardes).</p>
        </Card>
      </div>
      <div className="grid2">
        <Card title="Volumes">
          <div className="kv">{Object.entries(s.counts).map(([k, v]) => <Fragment key={k}><span>{COUNT_LABEL[k] ?? k}</span><b>{fmtNum(v)}</b></Fragment>)}</div>
        </Card>
        <Card title="Maintenance des données">
          <div className="row gap wrap">
            <button className="btn" onClick={() => download('/api/admin/export/users.csv', 'utilisateurs-pagio.csv').catch((e) => show(e.message, 'error'))}>Exporter les utilisateurs (CSV)</button>
            <button className="btn danger" onClick={async () => {
              const d = prompt('Supprimer les événements plus anciens que combien de jours ? (7 minimum)', '180');
              if (!d) return;
              try { const r = await api<{ deleted: number }>('POST', '/api/admin/system/purge-events', { older_than_days: Number(d) }); show(`${r.deleted} événement(s) supprimé(s)`); load(); }
              catch (e) { show((e as Error).message, 'error'); }
            }}>Purger les anciens événements</button>
          </div>
          <p className="muted small" style={{ marginTop: 12 }}>La purge allège la base ; elle est réservée au propriétaire et inscrite au journal d'audit.</p>
        </Card>
      </div>
    </div>
  );
}
