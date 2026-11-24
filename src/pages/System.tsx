import { Fragment, useEffect, useState } from 'react';
import { api, download, fmtBytes, fmtNum } from '../api';
import { Alert, Card, useFlash } from '../ui';
import { AlertList, ServerAlert } from './AlertList';
import { SystemMetrics, Thresholds } from './SystemMetrics';

interface Machine { disk: { total_mb: number; free_mb: number } | null; cpus: number; load: number[]; platform: string; mem_total_mb: number; mem_free_mb: number }
interface Availability {
  incidents: { debut: number; fin: number; duree_s: number; redemarre: boolean }[];
  disponibilite_30j: number; derniere_verification: number; gardien_actif: boolean;
  certificats: { domaine: string; noms: string; expire: number; jours: number }[];
}
interface Sys {
  node: string; uptime_s: number; db_file: string; db_bytes: number; libreoffice: boolean; memory_mb: number; counts: Record<string, number>;
  machine: Machine; alerts: ServerAlert[]; backups: { count: number; bytes: number } | null; availability: Availability | null;
}
interface NotifyDevice { id: number; name: string; created_at: number; last_seen: number | null; admin_email: string }

const when = (ms: number) => new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const dur = (s: number) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);

/** Disponibilité relevée par le gardien du VPS : pannes, redémarrages automatiques, certificats HTTPS. */
function AvailabilityCard({ av }: { av: Availability | null }) {
  if (!av) return (
    <Card title="Disponibilité">
      <p className="muted">Le gardien du serveur n'est pas installé : pannes et certificats ne sont pas surveillés (voir docs/SERVEUR.md, « Gardien »).</p>
    </Card>
  );
  const color = av.disponibilite_30j >= 99.9 ? '#14A37F' : av.disponibilite_30j >= 99 ? '#F5A524' : '#E5484D';
  return (
    <Card title="Disponibilité (30 derniers jours)">
      <div className="row gap wrap" style={{ alignItems: 'baseline' }}>
        <b style={{ fontSize: 34, color }}>{av.disponibilite_30j.toLocaleString('fr-FR')} %</b>
        <span className="muted">{av.incidents.length === 0 ? 'aucune panne' : `${av.incidents.length} panne(s)`}</span>
      </div>
      <p className="small" style={{ margin: '6px 0 12px' }}>
        {av.gardien_actif ? `✔ Gardien actif — vérifie chaque minute, redémarre Pagio s'il ne répond plus (dernière vérification : ${when(av.derniere_verification)}).`
          : <span style={{ color: '#E5484D' }}>✘ Le gardien ne s'est pas manifesté depuis le {when(av.derniere_verification)}.</span>}
      </p>
      <h4 style={{ margin: '8px 0 4px' }}>Certificats HTTPS</h4>
      <div className="kv">{av.certificats.map((c) => (
        <Fragment key={c.domaine}><span title={c.noms}>{c.noms || c.domaine}</span>
          <b style={{ color: c.jours < 5 ? '#E5484D' : c.jours < 14 ? '#F5A524' : undefined }}>expire le {new Date(c.expire).toLocaleDateString('fr-FR')} ({c.jours} j)</b></Fragment>
      ))}</div>
      <p className="muted small">Renouvelés automatiquement environ 30 jours avant l'échéance ; une alerte apparaît si ce n'est pas fait à 14 jours.</p>
      {av.incidents.length > 0 && <>
        <h4 style={{ margin: '12px 0 4px' }}>Pannes</h4>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Début</th><th>Durée</th><th>Réparation</th></tr></thead>
          <tbody>{av.incidents.map((i) => <tr key={i.debut}><td>{when(i.debut)}</td><td>{dur(i.duree_s)}</td><td>{i.redemarre ? 'Redémarrage automatique' : 'Retour seul'}</td></tr>)}</tbody>
        </table></div>
      </>}
    </Card>
  );
}

/** Téléphones qui reçoivent les notifications de l'APK admin (clé créée automatiquement à la connexion dans l'APK). */
function NotifyDevicesCard({ show }: { show: (m: string, tone?: 'error') => void }) {
  const [list, setList] = useState<NotifyDevice[] | null>(null);
  const load = () => api<{ devices: NotifyDevice[] }>('GET', '/api/admin/notify/devices').then((r) => setList(r.devices)).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  return (
    <Card title="Téléphones notifiés (APK admin)">
      {!list ? <p className="muted">Chargement…</p> : list.length === 0
        ? <p className="muted">Aucun téléphone. Installez l'APK admin et connectez-vous : il apparaîtra ici et recevra les notifications (panne, alertes, messages des utilisateurs).</p>
        : <div className="table-wrap"><table className="table">
          <thead><tr><th>Téléphone</th><th>Administrateur</th><th>Dernière vérification</th><th /></tr></thead>
          <tbody>{list.map((d) => (
            <tr key={d.id}><td>{d.name}</td><td>{d.admin_email}</td><td>{d.last_seen ? when(d.last_seen) : 'jamais'}</td>
              <td><button className="btn small danger" onClick={async () => {
                if (!confirm(`Ne plus envoyer de notifications à « ${d.name} » ?`)) return;
                try { await api('DELETE', `/api/admin/notify/devices/${d.id}`); show('Téléphone retiré'); load(); } catch (e) { show((e as Error).message, 'error'); }
              }}>Retirer</button></td></tr>
          ))}</tbody>
        </table></div>}
    </Card>
  );
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
      <SystemMetrics onSaveThresholds={async (t: Partial<Thresholds>) => {
        try {
          const cur = await api<{ settings: { monitor: Thresholds } }>('GET', '/api/admin/settings');
          await api('PUT', '/api/admin/settings', { monitor: { ...cur.settings.monitor, ...t } });
          show('Réglage enregistré'); load();
        } catch (e) { show((e as Error).message, 'error'); }
      }} />
      <div className="grid2">
        <AvailabilityCard av={s.availability} />
        <NotifyDevicesCard show={show} />
      </div>
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
