import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api';
import { Alert, Badge, Card, Empty, useFlash } from '../ui';

interface Item { id: number; ts: number; kind: string; message: string; email: string; user_id: string | null; status: string }
interface Reset { id: string; email: string; reset_expires: number }
const KIND: Record<string, string> = { bug: 'Problème', suggestion: 'Suggestion', contact: 'Contact' };

export default function Feedback() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [resets, setResets] = useState<Reset[]>([]);
  const [filter, setFilter] = useState('nouveau');
  const [error, setError] = useState<string | null>(null);
  const [flash, show] = useFlash();
  const load = () => {
    api<{ feedback: Item[] }>('GET', '/api/admin/feedback').then((r) => setItems(r.feedback)).catch((e) => setError(e.message));
    api<{ resets: Reset[] }>('GET', '/api/admin/resets').then((r) => setResets(r.resets)).catch(() => {});
  };
  useEffect(load, []);
  if (error) return <Alert>{error}</Alert>;
  if (!items) return <div className="muted">Chargement…</div>;
  const shown = items.filter((i) => !filter || i.status === filter);

  return (
    <div className="stack">
      {flash}
      {resets.length > 0 && <Card title="Demandes de mot de passe oublié">
        <p className="muted">Contactez la personne puis définissez un nouveau mot de passe depuis la page Utilisateurs.</p>
        <table className="table"><tbody>{resets.map((r) => <tr key={r.id}><td>{r.email}</td><td className="muted">expire {fmtDate(r.reset_expires)}</td></tr>)}</tbody></table>
      </Card>}
      <Card title="Messages des utilisateurs" actions={<>
        {['nouveau', 'en cours', 'traité', ''].map((f) => <button key={f} className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>{f || 'tous'}</button>)}
      </>}>
        {shown.length === 0 ? <Empty>Aucun message.</Empty> : shown.map((i) => (
          <article key={i.id} className="message">
            <header className="row gap wrap">
              <Badge tone={i.kind === 'bug' ? 'red' : i.kind === 'suggestion' ? 'violet' : 'grey'}>{KIND[i.kind] ?? i.kind}</Badge>
              <span className="muted small">{fmtDate(i.ts)}</span>
              {i.email && <a href={`mailto:${i.email}`}>{i.email}</a>}
              <span className="grow" />
              <select value={i.status} onChange={async (e) => {
                try { await api('PATCH', `/api/admin/feedback/${i.id}`, { status: e.target.value }); show('Statut mis à jour'); load(); } catch (err) { show((err as Error).message, 'error'); }
              }}><option>nouveau</option><option>en cours</option><option>traité</option></select>
            </header>
            <p>{i.message}</p>
          </article>
        ))}
      </Card>
    </div>
  );
}
