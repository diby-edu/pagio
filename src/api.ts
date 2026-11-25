// Client de l'API d'administration du serveur Pagio.

export type Role = 'owner' | 'admin' | 'support';
export interface Admin { id: number; email: string; name: string; role: Role; totp_enabled?: boolean; recovery_left?: number }
export interface Limits { convert_require_account: boolean; convert_anon_per_hour: number; convert_user_per_hour: number; convert_max_mb: number; register_per_hour: number }
export interface BackupSettings { enabled: boolean; hour: number; keep_days: number }
export interface MailSettings { enabled: boolean; api_key: string; has_key?: boolean; key_from_env?: boolean; key_error?: boolean; from_email: string; from_name: string; public_url: string; verify_signup: boolean; alerts_enabled: boolean; alerts_to: string; weekly_report?: boolean }
export interface Backup { name: string; kind: string; day: string; bytes: number; created_at: number }
export interface AdminSession { id: string; admin_id: number; email: string; name: string; created_at: number; last_seen: number; expires_at: number; ip: string; user_agent: string; current: boolean }
export interface User {
  id: string; email: string; name: string; plan: 'free' | 'premium'; premium_until: string | null; ai_credits: number;
  tasks_today: number; banned: boolean; created_at: number; last_seen: number | null; total_tasks: number; note: string; email_verified?: boolean;
}
export interface Tool { id: string; enabled: boolean; premium: boolean; max_files: number; max_mb: number; daily_free: number; max_pages: number; pdf_premium: boolean; runs_30d: number; limit_hits_30d: number }
export interface PlanLimits { daily_tasks: number; max_files: number; max_mb: number; ai_credits: number }
/** Tarifs en francs CFA, majoration Google Play et paramètres du coût de l'IA. */
export interface Sales {
  price_week: number; price_month: number; price_year: number; ai_pack_credits: number; ai_pack_price: number;
  play_markup_pct: number; usd_xof: number; ai_usd_per_m_in: number; ai_usd_per_m_out: number;
}
export interface Payment {
  id: number; ts: number; user_id: string | null; user_email: string | null; kind: 'premium' | 'ai_pack'; offer: string | null;
  amount: number; currency: string; method: string; reference: string | null; days: number; credits: number;
  premium_until: string | null; actor: string | null; note: string | null; refunded: boolean; refunded_at: number | null;
}
export interface PlayPrice { base: number; price: number; net: number }
export interface Revenue {
  days: number; total: number; count: number; month: number; month_count: number; buyers: number; average: number;
  by_day: { day: string; amount: number; n: number }[]; by_offer: { offer: string; amount: number; n: number }[];
  by_method: { method: string; amount: number; n: number }[]; gifts: { n: number; days: number }; refunds: { n: number; amount: number };
  premium_active: number; premium_expiring_7d: number; margin: number;
  ai: { requests: number; users: number; cost: number; cost_per_request: number; by_day: { day: string; requests: number; cost: number }[] };
  play: { markup_pct: number; week: PlayPrice; month: PlayPrice; year: PlayPrice; ai_pack: PlayPrice };
}
export const METHOD_LABELS: Record<string, string> = {
  orange_money: 'Orange Money', wave: 'Wave', mtn: 'MTN MoMo', moov: 'Moov Money', cash: 'Espèces', transfer: 'Virement',
  card: 'Carte bancaire', google_play: 'Google Play', other: 'Autre', gift: 'Offert',
};
export const OFFER_LABELS: Record<string, string> = { week: 'Semaine', month: 'Mois', year: 'Année', custom: 'Durée libre', ai_pack: 'Recharge IA' };
export const fmtMoney = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} F`;
export interface Settings {
  maintenance: boolean; maintenance_message: string; announcement: string; announcement_level: string;
  min_version_code: number; latest_version_name: string; update_url: string; support_email: string;
  conversion_enabled: boolean; registration_open: boolean; google_client_id?: string;
  plans: { free: PlanLimits; premium: PlanLimits };
  sales: Sales;
  ai: { enabled: boolean; provider: 'openai' | 'anthropic' | 'gemini'; base_url: string; model: string; api_key: string; has_key?: boolean; key_from_env?: boolean; key_error?: boolean; cost_per_request: number; max_tokens: number };
  limits: Limits;
  backup: BackupSettings;
  mail: MailSettings;
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

/** Le choix du serveur n'existe qu'en développement (tableau de bord lancé par Vite sur l'ordinateur). */
export const serverChoice = import.meta.env.DEV;

/** Adresse du serveur : en ligne, toujours celle qui sert le tableau de bord ; en développement, celle enregistrée, sinon localhost. */
export function defaultServer(): string {
  if (!serverChoice && location.protocol.startsWith('http')) return location.origin;
  const saved = localStorage.getItem(KEY_URL);
  if (saved) return saved;
  // Servi par le serveur Pagio lui-même : l'API est à la même adresse.
  if (location.protocol.startsWith('http')) return location.origin;
  return 'http://localhost:8787';
}

export class ApiError extends Error {
  /** `data` : réponse complète du serveur (ex. totp_required à la connexion). */
  constructor(public status: number, message: string, public data: Record<string, unknown> = {}) { super(message); }
}

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
  if (!r.ok) throw new ApiError(r.status, data.error || `Erreur ${r.status}`, data);
  return data as T;
}

/** Envoi d'un fichier brut au serveur (import d'une sauvegarde). */
export async function upload<T>(path: string, file: Blob): Promise<T> {
  let r: Response;
  try {
    r = await fetch(session.server + path, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${session.token}` }, body: file });
  } catch {
    throw new ApiError(0, `Serveur injoignable (${session.server}).`);
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { session.token = null; onUnauthorized(); }
  if (!r.ok) throw new ApiError(r.status, data.error || `Erreur ${r.status}`, data);
  return data as T;
}

export const fmtBytes = (n: number) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`;

export async function download(path: string, filename: string) {
  const r = await fetch(session.server + path, { headers: { Authorization: `Bearer ${session.token}` } });
  if (!r.ok) throw new ApiError(r.status, 'Téléchargement impossible');
  const blob = await r.blob();
  // Dans l'APK admin, la WebView ne sait pas enregistrer un fichier : il passe par le pont Android.
  if (window.PagioAdmin?.saveFile) {
    const b64 = await new Promise<string>((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1] ?? ''); fr.readAsDataURL(blob); });
    window.PagioAdmin.saveFile(filename, blob.type || 'application/octet-stream', b64);
    return;
  }
  const url = URL.createObjectURL(blob);
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
