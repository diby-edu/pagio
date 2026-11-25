// Notifications de Pagio Admin : téléphones, cases à cocher (ce que chacun reçoit), essai, et réglage de Firebase
// (envoi instantané). Sans Firebase, les téléphones vérifient toutes les 15 minutes ; les cases s'appliquent aux deux.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Card } from '../ui';

interface Kind { id: string; label: string; detail: string; on: boolean }
interface Prefs { kinds: Record<string, boolean>; quiet: boolean }
interface Device { id: number; name: string; created_at: number; last_seen: number | null; admin_email: string; mine: boolean; push: boolean; fcm_at: number | null; prefs: Prefs }
interface Devices { kinds: Kind[]; firebase: { client: boolean; service: boolean }; devices: Device[] }
type Show = (m: string, tone?: 'error') => void;

const when = (ms: number) => new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

function DevicePrefs({ d, kinds, show, reload }: { d: Device; kinds: Kind[]; show: Show; reload: () => void }) {
  const [prefs, setPrefs] = useState<Prefs>(d.prefs);
  const [busy, setBusy] = useState(false);
  const save = async (next: Prefs) => {
    setPrefs(next); setBusy(true);
    try { await api('PUT', `/api/admin/notify/devices/${d.id}/prefs`, next); show('Préférences enregistrées'); }
    catch (e) { setPrefs(prefs); show((e as Error).message, 'error'); }
    setBusy(false);
  };
  return (
    <div className="notify-device">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong>{d.name}</strong>
          <div className="muted small">
            {d.admin_email} · dernière vérification : {d.last_seen ? when(d.last_seen) : 'jamais'} ·{' '}
            {d.push ? <span style={{ color: '#14A37F' }}>notifications instantanées</span> : <span>vérification toutes les 15 min</span>}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn small" disabled={busy} onClick={async () => {
            try { const r = await api<{ message: string }>('POST', `/api/admin/notify/devices/${d.id}/test`); show(r.message); } catch (e) { show((e as Error).message, 'error'); }
          }}>Envoyer un essai</button>
          <button className="btn small danger" onClick={async () => {
            if (!confirm(`Ne plus envoyer de notifications à « ${d.name} » ?`)) return;
            try { await api('DELETE', `/api/admin/notify/devices/${d.id}`); show('Téléphone retiré'); reload(); } catch (e) { show((e as Error).message, 'error'); }
          }}>Retirer</button>
        </div>
      </div>
      <fieldset className="notify-kinds" disabled={busy}>
        <legend className="muted small">Ce que ce téléphone reçoit</legend>
        {kinds.map((k) => (
          <label key={k.id} className="notify-kind">
            <input type="checkbox" checked={prefs.kinds[k.id] ?? k.on} onChange={(e) => save({ ...prefs, kinds: { ...prefs.kinds, [k.id]: e.target.checked } })} />
            <span><b>{k.label}</b><span className="muted small"> — {k.detail}</span></span>
          </label>
        ))}
        <label className="notify-kind quiet">
          <input type="checkbox" checked={prefs.quiet} onChange={(e) => save({ ...prefs, quiet: e.target.checked })} />
          <span><b>Silence la nuit (22 h – 7 h)</b><span className="muted small"> — les notifications arrivent sans son, sauf les alertes urgentes.</span></span>
        </label>
      </fieldset>
    </div>
  );
}

/** Téléphones qui reçoivent les notifications de l'APK admin (clé créée automatiquement à la connexion dans l'APK). */
export function NotifyDevicesCard({ show }: { show: Show }) {
  const [data, setData] = useState<Devices | null>(null);
  const load = () => api<Devices>('GET', '/api/admin/notify/devices').then(setData).catch(() => setData({ kinds: [], firebase: { client: false, service: false }, devices: [] }));
  useEffect(() => { load(); }, []);
  return (
    <Card title="Notifications sur téléphone (APK admin)">
      {!data ? <p className="muted">Chargement…</p> : <>
        <p className="muted small">
          {data.firebase.client && data.firebase.service
            ? 'Firebase est actif : les notifications arrivent en quelques secondes sur les téléphones à jour.'
            : 'Firebase n’est pas encore réglé : les téléphones vérifient toutes les 15 minutes (Android peut retarder).'}
          {' '}Cochez pour chaque téléphone ce qu’il doit recevoir ; c’est enregistré tout de suite.
        </p>
        {data.devices.length === 0
          ? <p className="muted">Aucun téléphone. Installez l’APK admin et connectez-vous : il apparaîtra ici.</p>
          : data.devices.map((d) => <DevicePrefs key={d.id} d={d} kinds={data.kinds} show={show} reload={load} />)}
      </>}
    </Card>
  );
}

/** Réglage de Firebase (propriétaire) : deux fichiers JSON à coller, dans n'importe quel ordre. */
export function FirebaseCard({ show }: { show: Show }) {
  const [st, setSt] = useState<{ client: { project_id: string; app_id: string } | null; service: { project_id: string; client_email: string } | null } | null | 'denied'>(null);
  const [json, setJson] = useState('');
  const load = () => api<NonNullable<Exclude<typeof st, 'denied'>>>('GET', '/api/admin/firebase').then(setSt).catch(() => setSt('denied'));
  useEffect(() => { load(); }, []);
  if (st === 'denied' || st === null) return null; // réservé au propriétaire
  const done = st.client && st.service;
  return (
    <Card title="Firebase (notifications instantanées)">
      <ol className="small" style={{ margin: '0 0 10px', paddingLeft: 18 }}>
        <li className={st.client ? 'muted' : undefined}>
          {st.client ? '✓ ' : ''}Console Firebase › projet <b>Pagio</b> › ⚙ Paramètres du projet › onglet <i>Général</i> › application
          « Pagio Admin » › bouton <b>google-services.json</b> : ouvrez le fichier, copiez tout son texte et collez-le ci-dessous.
        </li>
        <li className={st.service ? 'muted' : undefined}>
          {st.service ? '✓ ' : ''}Même page, onglet <i>Comptes de service</i> › <b>Générer une nouvelle clé privée</b> : ouvrez le fichier
          téléchargé, copiez tout son texte et collez-le ci-dessous. Ce fichier est secret : supprimez-le de l’ordinateur ensuite.
        </li>
      </ol>
      {done
        ? <p className="small">Firebase est réglé (projet <b>{st.service!.project_id}</b>). Les téléphones s’y abonnent à leur prochaine ouverture.</p>
        : <>
          <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={5} placeholder='{ "type": "service_account", … } ou { "project_info": … }'
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }} spellCheck={false} autoComplete="off" />
          <button className="btn" disabled={json.trim().length < 20} onClick={async () => {
            try {
              const r = await api<{ saved: string }>('PUT', '/api/admin/firebase', { json });
              setJson(''); show(r.saved === 'client' ? 'google-services.json enregistré' : 'Clé de compte de service enregistrée (chiffrée)'); load();
            } catch (e) { show((e as Error).message, 'error'); }
          }}>Enregistrer</button>
        </>}
      {(st.client || st.service) && <p style={{ marginTop: 10 }}><button className="btn small danger" onClick={async () => {
        if (!confirm('Effacer le réglage Firebase ? Les téléphones repasseront à la vérification toutes les 15 minutes.')) return;
        try { await api('DELETE', '/api/admin/firebase'); show('Réglage Firebase effacé'); load(); } catch (e) { show((e as Error).message, 'error'); }
      }}>Effacer le réglage Firebase</button></p>}
    </Card>
  );
}
