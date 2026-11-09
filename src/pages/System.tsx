import { Fragment, useEffect, useState } from 'react';
import { api, download, fmtNum } from '../api';
import { Alert, Card, useFlash } from '../ui';

interface Sys { node: string; uptime_s: number; db_file: string; db_bytes: number; libreoffice: boolean; memory_mb: number; counts: Record<string, number> }

export default function System() {
  const [s, setS] = useState<Sys | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, show] = useFlash();
  const load = () => api<Sys>('GET', '/api/admin/system').then(setS).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  if (error) return <Alert>{error}</Alert>;
  if (!s) return <div className="muted">Chargement…</div>;
  return (
    <div className="stack">
      {flash}
      <div className="grid2">
        <Card title="Serveur">
          <div className="kv">
            <span>Node.js</span><b>{s.node}</b>
            <span>En ligne depuis</span><b>{Math.floor(s.uptime_s / 3600)} h {Math.floor((s.uptime_s % 3600) / 60)} min</b>
            <span>Mémoire</span><b>{s.memory_mb} Mo</b>
            <span>LibreOffice</span><b>{s.libreoffice ? '✔ installé' : '✘ absent'}</b>
            <span>Base de données</span><b>{(s.db_bytes / 1048576).toFixed(2)} Mo</b>
          </div>
          <p className="muted small"><code>{s.db_file}</code> — sauvegardé chaque jour (voir la page Sauvegardes).</p>
        </Card>
        <Card title="Volumes">
          <div className="kv">{Object.entries(s.counts).map(([k, v]) => <Fragment key={k}><span>{k}</span><b>{fmtNum(v)}</b></Fragment>)}</div>
        </Card>
      </div>
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
      </Card>
    </div>
  );
}
