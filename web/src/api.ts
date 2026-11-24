// Échanges avec le serveur Pagio (même origine : /api est relayé par Nginx) et session de l'utilisateur.
const KEY = 'pagio.web.token';
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* indisponible */ } } };

export interface User { id: string; email: string; name: string; plan: 'free' | 'premium'; premium_until: string | null; ai_credits: number; email_verified: boolean }
export interface ToolFlag { enabled: boolean; premium: boolean; daily_free: number }
export interface Config { tools: Record<string, ToolFlag>; registration_open: boolean; google_client_id: string; ai_enabled: boolean; server_conversion: boolean; maintenance: boolean; maintenance_message: string }

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export const session = {
  get token() { return store.get(KEY); },
  set token(v: string | null) { store.set(KEY, v); },
};

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...(session.token ? { authorization: `Bearer ${session.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && session.token && path.startsWith('/api/me')) session.token = null;
    throw new ApiError(r.status, j.error || `Erreur ${r.status}`);
  }
  return j as T;
}

export const getConfig = () => api<Config>('GET', '/api/app/config');
export const me = () => api<{ user: User }>('GET', '/api/me').then((r) => r.user);

/** Limite quotidienne gratuite par outil, comptée dans ce navigateur (comme l'application Android sur le téléphone). */
const day = () => new Date().toISOString().slice(0, 10);
export function usesToday(tool: string): number {
  try { const o = JSON.parse(store.get('pagio.web.uses') || '{}'); return o.day === day() ? (o.counts?.[tool] ?? 0) : 0; } catch { return 0; }
}
export function recordUse(tool: string) {
  let o: { day?: string; counts?: Record<string, number> } = {};
  try { o = JSON.parse(store.get('pagio.web.uses') || '{}'); } catch { /* vide */ }
  if (o.day !== day()) o = { day: day(), counts: {} };
  o.counts![tool] = (o.counts![tool] ?? 0) + 1;
  store.set('pagio.web.uses', JSON.stringify(o));
}
// Pas de statistiques d'usage sur le web : la politique de confidentialité ne les prévoit qu'avec un accord explicite.

// Statistiques d'usage du site (sans cookies, voir pagio.site/confidentialite) : pages vues et utilisations des outils.
const ctx = () => ({ lang: navigator.language || '', tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '', w: screen.width || 0 });
export function siteHit(path: string) {
  fetch('/api/site/hit', { method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true,
    body: JSON.stringify({ path, ref: document.referrer || '', utm: new URLSearchParams(location.search).get('utm_source') || '', ...ctx() }) }).catch(() => {});
}
export function siteEvent(name: string, props: Record<string, unknown> = {}) {
  fetch('/api/site/event', { method: 'POST', keepalive: true,
    headers: { 'content-type': 'application/json', ...(session.token ? { authorization: `Bearer ${session.token}` } : {}) },
    body: JSON.stringify({ name, ...props, ...ctx() }) }).catch(() => {});
}
