import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api';
import { Alert, Badge, Card, Empty, useFlash } from '../ui';

interface Reply { id: number; ts: number; admin_email: string; message: string }
interface Item { id: number; ts: number; kind: string; message: string; email: string; user_id: string | null; user_email: string | null; status: string; replies: Reply[] }
interface Template { title: string; body: string }
interface Reset { id: string; email: string; reset_expires: number }
const KIND: Record<string, string> = { bug: 'Problème', suggestion: 'Suggestion', contact: 'Contact' };

export default function Feedback() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [resets, setResets] = useState<Reset[]>([]);
  const [filter, setFilter] = useState('nouveau');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, show] = useFlash();
  const load = () => {
    api<{ feedback: Item[]; templates: Template[] }>('GET', '/api/admin/feedback').then((r) => { setItems(r.feedback); setTemplates(r.templates); }).catch((e) => setError(e.message));
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
            {i.replies.map((r) => <div key={r.id} style={{ margin: '6px 0 6px 18px', padding: '8px 12px', borderLeft: '3px solid var(--indigo)', background: 'rgba(91,75,219,.05)', borderRadius: 6 }}>
              <div className="muted small">Réponse de {r.admin_email} · {fmtDate(r.ts)}</div><div style={{ whiteSpace: 'pre-wrap' }}>{r.message}</div></div>)}
            <ReplyBox item={i} templates={templates} onSent={(to) => { show(`Réponse envoyée à ${to}`); load(); }} onError={(m) => show(m, 'error')} />
          </article>
        ))}
      </Card>
      <Card title="Réponses toutes prêtes" actions={<button className="btn small" onClick={() => setEditing(!editing)}>{editing ? 'Fermer' : 'Modifier'}</button>}>
        {!editing ? <p className="muted">{templates.map((t) => t.title).join(' · ') || 'Aucune.'}</p>
          : <TemplatesEditor templates={templates} onSaved={(t) => { setTemplates(t); setEditing(false); show('Réponses enregistrées'); }} onError={(m) => show(m, 'error')} />}
      </Card>
    </div>
  );
}

/** Réponse à un message : envoyée par e-mail ; la personne peut répondre directement (vers contact@pagio.site). */
function ReplyBox({ item, templates, onSent, onError }: { item: Item; templates: Template[]; onSent: (to: string) => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const to = item.email || item.user_email;
  if (!to) return <p className="muted small">Pas d'adresse e-mail : impossible de répondre.</p>;
  if (!open) return <button className="btn small" onClick={() => setOpen(true)}>Répondre à {to}</button>;
  return (
    <div className="stack" style={{ marginTop: 8 }}>
      <div className="row gap wrap">{templates.map((t) => <button key={t.title} className="chip" onClick={() => setText(t.body)}>{t.title}</button>)}</div>
      <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Votre réponse à ${to}…`} />
      <div className="row gap wrap">
        <button className="btn primary" disabled={busy || text.trim().length < 2} onClick={async () => {
          setBusy(true);
          try { const r = await api<{ to: string }>('POST', `/api/admin/feedback/${item.id}/reply`, { message: text }); setText(''); setOpen(false); onSent(r.to); }
          catch (e) { onError((e as Error).message); }
          setBusy(false);
        }}>{busy ? 'Envoi…' : 'Envoyer la réponse (statut « traité »)'}</button>
        <button className="btn ghost" onClick={() => setOpen(false)}>Annuler</button>
      </div>
    </div>
  );
}

function TemplatesEditor({ templates, onSaved, onError }: { templates: Template[]; onSaved: (t: Template[]) => void; onError: (m: string) => void }) {
  const [list, setList] = useState(templates);
  const upd = (i: number, k: keyof Template, v: string) => setList(list.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  return (
    <div className="stack">
      {list.map((t, i) => (
        <div key={i} className="stack" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
          <div className="row gap"><input value={t.title} onChange={(e) => upd(i, 'title', e.target.value)} placeholder="Titre" style={{ flex: 1 }} /><button className="btn small danger" onClick={() => setList(list.filter((_, j) => j !== i))}>Supprimer</button></div>
          <textarea rows={3} value={t.body} onChange={(e) => upd(i, 'body', e.target.value)} />
        </div>))}
      <div className="row gap">
        <button className="btn" onClick={() => setList([...list, { title: '', body: '' }])}>+ Ajouter</button>
        <button className="btn primary" onClick={async () => { try { const r = await api<{ templates: Template[] }>('PUT', '/api/admin/support/templates', { templates: list }); onSaved(r.templates); } catch (e) { onError((e as Error).message); } }}>Enregistrer</button>
      </div>
    </div>
  );
}
