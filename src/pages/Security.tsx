import { useCallback, useEffect, useState } from 'react';
import { api, fmtDate } from '../api';
import { Alert, Badge, Card, Empty, useFlash } from '../ui';

interface Login { id: number; ts: number; user_id: string | null; email: string | null; ip: string; ua: string; ok: number; method: string }
interface Data {
  blocked_ips: string[]; logins: Login[];
  failed_24h: { ip: string; n: number; accounts: number; last: number }[];
  admin_logins: { ts: number; admin_email: string; action: string }[];
}
const device = (ua: string) => (/android/i.test(ua) ? 'Android' : /iphone|ipad/i.test(ua) ? 'iPhone' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : /okhttp|dalvik/i.test(ua) ? 'Application' : 'Autre');

/** Sécurité : connexions des utilisateurs, tentatives suspectes, adresses IP bloquées. */
export default function Security() {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [flash, show] = useFlash();
  const [ips, setIps] = useState('');
  const load = useCallback(() => api<Data>('GET', '/api/admin/security').then((r) => { setD(r); setIps(r.blocked_ips.join('\n')); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (error) return <Alert>{error}</Alert>;
  if (!d) return <div className="muted">Chargement…</div>;
  const saveIps = async (list: string[]) => {
    try { const r = await api<{ blocked_ips: string[] }>('PUT', '/api/admin/security/blocked', { ips: list }); show(`${r.blocked_ips.length} adresse(s) bloquée(s)`); load(); }
    catch (e) { show((e as Error).message, 'error'); }
  };

  return (
    <div className="stack">
      {flash}
      <div className="grid2">
        <Card title="Tentatives de connexion échouées (24 h)">
          {d.failed_24h.length === 0 ? <Empty>Aucune tentative échouée.</Empty> :
            <table className="table small"><thead><tr><th>Adresse</th><th>Échecs</th><th>Comptes visés</th><th>Dernière</th><th /></tr></thead><tbody>
              {d.failed_24h.map((f) => <tr key={f.ip}><td><code>{f.ip}</code></td><td>{f.n >= 10 ? <Badge tone="red">{f.n}</Badge> : f.n}</td><td>{f.accounts}</td><td>{fmtDate(f.last)}</td>
                <td>{!d.blocked_ips.includes(f.ip) && <button className="btn small danger" onClick={() => saveIps([...d.blocked_ips, f.ip])}>Bloquer</button>}</td></tr>)}
            </tbody></table>}
          <p className="muted small">Adresses tronquées (ex. 41.202.12.x) : on bloque alors le petit groupe d'adresses. Après 10 essais en 15 minutes, le serveur bloque déjà de lui-même pendant 15 minutes.</p>
        </Card>
        <Card title="Adresses IP bloquées">
          <p className="muted small">Une par ligne. Exemple : <code>41.202.12.7</code> ou <code>41.202.12.x</code> (tout le groupe). Les API publiques leur sont refusées ; l'administration n'est jamais bloquée.</p>
          <textarea rows={6} value={ips} onChange={(e) => setIps(e.target.value)} />
          <button className="btn primary" onClick={() => saveIps(ips.split('\n').map((x) => x.trim()).filter(Boolean))}>Enregistrer</button>
        </Card>
      </div>
      <Card title="Dernières connexions des utilisateurs">
        {d.logins.length === 0 ? <Empty>Aucune connexion enregistrée.</Empty> :
          <div className="table-wrap"><table className="table small"><thead><tr><th>Date</th><th>Compte</th><th>Résultat</th><th>Méthode</th><th>Adresse</th><th>Appareil</th></tr></thead><tbody>
            {d.logins.map((l) => <tr key={l.id}><td>{fmtDate(l.ts)}</td><td>{l.email || <span className="muted">—</span>}</td>
              <td>{l.ok ? <Badge tone="teal">réussie</Badge> : <Badge tone="red">échec</Badge>}</td><td>{l.method}</td><td><code>{l.ip}</code></td><td title={l.ua}>{device(l.ua)}</td></tr>)}
          </tbody></table></div>}
        <p className="muted small">Gardées 90 jours. Pour les données d'un utilisateur (droit d'accès), ouvrez sa fiche : « Exporter ses données ».</p>
      </Card>
    </div>
  );
}
