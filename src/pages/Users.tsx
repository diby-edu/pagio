import { useCallback, useEffect, useState } from 'react';
import { Admin, User, api, download, fmtDate, fmtNum } from '../api';
import { Alert, Badge, Card, Empty, Field, Toggle, useFlash } from '../ui';

const PAGE = 50;

export default function Users({ admin }: { admin: Admin }) {
  const [q, setQ] = useState('');
  const [plan, setPlan] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ total: number; users: User[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [flash, show] = useFlash();
  const canEdit = admin.role !== 'support';

  const load = useCallback(() => {
    api<{ total: number; users: User[] }>('GET', `/api/admin/users?q=${encodeURIComponent(q)}&plan=${plan}&limit=${PAGE}&offset=${offset}`)
      .then((r) => { setData(r); setError(null); }).catch((e) => setError(e.message));
  }, [q, plan, offset]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  return (
    <div className="stack">
      {flash}
      <Card title={`Utilisateurs${data ? ` (${fmtNum(data.total)})` : ''}`} actions={<>
        {canEdit && <button className="btn" onClick={() => download('/api/admin/export/users.csv', 'utilisateurs-pagio.csv').catch((e) => show(e.message, 'error'))}>Exporter CSV</button>}
        {canEdit && <button className="btn primary" onClick={() => setCreating(true)}>+ Nouvel utilisateur</button>}
      </>}>
        <div className="row gap wrap">
          <input className="grow" placeholder="Rechercher par e-mail ou nom…" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
          <select value={plan} onChange={(e) => { setPlan(e.target.value); setOffset(0); }}>
            <option value="">Toutes les offres</option><option value="free">Gratuit</option><option value="premium">Premium</option>
          </select>
        </div>
        {error && <Alert>{error}</Alert>}
        {data && data.users.length === 0 && <Empty>Aucun utilisateur trouvé.</Empty>}
        {data && data.users.length > 0 && (
          <div className="table-wrap"><table className="table clickable">
            <thead><tr><th>Utilisateur</th><th>Offre</th><th>Crédits IA</th><th>Tâches</th><th>Inscrit le</th><th>Vu le</th><th /></tr></thead>
            <tbody>{data.users.map((u) => (
              <tr key={u.id} onClick={() => setSelected(u)}>
                <td><strong>{u.name || '—'}</strong><br /><span className="muted small">{u.email}</span></td>
                <td>{u.plan === 'premium' ? <Badge tone="coral">Premium{u.premium_until ? ` → ${u.premium_until}` : ''}</Badge> : <Badge>Gratuit</Badge>}</td>
                <td>{fmtNum(u.ai_credits)}</td>
                <td>{u.total_tasks}</td>
                <td>{fmtDate(u.created_at)}</td>
                <td>{fmtDate(u.last_seen)}</td>
                <td>{u.banned && <Badge tone="red">Suspendu</Badge>}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
        {data && data.total > PAGE && (
          <div className="row gap pager">
            <button className="btn small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>← Précédents</button>
            <span className="muted">{offset + 1}–{Math.min(offset + PAGE, data.total)} sur {data.total}</span>
            <button className="btn small" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Suivants →</button>
          </div>
        )}
      </Card>
      {selected && <UserPanel user={selected} canEdit={canEdit} onClose={() => setSelected(null)} onChanged={(u, msg) => { show(msg); if (u) setSelected(u); else setSelected(null); load(); }} onError={(m) => show(m, 'error')} />}
      {creating && <CreateUser onClose={() => setCreating(false)} onCreated={() => { setCreating(false); show('Utilisateur créé'); load(); }} />}
    </div>
  );
}

function UserPanel({ user, canEdit, onClose, onChanged, onError }: {
  user: User; canEdit: boolean; onClose: () => void; onChanged: (u: User | null, msg: string) => void; onError: (m: string) => void;
}) {
  const [plan, setPlan] = useState(user.plan);
  const [until, setUntil] = useState(user.premium_until ?? '');
  const [credits, setCredits] = useState(String(user.ai_credits));
  const [note, setNote] = useState(user.note);
  const [password, setPassword] = useState('');
  const [activity, setActivity] = useState<{ events: { ts: number; name: string; tool: string | null; ok: number | null; app_version: string }[] } | null>(null);
  useEffect(() => { api<typeof activity>('GET', `/api/admin/users/${user.id}/activity`).then(setActivity).catch(() => {}); }, [user.id]);

  const patch = async (body: Record<string, unknown>, msg: string) => {
    try { const r = await api<{ user: User }>('PATCH', `/api/admin/users/${user.id}`, body); onChanged(r.user, msg); }
    catch (e) { onError((e as Error).message); }
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="card-head"><h3>{user.name || user.email}</h3><button className="btn ghost" onClick={onClose}>✕</button></header>
        <p className="muted">{user.email}<br />ID : <code>{user.id}</code></p>
        <div className="kv"><span>Inscrit le</span><b>{fmtDate(user.created_at)}</b><span>Dernière activité</span><b>{fmtDate(user.last_seen)}</b>
          <span>Tâches aujourd'hui</span><b>{user.tasks_today}</b><span>Tâches au total</span><b>{user.total_tasks}</b></div>
        <h4>Offre</h4>
        <div className="row gap wrap">
          <select value={plan} disabled={!canEdit} onChange={(e) => setPlan(e.target.value as User['plan'])}><option value="free">Gratuit</option><option value="premium">Premium</option></select>
          {plan === 'premium' && <input type="date" value={until} disabled={!canEdit} onChange={(e) => setUntil(e.target.value)} title="Fin du Premium (vide = sans limite)" />}
          <button className="btn primary" disabled={!canEdit} onClick={() => patch({ plan, premium_until: until || null }, 'Offre mise à jour')}>Appliquer</button>
        </div>
        <h4>Crédits IA</h4>
        <div className="row gap wrap">
          <input type="number" min={0} value={credits} disabled={!canEdit} onChange={(e) => setCredits(e.target.value)} style={{ width: 110 }} />
          <button className="btn" disabled={!canEdit} onClick={() => patch({ ai_credits: Number(credits) }, 'Crédits définis')}>Définir</button>
          <button className="btn" disabled={!canEdit} onClick={() => patch({ add_credits: 100 }, '+100 crédits')}>+100</button>
          <button className="btn" disabled={!canEdit} onClick={() => patch({ add_credits: 1000 }, '+1000 crédits')}>+1000</button>
        </div>
        <h4>Note interne</h4>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible uniquement par l'équipe" />
        <button className="btn small" onClick={() => patch({ note }, 'Note enregistrée')}>Enregistrer la note</button>
        {canEdit && <>
          <h4>Sécurité</h4>
          <div className="row gap wrap">
            <input type="text" placeholder="Nouveau mot de passe (8+)" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="btn" disabled={password.length < 8} onClick={() => { patch({ password }, 'Mot de passe réinitialisé'); setPassword(''); }}>Réinitialiser</button>
          </div>
          <div className="row gap wrap" style={{ marginTop: 12 }}>
            <Toggle checked={user.banned} onChange={(v) => patch({ banned: v }, v ? 'Compte suspendu' : 'Compte réactivé')} label="Compte suspendu" />
            <button className="btn danger" onClick={async () => {
              if (!confirm(`Supprimer définitivement ${user.email} ?`)) return;
              try { await api('DELETE', `/api/admin/users/${user.id}`); onChanged(null, 'Utilisateur supprimé'); } catch (e) { onError((e as Error).message); }
            }}>Supprimer le compte</button>
          </div>
        </>}
        <h4>Activité récente</h4>
        {!activity ? <div className="muted">Chargement…</div> : activity.events.length === 0 ? <Empty>Aucune activité enregistrée.</Empty> :
          <table className="table small"><tbody>{activity.events.slice(0, 30).map((e, i) => (
            <tr key={i}><td>{fmtDate(e.ts)}</td><td>{e.name}</td><td>{e.tool ?? ''}</td><td>{e.ok === 0 ? <Badge tone="red">erreur</Badge> : e.ok === 1 ? <Badge tone="teal">ok</Badge> : ''}</td></tr>))}
          </tbody></table>}
      </aside>
    </div>
  );
}

function CreateUser({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [password, setPassword] = useState('');
  const [plan, setPlan] = useState('free'); const [error, setError] = useState<string | null>(null);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="card-head"><h3>Nouvel utilisateur</h3><button className="btn ghost" onClick={onClose}>✕</button></header>
        <Field label="E-mail"><input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Nom"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Mot de passe" hint="8 caractères minimum, à communiquer à l'utilisateur."><input value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Field label="Offre"><select value={plan} onChange={(e) => setPlan(e.target.value)}><option value="free">Gratuit</option><option value="premium">Premium</option></select></Field>
        {error && <Alert>{error}</Alert>}
        <button className="btn primary wide" onClick={async () => {
          try { await api('POST', '/api/admin/users', { email, name, password, plan }); onCreated(); } catch (e) { setError((e as Error).message); }
        }}>Créer</button>
      </aside>
    </div>
  );
}
