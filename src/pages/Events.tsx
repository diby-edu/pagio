import { useEffect, useState } from 'react';
import { TOOL_LABELS, api, fmtDate } from '../api';
import { Alert, Badge, Card, Empty, Toggle } from '../ui';

interface Ev { id: number; ts: number; device_id: string; user_id: string | null; app_version: string; name: string; tool: string | null; ok: number | null; props: string }

export default function Events() {
  const [name, setName] = useState('');
  const [errors, setErrors] = useState(false);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ total: number; events: Ev[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ total: number; events: Ev[] }>('GET', `/api/admin/events?limit=100&offset=${offset}&name=${name}&errors=${errors ? 1 : 0}`).then(setData).catch((e) => setError(e.message));
  }, [name, errors, offset]);
  if (error) return <Alert>{error}</Alert>;

  return (
    <Card title={`Événements${data ? ` (${data.total})` : ''}`} actions={<>
      <select value={name} onChange={(e) => { setName(e.target.value); setOffset(0); }}>
        <option value="">Tous</option><option value="app_open">Ouverture de l'app</option><option value="tool_run">Traitements</option>
        <option value="ai_task">Tâches IA</option><option value="scan">Numérisations</option>
      </select>
      <Toggle checked={errors} onChange={(v) => { setErrors(v); setOffset(0); }} label="Erreurs seulement" />
    </>}>
      <p className="muted small">Données anonymes envoyées par les appareils qui l'ont accepté. Le contenu des documents n'est jamais transmis.</p>
      {!data ? <div className="muted">Chargement…</div> : data.events.length === 0 ? <Empty>Aucun événement.</Empty> : (
        <div className="table-wrap"><table className="table small">
          <thead><tr><th>Date</th><th>Événement</th><th>Outil</th><th>Résultat</th><th>Version</th><th>Appareil</th><th>Détails</th></tr></thead>
          <tbody>{data.events.map((e) => (
            <tr key={e.id}>
              <td>{fmtDate(e.ts)}</td><td>{e.name}</td><td>{e.tool ? TOOL_LABELS[e.tool] ?? e.tool : ''}</td>
              <td>{e.ok === 0 ? <Badge tone="red">erreur</Badge> : e.ok === 1 ? <Badge tone="teal">ok</Badge> : ''}</td>
              <td>{e.app_version}</td><td><code>{(e.device_id || '').slice(0, 8)}</code>{e.user_id ? ' 👤' : ''}</td>
              <td><code className="small">{e.props && e.props !== '{}' ? e.props.slice(0, 90) : ''}</code></td>
            </tr>))}
          </tbody>
        </table></div>
      )}
      {data && data.total > 100 && <div className="row gap pager">
        <button className="btn small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>← Plus récents</button>
        <button className="btn small" disabled={offset + 100 >= data.total} onClick={() => setOffset(offset + 100)}>Plus anciens →</button>
      </div>}
    </Card>
  );
}
