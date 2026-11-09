// Client de l'API d'administration du serveur Pagio.

export type Role = 'owner' | 'admin' | 'support';
export interface Admin { id: number; email: string; name: string; role: Role }
export interface User {
  id: string; email: string; name: string; plan: 'free' | 'premium'; premium_until: string | null; ai_credits: number;
  tasks_today: number; banned: boolean; created_at: number; last_seen: number | null; total_tasks: number; note: string;
}
export interface Tool { id: string; enabled: boolean; premium: boolean; max_files: number; max_mb: number; runs_30d: number }
export interface PlanLimits { daily_tasks: number; max_files: number; max_mb: number; ai_credits: number }
export interface Settings {
  maintenance: boolean; maintenance_message: string; announcement: string; announcement_level: string;
  min_version_code: number; latest_version_name: string; update_url: string; support_email: string;
  conversion_enabled: boolean; registration_open: boolean;
  plans: { free: PlanLimits; premium: PlanLimits };
  ai: { enabled: boolean; provider: 'openai' | 'anthropic' | 'gemini'; base_url: string; model: string; api_key: string; has_key?: boolean; cost_per_request: number; max_tokens: number };
}
export interface Stats {
  days: number;
  users: { total: number; premium: number; banned: number; new_period: number; active_7d: number };
  devices_period: number; tasks_period: number; errors_period: number; ai_requests_period: number; ai_credits_period: number;
  conversions_period: number; feedback_open: number;
  by_tool: { tool: string; runs: number; errors: number }[];
  daily: { day: string; events: number; devices: number; tasks: number }[];
  signups: { day: string; n: number }[];
  versions: { app_version: string; devices: number }[];
  top_errors: { tool: string; error: string | null; n: number }[];
}

const KEY_URL = 'pagio.admin.server';
const KEY_TOKEN = 'pagio.admin.token';

/** Adresse du serveur : celle qui sert le tableau de bord, sinon celle enregistrée, sinon localhost. */
export function defaultServer(): string {
  const saved = localStorage.getItem(KEY_URL);
  if (saved) return saved;
  // Servi par le serveur Pagio lui-même : l'API est à la même adresse.
  if (location.protocol.startsWith('http')) return location.origin;
  return 'http://localhost:8787';
}

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export const session = {
  get server() { return defaultServer(); },
  set server(v: string) { localStorage.setItem(KEY_URL, v.replace(/\/$/, '')); },
  get token() { return sessionStorage.getItem(KEY_TOKEN); },
  set token(v: string | null) { if (v) sessionStorage.setItem(KEY_TOKEN, v); else sessionStorage.removeItem(KEY_TOKEN); },
};

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (f: () => void) => { onUnauthorized = f; };

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(session.server + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, `Serveur injoignable (${session.server}). Vérifiez qu'il est démarré et que l'adresse est correcte.`);
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/api/admin/login') { session.token = null; onUnauthorized(); }
  if (!r.ok) throw new ApiError(r.status, data.error || `Erreur ${r.status}`);
  return data as T;
}

export async function download(path: string, filename: string) {
  const r = await fetch(session.server + path, { headers: { Authorization: `Bearer ${session.token}` } });
  if (!r.ok) throw new ApiError(r.status, 'Téléchargement impossible');
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export const fmtDate = (ms: number | null | undefined) => ms ? new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
export const fmtNum = (n: number) => n.toLocaleString('fr-FR');

export const TOOL_LABELS: Record<string, string> = {
  merge: 'Fusionner', split: 'Diviser', organize: 'Organiser les pages', extract_pages: 'Extraire des pages', delete_pages: 'Supprimer des pages',
  rotate: 'Faire pivoter', compress: 'Compresser', repair: 'Réparer', ocr: 'OCR (PDF consultable)', extract_text: 'Extraire le texte',
  scan: 'Scanner', images_to_pdf: 'Images en PDF', office_to_pdf: 'Office en PDF', html_to_pdf: 'HTML en PDF', txt_to_pdf: 'Texte en PDF',
  create_pdf: 'Créer un PDF', pdf_to_word: 'PDF en Word', pdf_to_excel: 'PDF en Excel', pdf_to_ppt: 'PDF en PowerPoint',
  pdf_to_images: 'PDF en images', extract_images: 'Extraire les images', edit: 'Modifier PDF', sign: 'Signer', fill_forms: 'Remplir un formulaire',
  page_numbers: 'Numéros de page', watermark: 'Filigrane', header_footer: 'En-tête / pied', replace_text: 'Remplacer du texte', redact: 'Biffer',
  protect: 'Protéger', unlock: 'Déverrouiller', metadata: 'Propriétés', strip_metadata: 'Nettoyer métadonnées', digital_sign: 'Signature numérique',
  verify_sign: 'Vérifier signatures', assistant: 'Assistant IA', translate: 'Traduire', invoice: 'Lire une facture', tables: 'Extraire tableaux',
  classify: 'Reconnaître un document',
};
