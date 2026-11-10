import { useCallback, useEffect, useState } from 'react';
import { Admin, TOOL_LABELS, User, api, download, fmtBytes, fmtDate, fmtNum } from '../api';
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
  // Sélection pour les actions groupées (conservée d'une page de résultats à l'autre).
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const toggle = (id: string, on: boolean) => setChecked((c) => { const n = new Set(c); if (on) n.add(id); else n.delete(id); return n; });
  const bulk = async (action: string, extra: Record<string, unknown>, done: string) => {
    try {
      const r = await api<{ updated: number }>('POST', '/api/admin/users/bulk', { ids: [...checked], action, ...extra });
      show(`${done} : ${r.updated} compte(s)`); setChecked(new Set()); load();
    } catch (e) { show((e as Error).message, 'error'); }
  };

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
        {canEdit && checked.size > 0 && (
          <div className="row gap wrap" style={{ margin: '12px 0', padding: 10, borderRadius: 10, background: 'var(--soft)' }}>
            <strong>{checked.size} sélectionné(s)</strong>
            <button className="btn small" onClick={() => {
              const d = prompt("Passer ces comptes en Premium jusqu'au (AAAA-MM-JJ) ? Laissez vide pour un Premium sans date de fin.", '');
              if (d === null) return;
              if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d.trim())) { show('Date invalide : utilisez le format AAAA-MM-JJ', 'error'); return; }
              bulk('premium', { premium_until: d.trim() || null }, 'Passage en Premium');
            }}>Passer en Premium…</button>
            <button className="btn small" onClick={() => { if (confirm(`Repasser ${checked.size} compte(s) à l'offre gratuite ?`)) bulk('free', {}, 'Retour au gratuit'); }}>Repasser en gratuit</button>
            <button className="btn small" onClick={() => {
              const n = Number(prompt('Combien de crédits IA ajouter à chacun ? (nombre négatif pour en retirer)', '100'));
              if (n) bulk('add_credits', { credits: n }, 'Crédits ajoutés');
            }}>Ajouter des crédits…</button>
            <button className="btn small" onClick={() => { if (confirm(`Suspendre ${checked.size} compte(s) ?`)) bulk('ban', {}, 'Comptes suspendus'); }}>Suspendre</button>
            <button className="btn small" onClick={() => bulk('unban', {}, 'Comptes réactivés')}>Réactiver</button>
            <button className="btn small danger" onClick={() => { if (confirm(`Supprimer définitivement ${checked.size} compte(s) ? Cette action est irréversible.`)) bulk('delete', {}, 'Comptes supprimés'); }}>Supprimer</button>
            <button className="btn small ghost" onClick={() => setChecked(new Set())}>Tout désélectionner</button>
          </div>
        )}
        {error && <Alert>{error}</Alert>}
        {data && data.users.length === 0 && <Empty>Aucun utilisateur trouvé.</Empty>}
        {data && data.users.length > 0 && (
          <div className="table-wrap"><table className="table clickable">
            <thead><tr>{canEdit && <th style={{ width: 28 }}><input type="checkbox" aria-label="Tout sélectionner sur cette page"
              checked={data.users.every((u) => checked.has(u.id))}
              onChange={(e) => setChecked((c) => { const n = new Set(c); data.users.forEach((u) => (e.target.checked ? n.add(u.id) : n.delete(u.id))); return n; })} /></th>}<th>Utilisateur</th><th>Offre</th><th>Crédits IA</th><th>Tâches</th><th>Inscrit le</th><th>Vu le</th><th /></tr></thead>
            <tbody>{data.users.map((u) => (
              <tr key={u.id} onClick={() => setSelected(u)}>
                {canEdit && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Sélectionner ${u.email}`} checked={checked.has(u.id)} onChange={(e) => toggle(u.id, e.target.checked)} /></td>}
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

interface Detail {
  reset_pending: boolean;
  plan_history: { ts: number; actor: string | null; old_plan: string; new_plan: string; premium_until: string | null; reason: string | null }[];
  events: { ts: number; name: string; tool: string | null; ok: number | null; app_version: string }[];
  top_tools: { tool: string; runs: number; errors: number }[];
  ai_30d: { requests: number; credits: number };
  conversions: { ts: number; source_ext: string; target: string; bytes: number; ms: number; ok: number; error: string | null }[];
  feedback: { id: number; ts: number; kind: string; message: string; status: string }[];
  devices: { device_id: string; app_version: string; last_ts: number }[];
}

function UserPanel({ user, canEdit, onClose, onChanged, onError }: {
  user: User; canEdit: boolean; onClose: () => void; onChanged: (u: User | null, msg: string) => void; onError: (m: string) => void;
}) {
  const [plan, setPlan] = useState(user.plan);
  const [until, setUntil] = useState(user.premium_until ?? '');
  const [credits, setCredits] = useState(String(user.ai_credits));
  const [note, setNote] = useState(user.note);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [activity, setActivity] = useState<Detail | null>(null);
  // Rechargée après chaque modification (l'historique des offres change).
  useEffect(() => { api<Detail>('GET', `/api/admin/users/${user.id}`).then(setActivity).catch(() => {}); }, [user.id, user.plan, user.premium_until, user.ai_credits, user.banned]);

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
          <button className="btn primary" disabled={!canEdit} onClick={() => { patch({ plan, premium_until: plan === 'premium' ? until || null : null, reason: reason.trim() || undefined }, 'Offre mise à jour'); setReason(''); }}>Appliquer</button>
        </div>
        {canEdit && <input style={{ marginTop: 8, width: '100%' }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motif (facultatif) : offert, paiement reçu, geste commercial…" maxLength={200} />}
        {activity && activity.plan_history.length > 0 && (
          <table className="table small" style={{ marginTop: 8 }}><tbody>{activity.plan_history.map((h, i) => (
            <tr key={i}><td style={{ whiteSpace: 'nowrap' }}>{fmtDate(h.ts)}</td>
              <td>{h.old_plan === h.new_plan ? 'Échéance modifiée' : h.new_plan === 'premium' ? 'Passage en Premium' : 'Retour au gratuit'}{h.premium_until ? ` → ${h.premium_until}` : ''}
                {h.reason && <><br /><span className="muted small">{h.reason}</span></>}</td>
              <td className="muted small">{h.actor ?? 'automatique'}</td></tr>))}
          </tbody></table>
        )}
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
        {activity && <>
          <h4>Usage</h4>
          <div className="kv">
            <span>Requêtes IA (30 jours)</span><b>{fmtNum(activity.ai_30d.requests)} · {fmtNum(activity.ai_30d.credits)} crédit(s)</b>
            <span>Conversions en ligne</span><b>{activity.conversions.length}{activity.conversions.some((c) => !c.ok) ? ` dont ${activity.conversions.filter((c) => !c.ok).length} en échec` : ''}</b>
            <span>Appareils</span><b>{activity.devices.length === 0 ? '—' : activity.devices.map((d) => `v${d.app_version || '?'}`).join(', ')}</b>
            <span>Outils préférés</span><b>{activity.top_tools.length === 0 ? '—' : activity.top_tools.slice(0, 4).map((t) => `${TOOL_LABELS[t.tool] ?? t.tool} (${t.runs})`).join(', ')}</b>
            {activity.reset_pending && <><span>Mot de passe</span><b>réinitialisation demandée</b></>}
          </div>
          {activity.conversions.length > 0 && <>
            <h4>Dernières conversions</h4>
            <table className="table small"><tbody>{activity.conversions.slice(0, 8).map((c, i) => (
              <tr key={i}><td>{fmtDate(c.ts)}</td><td>{c.source_ext || '?'} → {c.target}</td><td>{fmtBytes(c.bytes)}</td><td>{c.ok ? <Badge tone="teal">ok</Badge> : <span title={c.error ?? ''}><Badge tone="red">échec</Badge></span>}</td></tr>))}
            </tbody></table>
          </>}
          {activity.feedback.length > 0 && <>
            <h4>Messages au support</h4>
            <table className="table small"><tbody>{activity.feedback.map((f) => (
              <tr key={f.id}><td style={{ whiteSpace: 'nowrap' }}>{fmtDate(f.ts)}</td><td>{f.message.slice(0, 140)}</td><td><Badge>{f.status}</Badge></td></tr>))}
            </tbody></table>
          </>}
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
