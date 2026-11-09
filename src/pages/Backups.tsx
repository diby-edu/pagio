import { useEffect, useRef, useState } from 'react';
import { Admin, Backup, BackupSettings, api, download, fmtBytes, fmtDate, fmtNum, upload } from '../api';
import { Alert, Badge, Card, Empty, Field, Toggle, useFlash } from '../ui';

const KIND: Record<string, { label: string; tone: string }> = {
  auto: { label: 'automatique', tone: 'indigo' },
  manuelle: { label: 'manuelle', tone: 'teal' },
  importee: { label: 'importée', tone: 'violet' },
  'avant-restauration': { label: 'avant restauration', tone: 'coral' },
};

export default function Backups({ admin }: { admin: Admin }) {
  const [rows, setRows] = useState<Backup[] | null>(null);
  const [conf, setConf] = useState<BackupSettings | null>(null);
  const [dir, setDir] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<Backup | null>(null);
  const [password, setPassword] = useState('');
  const [flash, show] = useFlash();
  const fileInput = useRef<HTMLInputElement>(null);
  const owner = admin.role === 'owner';

  const load = () => api<{ backups: Backup[]; settings: BackupSettings; dir: string }>('GET', '/api/admin/backups')
    .then((r) => { setRows(r.backups); setConf((c) => c ?? r.settings); setDir(r.dir); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } catch (e) { show((e as Error).message, 'error'); } finally { setBusy(false); } };

  if (error) return <Alert>{error}</Alert>;
  if (!rows || !conf) return <div className="muted">Chargement…</div>;
  const lastAuto = rows.find((b) => b.kind === 'auto');
  const late = conf.enabled && (!lastAuto || Date.now() - lastAuto.created_at > 36 * 3_600_000);

  return (
    <div className="stack">
      {flash}
      {!conf.enabled && <Alert tone="warning">La sauvegarde automatique est désactivée : en cas de panne, les données depuis la dernière sauvegarde manuelle seraient perdues.</Alert>}
      {late && rows.length > 0 && <Alert tone="warning">Aucune sauvegarde automatique depuis plus de 36 heures. Vérifiez que le serveur reste allumé à l'heure prévue.</Alert>}
      <Alert tone="info">Ces sauvegardes sont stockées sur le serveur lui-même. Téléchargez-en une régulièrement (ou mettez en place une copie
        externe) : si le disque du serveur est perdu, les sauvegardes qui s'y trouvent le sont aussi.</Alert>

      <div className="grid2">
        <Card title="Sauvegarde automatique">
          <Toggle checked={conf.enabled} onChange={(v) => setConf({ ...conf, enabled: v })} label={conf.enabled ? 'Une sauvegarde chaque jour' : 'Désactivée'} />
          <div className="grid2" style={{ marginTop: 12 }}>
            <Field label="Heure (0 à 23)" hint="Heure du serveur. La sauvegarde part dès cette heure passée.">
              <input type="number" min={0} max={23} value={conf.hour} onChange={(e) => setConf({ ...conf, hour: Number(e.target.value) })} />
            </Field>
            <Field label="Conservation (jours)" hint="Les sauvegardes automatiques plus anciennes sont supprimées.">
              <input type="number" min={1} max={3650} value={conf.keep_days} onChange={(e) => setConf({ ...conf, keep_days: Number(e.target.value) })} />
            </Field>
          </div>
          <button className="btn primary" disabled={busy} onClick={() => run(async () => {
            const r = await api<{ settings: { backup: BackupSettings } }>('PUT', '/api/admin/settings', { backup: conf });
            setConf(r.settings.backup); show('Réglages de sauvegarde enregistrés');
          })}>Enregistrer</button>
        </Card>
        <Card title="Sauvegarder maintenant">
          <p className="muted">Crée une copie complète de la base (comptes, réglages, statistiques) sans interrompre le service.
            Conseillé avant toute mise à jour du serveur.</p>
          <div className="row gap wrap">
            <button className="btn primary" disabled={busy} onClick={() => run(async () => {
              const r = await api<{ backup: Backup }>('POST', '/api/admin/backups'); show(`Sauvegarde créée (${fmtBytes(r.backup.bytes)})`); load();
            })}>Créer une sauvegarde</button>
            {owner && <>
              <button className="btn" disabled={busy} onClick={() => fileInput.current?.click()}>Importer un fichier…</button>
              <input ref={fileInput} type="file" accept=".gz,.db" hidden onChange={(e) => {
                const f = e.target.files?.[0]; e.target.value = '';
                if (f) run(async () => { await upload('/api/admin/backups/import', f); show('Sauvegarde importée et vérifiée'); load(); });
              }} />
            </>}
          </div>
          <p className="muted small" style={{ marginTop: 12 }}>Dossier sur le serveur : <code>{dir}</code></p>
        </Card>
      </div>

      {restoring && (
        <Card title={`Restaurer la sauvegarde du ${fmtDate(restoring.created_at)}`}>
          <Alert tone="warning">Toutes les données actuelles (utilisateurs, réglages, statistiques, administrateurs) seront remplacées par celles
            de cette sauvegarde. L'état actuel est d'abord mis de côté dans une sauvegarde « avant restauration », pour pouvoir revenir en arrière.</Alert>
          <Field label="Votre mot de passe" hint="Demandé pour confirmer cette opération."><input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <div className="row gap">
            <button className="btn danger" disabled={busy || !password} onClick={() => run(async () => {
              const r = await api<{ counts: Record<string, number> }>('POST', `/api/admin/backups/${restoring.name}/restore`, { password });
              setRestoring(null); setPassword(''); setConf(null);
              show(`Restauration terminée : ${fmtNum(r.counts.users ?? 0)} utilisateur(s)`); load();
            })}>Restaurer maintenant</button>
            <button className="btn ghost" onClick={() => { setRestoring(null); setPassword(''); }}>Annuler</button>
          </div>
        </Card>
      )}

      <Card title={`Sauvegardes disponibles (${rows.length})`}>
        {rows.length === 0 ? <Empty>Aucune sauvegarde pour l'instant. La première automatique sera créée à l'heure prévue.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Date</th><th>Type</th><th>Taille</th><th /></tr></thead>
            <tbody>{rows.map((b) => (
              <tr key={b.name}>
                <td><strong>{fmtDate(b.created_at)}</strong><br /><span className="muted small">{b.name}</span></td>
                <td><Badge tone={KIND[b.kind]?.tone ?? 'grey'}>{KIND[b.kind]?.label ?? b.kind}</Badge></td>
                <td>{fmtBytes(b.bytes)}</td>
                <td><div className="row gap wrap">
                  <button className="btn small" disabled={busy} onClick={() => run(async () => {
                    const r = await api<{ counts: Record<string, number> }>('POST', `/api/admin/backups/${b.name}/verify`);
                    show(`Sauvegarde intacte : ${fmtNum(r.counts.users ?? 0)} utilisateur(s), ${fmtNum(r.counts.events ?? 0)} événement(s)`);
                  })}>Vérifier</button>
                  {owner && <>
                    <button className="btn small" onClick={() => download(`/api/admin/backups/${b.name}`, b.name).catch((e) => show(e.message, 'error'))}>Télécharger</button>
                    <button className="btn small" onClick={() => { setRestoring(b); setPassword(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Restaurer…</button>
                    <button className="btn small danger" disabled={busy} onClick={() => { if (confirm(`Supprimer définitivement la sauvegarde du ${fmtDate(b.created_at)} ?`)) run(async () => { await api('DELETE', `/api/admin/backups/${b.name}`); show('Sauvegarde supprimée'); load(); }); }}>Supprimer</button>
                  </>}
                </div></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
        {!owner && <p className="muted small">Télécharger, importer, restaurer et supprimer sont réservés au propriétaire : une sauvegarde contient tous les comptes.</p>}
      </Card>
    </div>
  );
}
