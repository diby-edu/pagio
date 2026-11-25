import { useEffect, useRef, useState } from 'react';
import { api, fmtDate, fmtMoney } from './api';

interface Results {
  users: { id: string; email: string; name: string; plan: string; premium_until: string | null }[];
  payments: { id: number; ts: number; user_email: string | null; amount: number; method: string; reference: string | null }[];
  feedback: { id: number; ts: number; email: string; message: string; status: string }[];
  promo: { code: string; kind: string; value: number; uses: number }[];
}

/** Recherche dans tout le tableau de bord : utilisateurs, paiements, messages, codes promo. */
export default function GlobalSearch({ go }: { go: (page: string) => void }) {
  const [q, setQ] = useState('');
  const [r, setR] = useState<Results | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setR(null); return; }
    const t = setTimeout(() => api<Results>('GET', `/api/admin/search?q=${encodeURIComponent(q.trim())}`).then(setR).catch(() => setR(null)), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setR(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const open = (page: string, search?: string) => { if (search) sessionStorage.setItem('pagio-admin-users-q', search); setQ(''); setR(null); go(page); };
  const empty = r && !r.users.length && !r.payments.length && !r.feedback.length && !r.promo.length;
  return (
    <div className="global-search" ref={box}>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (e-mail, référence, message, code…)" aria-label="Recherche globale" />
      {r && <div className="global-results">
        {empty && <div className="muted small" style={{ padding: 10 }}>Aucun résultat.</div>}
        {r.users.length > 0 && <><b>Utilisateurs</b>{r.users.map((u) => <button key={u.id} onClick={() => open('users', u.email)}>{u.email}{u.name ? ` — ${u.name}` : ''} <span className="muted">{u.plan === 'premium' ? `Premium${u.premium_until ? ` → ${u.premium_until}` : ''}` : 'gratuit'}</span></button>)}</>}
        {r.payments.length > 0 && <><b>Paiements</b>{r.payments.map((p) => <button key={p.id} onClick={() => open('sales')}>{fmtDate(p.ts)} · {p.user_email ?? '—'} · {fmtMoney(p.amount)} {p.reference ? `· ${p.reference}` : ''}</button>)}</>}
        {r.feedback.length > 0 && <><b>Messages</b>{r.feedback.map((f) => <button key={f.id} onClick={() => open('feedback')}>{fmtDate(f.ts)} · {f.email || '—'} : {f.message}</button>)}</>}
        {r.promo.length > 0 && <><b>Codes promo</b>{r.promo.map((c) => <button key={c.code} onClick={() => open('promo')}>{c.code} · {c.uses} utilisation(s)</button>)}</>}
      </div>}
    </div>
  );
}
