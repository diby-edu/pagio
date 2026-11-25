// Versions de l'application Android : publier une nouvelle APK depuis le tableau de bord (avec notes de version et
// mise à jour obligatoire), déposer une version d'essai, revenir à une version précédente, supprimer les anciennes.
import { useEffect, useRef, useState } from 'react';
import { api, fmtBytes, session } from '../api';
import { Alert, Card, useFlash } from '../ui';

interface Release { file: string; version: string; essai: boolean; code: number; bytes: number; date: number; current: boolean }
interface State {
  enabled: boolean; files: Release[]; current: string | null; info: { version: string; date: string } | null;
  latest_version_name: string; min_version_code: number; notes: string; public_url: string;
}

const day = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const codeOf = (v: string) => { const [a, b, c] = v.split('.').map(Number); return a * 10000 + b * 100 + c; };

export default function Releases({ owner }: { owner: boolean }) {
  const [st, setSt] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, show] = useFlash();
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [essai, setEssai] = useState(false);
  const [mandatory, setMandatory] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [editNotes, setEditNotes] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const load = () => api<State>('GET', '/api/admin/releases').then(setSt).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  // Numéro proposé d'après le nom du fichier (pagio-2.4.0.apk), sinon la version actuelle + 1 sur le dernier chiffre.
  const pick = (f: File | null) => {
    setFile(f);
    const m = f?.name.match(/(\d+\.\d+\.\d+)/);
    if (m) setVersion(m[1]);
    else if (st?.latest_version_name && !version) { const [a, b, c] = st.latest_version_name.split('.').map(Number); setVersion(`${a}.${b + 1}.${c * 0}`); }
  };

  const upload = () => {
    if (!file) return;
    const q = new URLSearchParams({ version: version.trim(), essai: essai ? '1' : '0', mandatory: mandatory && !essai ? '1' : '0', notes: essai ? '' : notes });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${session.server}/api/admin/releases?${q}`);
    xhr.setRequestHeader('Authorization', `Bearer ${session.token}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      setProgress(null);
      let r: (State & { error?: string; saved?: string; url?: string }) | null = null;
      try { r = JSON.parse(xhr.responseText); } catch { r = null; }
      if (xhr.status !== 200 || !r) { show(r?.error || `Erreur ${xhr.status}`, 'error'); return; }
      setSt(r); setFile(null); setNotes(''); setMandatory(false); if (input.current) input.current.value = '';
      show(essai ? `Version d'essai déposée : ${r.url}` : `Pagio ${version} est maintenant proposée à tous`);
      setEssai(false);
    };
    xhr.onerror = () => { setProgress(null); show('Envoi interrompu (connexion). Réessayez.', 'error'); };
    setProgress(0);
    xhr.send(file);
  };

  if (error) return <Alert>{error}</Alert>;
  if (!st) return <div className="muted">Chargement…</div>;
  const latestCode = st.latest_version_name ? codeOf(st.latest_version_name) : 0;
  const forced = st.min_version_code > 0 && st.min_version_code >= latestCode;

  return (
    <div className="stack">
      {flash}
      <Card title="Version proposée aujourd'hui">
        {st.info ? <>
          <p style={{ fontSize: 28, fontWeight: 800, margin: '0 0 4px' }}>Pagio {st.info.version}</p>
          <p className="muted small">Publiée le {st.info.date} · bouton « Télécharger » du site : <a href={`${st.public_url}/telecharger/pagio.apk`}>{st.public_url}/telecharger/pagio.apk</a></p>
          <p className="small">{forced
            ? <b style={{ color: '#E5484D' }}>Mise à jour obligatoire : les versions plus anciennes sont bloquées jusqu'à la mise à jour.</b>
            : <>Les applications plus anciennes voient le bandeau « Nouvelle version disponible ».</>}</p>
          <h4 style={{ margin: '12px 0 4px' }}>Notes de version (affichées dans l'application)</h4>
          {editNotes === null
            ? <>
              <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{st.notes || <span className="muted">Aucune note.</span>}</p>
              {owner && <button className="btn small" onClick={() => setEditNotes(st.notes)}>Modifier les notes</button>}
            </>
            : <>
              <textarea rows={4} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} style={{ width: '100%' }} maxLength={2000} />
              <div className="row" style={{ gap: 8 }}>
                <button className="btn" onClick={async () => { try { setSt(await api<State>('PUT', '/api/admin/releases/notes', { notes: editNotes })); setEditNotes(null); show('Notes enregistrées'); } catch (e) { show((e as Error).message, 'error'); } }}>Enregistrer</button>
                <button className="btn small" onClick={() => setEditNotes(null)}>Annuler</button>
              </div>
            </>}
        </> : <p className="muted">Aucune version publiée depuis ce tableau de bord pour l'instant.</p>}
      </Card>

      {owner && <Card title="Publier une nouvelle version">
        {!st.enabled
          ? <Alert>Le dossier des téléchargements n'est pas relié au serveur (variable RELEASES_DIR) : l'envoi est impossible pour l'instant.</Alert>
          : <>
            <p className="muted small">Choisissez l'APK construite (signée) ; le serveur vérifie qu'il s'agit bien de Pagio et que le numéro correspond au fichier.</p>
            <input ref={input} type="file" accept=".apk,application/vnd.android.package-archive" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            {file && <p className="small">{file.name} · {fmtBytes(file.size)}</p>}
            <div className="grid2" style={{ marginTop: 10 }}>
              <label>Numéro de version<input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="2.4.0" inputMode="decimal" /></label>
            </div>
            <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={essai} onChange={(e) => setEssai(e.target.checked)} /> Version d'essai : déposée avec un lien direct, mais pas proposée aux utilisateurs</label>
            {!essai && <>
              <label style={{ display: 'block', marginTop: 10 }}>Notes de version (ce qui change, montré dans l'application)
                <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder={'Nouvel écran Premium\nE-mail de bienvenue\nCorrections'} style={{ width: '100%' }} />
              </label>
              <label className="check"><input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} /> Mise à jour obligatoire (les anciennes versions sont bloquées jusqu'à la mise à jour : à réserver aux corrections importantes)</label>
            </>}
            {progress !== null
              ? <div style={{ marginTop: 12 }}>
                <div style={{ height: 10, borderRadius: 6, background: 'var(--line)', overflow: 'hidden' }}><div style={{ width: `${progress}%`, height: '100%', background: '#5B4BDB' }} /></div>
                <p className="small muted">{progress < 100 ? `Envoi… ${progress} %` : 'Vérification de l’APK…'}</p>
              </div>
              : <button className="btn" style={{ marginTop: 12 }} disabled={!file || !/^\d+\.\d+\.\d+$/.test(version.trim())} onClick={() => {
                if (!essai && !confirm(`Proposer Pagio ${version} à tous les utilisateurs${mandatory ? ' (mise à jour OBLIGATOIRE)' : ''} ?`)) return;
                upload();
              }}>{essai ? 'Déposer la version d’essai' : `Publier Pagio ${version || ''}`}</button>}
          </>}
      </Card>}

      <Card title="Toutes les versions">
        {st.files.length === 0 ? <p className="muted">Aucun fichier.</p> : <div className="table-wrap"><table className="table">
          <thead><tr><th>Version</th><th>Taille</th><th>Date</th><th>État</th>{owner && <th />}</tr></thead>
          <tbody>{st.files.map((r) => (
            <tr key={r.file}>
              <td><a href={`${st.public_url}/telecharger/${r.file}`}>{r.version}{r.essai ? ' (essai)' : ''}</a></td>
              <td>{fmtBytes(r.bytes)}</td>
              <td>{day(r.date)}</td>
              <td>{r.current ? <b style={{ color: '#14A37F' }}>Proposée à tous</b> : r.essai ? 'Essai (lien direct)' : 'Ancienne'}</td>
              {owner && <td className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                {!r.current && !r.essai && <button className="btn small" onClick={async () => {
                  if (!confirm(`Proposer de nouveau Pagio ${r.version} à tous (retour en arrière) ?`)) return;
                  try { setSt(await api<State>('POST', '/api/admin/releases/current', { file: r.file })); show(`Pagio ${r.version} est de nouveau proposée`); } catch (e) { show((e as Error).message, 'error'); }
                }}>Proposer à tous</button>}
                {!r.current && <button className="btn small danger" onClick={async () => {
                  if (!confirm(`Supprimer définitivement ${r.file} du serveur ?`)) return;
                  try { setSt(await api<State>('DELETE', `/api/admin/releases/${encodeURIComponent(r.file)}`)); show('Fichier supprimé'); } catch (e) { show((e as Error).message, 'error'); }
                }}>Supprimer</button>}
              </td>}
            </tr>
          ))}</tbody>
        </table></div>}
      </Card>
    </div>
  );
}
