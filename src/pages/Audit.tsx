import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api';
import { Alert, Card, Empty } from '../ui';

interface Entry { id: number; ts: number; admin_email: string | null; action: string; target: string | null; details: string | null }

export default function Audit() {
  const [items, setItems] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => { api<{ audit: Entry[] }>('GET', '/api/admin/audit').then((r) => setItems(r.audit)).catch((e) => setError(e.message)); }, []);
  if (error) return <Alert>{error}</Alert>;
  if (!items) return <div className="muted">Chargement…</div>;
  const shown = items.filter((i) => !q || JSON.stringify(i).toLowerCase().includes(q.toLowerCase()));
  return (
    <Card title="Journal d'audit" actions={<input placeholder="Filtrer…" value={q} onChange={(e) => setQ(e.target.value)} />}>
      <p className="muted small">Chaque action d'administration (connexions, modifications d'utilisateurs, d'outils, de réglages) est enregistrée ici.</p>
      {shown.length === 0 ? <Empty>Aucune entrée.</Empty> : (
        <div className="table-wrap"><table className="table small">
          <thead><tr><th>Date</th><th>Administrateur</th><th>Action</th><th>Cible</th><th>Détails</th></tr></thead>
          <tbody>{shown.map((i) => (
            <tr key={i.id} className={i.action.includes('failed') ? 'warn-row' : ''}>
              <td>{fmtDate(i.ts)}</td><td>{i.admin_email ?? '—'}</td><td><code>{i.action}</code></td><td>{i.target ?? ''}</td>
              <td><code className="small">{i.details?.slice(0, 120) ?? ''}</code></td>
            </tr>))}
          </tbody>
        </table></div>
      )}
    </Card>
  );
}
