import { Fragment, useEffect, useState } from 'react';
import { Admin, api, fmtDate, fmtNum } from '../api';
import { Alert, Badge, Card, Empty, Kpi, useFlash } from '../ui';

interface Row { id: number; ts: number; source: string; message: string; stack: string | null; method: string | null; path: string | null; status: number | null }
interface Data { total: number; last_24h: number; by_source: { source: string; n: number; last_ts: number }[]; errors: Row[] }

const SOURCE: Record<string, string> = { serveur: 'Serveur', conversion: 'Conversion', ia: 'Fournisseur IA', sauvegarde: 'Sauvegarde', admin: 'Administration' };
const PAGE = 100;

export default function Errors({ admin }: { admin: Admin }) {
  const [data, setData] = useState<Data | null>(null);
  const [source, setSource] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, show] = useFlash();
  const load = () => api<Data>('GET', `/api/admin/errors?limit=${PAGE}&offset=${offset}${source ? `&source=${source}` : ''}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [source, offset]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <div className="muted">Chargement…</div>;

  return (
    <div className="stack">
      {flash}
      <div className="kpis">
        <Kpi label="Dernières 24 heures" value={fmtNum(data.last_24h)} tone={data.last_24h >= 20 ? 'red' : data.last_24h > 0 ? 'amber' : 'teal'} hint={data.last_24h === 0 ? 'aucune erreur' : 'à examiner'} />
        {data.by_source.map((s) => <Kpi key={s.source} label={SOURCE[s.source] ?? s.source} value={fmtNum(s.n)} hint={`dernière : ${fmtDate(s.last_ts)}`} />)}
      </div>
      <Card title={`Erreurs du serveur (${fmtNum(data.total)})`} actions={<>
        <select value={source} onChange={(e) => { setSource(e.target.value); setOffset(0); }}>
          <option value="">Toutes les origines</option>
          {Object.entries(SOURCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn small" onClick={load}>Actualiser</button>
        {admin.role === 'owner' && <button className="btn small danger" disabled={data.total === 0} onClick={async () => {
          if (!confirm('Vider tout le journal des erreurs ?')) return;
          try { const r = await api<{ deleted: number }>('DELETE', '/api/admin/errors'); show(`${r.deleted} erreur(s) supprimée(s)`); setOffset(0); load(); } catch (e) { show((e as Error).message, 'error'); }
        }}>Vider le journal</button>}
      </>}>
        <p className="muted small">Pannes survenues sur le serveur lui-même : erreurs internes, conversions LibreOffice en échec, refus du fournisseur d'IA,
          sauvegardes ratées. Les erreurs des outils sur les téléphones sont dans « Événements ».</p>
        {data.errors.length === 0 ? <Empty>Aucune erreur enregistrée. 🎉</Empty> : (
          <div className="table-wrap"><table className="table clickable">
            <thead><tr><th>Date</th><th>Origine</th><th>Message</th><th>Requête</th></tr></thead>
            <tbody>{data.errors.map((e) => (
              <Fragment key={e.id}>
                <tr onClick={() => setOpen(open === e.id ? null : e.id)}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.ts)}</td>
                  <td><Badge tone={e.source === 'serveur' ? 'red' : 'coral'}>{SOURCE[e.source] ?? e.source}</Badge></td>
                  <td>{e.message.length > 160 ? `${e.message.slice(0, 160)}…` : e.message}</td>
                  <td className="muted small">{e.method ? `${e.method} ${e.path ?? ''}` : '—'}{e.status ? ` → ${e.status}` : ''}</td>
                </tr>
                {open === e.id && <tr><td colSpan={4}><pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, margin: 0 }}>{e.message}{e.stack ? `\n\n${e.stack}` : ''}</pre></td></tr>}
              </Fragment>))}
            </tbody>
          </table></div>
        )}
        {data.total > PAGE && (
          <div className="row gap pager">
            <button className="btn small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>← Plus récentes</button>
            <span className="muted">{offset + 1}–{Math.min(offset + PAGE, data.total)} sur {data.total}</span>
            <button className="btn small" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Plus anciennes →</button>
          </div>
        )}
      </Card>
    </div>
  );
}
