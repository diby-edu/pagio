// Statistiques du site pagio.site, sans cookies : provenance, appareil, navigateur et pays d'une visite.
// Le visiteur est reconnu seulement le temps d'une journée, par une empreinte (adresse IP + navigateur + sel du jour) ;
// le sel change chaque jour et n'est jamais enregistré, l'adresse IP non plus : impossible de suivre quelqu'un d'un jour
// à l'autre ni de retrouver son adresse.
import crypto from 'node:crypto';

let salt = { day: '', value: '' };
/** Empreinte du visiteur pour la journée (16 caractères). */
export function visitorId(ip, ua, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  if (salt.day !== day) salt = { day, value: crypto.randomBytes(16).toString('hex') };
  return crypto.createHash('sha256').update(`${salt.value}|${ip}|${ua}`).digest('hex').slice(0, 16);
}

const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp\/|telegrambot|embedly|headless|lighthouse|pingdom|uptimerobot|monitor|curl|wget|python-requests|node-fetch|axios|go-http|java\//i;
export const isBot = (ua) => !ua || BOTS.test(ua);

/** Type d'appareil, navigateur et système, d'après l'en-tête User-Agent. */
export function parseUA(ua = '') {
  const device = /ipad|tablet|(android(?!.*mobile))/i.test(ua) ? 'tablette' : /mobi|iphone|android/i.test(ua) ? 'téléphone' : 'ordinateur';
  const browser = /edg\//i.test(ua) ? 'Edge' : /opr\/|opera/i.test(ua) ? 'Opera' : /samsungbrowser/i.test(ua) ? 'Samsung Internet'
    : /ucbrowser/i.test(ua) ? 'UC Browser' : /firefox|fxios/i.test(ua) ? 'Firefox' : /chrome|crios/i.test(ua) ? 'Chrome'
    : /safari/i.test(ua) ? 'Safari' : 'Autre';
  const os = /windows/i.test(ua) ? 'Windows' : /android/i.test(ua) ? 'Android' : /iphone|ipad|ios/i.test(ua) ? 'iOS'
    : /mac os/i.test(ua) ? 'macOS' : /linux/i.test(ua) ? 'Linux' : 'Autre';
  return { device, browser, os };
}

const SOURCES = [
  [/google\./, 'Google'], [/bing\.|msn\./, 'Bing'], [/yahoo\./, 'Yahoo'], [/duckduckgo\./, 'DuckDuckGo'], [/yandex\./, 'Yandex'],
  [/facebook\.|fb\.|messenger\./, 'Facebook'], [/instagram\./, 'Instagram'], [/whatsapp\.|wa\.me/, 'WhatsApp'],
  [/t\.co$|twitter\.|x\.com/, 'X (Twitter)'], [/linkedin\./, 'LinkedIn'], [/tiktok\./, 'TikTok'], [/youtube\.|youtu\.be/, 'YouTube'],
  [/t\.me|telegram\./, 'Telegram'], [/chatgpt\.|openai\./, 'ChatGPT'], [/play\.google/, 'Google Play'],
];
/**
 * Provenance d'une visite : paramètre utm_source s'il est présent (liens partagés), sinon le site d'où vient le visiteur.
 * « direct » : adresse tapée, favori ou application (WhatsApp sur téléphone n'envoie souvent pas de provenance).
 */
export function classifySource(ref, utm, ownHosts = []) {
  if (utm) return { source: String(utm).toLowerCase().slice(0, 40), ref_domain: null };
  let host = '';
  try { host = new URL(ref).hostname.replace(/^www\./, '').toLowerCase(); } catch { return { source: 'direct', ref_domain: null }; }
  if (!host) return { source: 'direct', ref_domain: null };
  if (ownHosts.some((h) => host === h || host.endsWith(`.${h}`))) return { source: 'interne', ref_domain: null };
  const known = SOURCES.find(([re]) => re.test(host));
  return { source: known ? known[1] : 'autre site', ref_domain: host.slice(0, 80) };
}

// Fuseau horaire du navigateur → pays (les plus courants pour Pagio). À défaut, la région de la langue (fr-CI → CI).
const TZ = {
  'Africa/Abidjan': 'CI', 'Africa/Dakar': 'SN', 'Africa/Bamako': 'ML', 'Africa/Ouagadougou': 'BF', 'Africa/Lome': 'TG', 'Africa/Porto-Novo': 'BJ',
  'Africa/Niamey': 'NE', 'Africa/Conakry': 'GN', 'Africa/Accra': 'GH', 'Africa/Lagos': 'NG', 'Africa/Douala': 'CM', 'Africa/Libreville': 'GA',
  'Africa/Brazzaville': 'CG', 'Africa/Kinshasa': 'CD', 'Africa/Lubumbashi': 'CD', 'Africa/Bangui': 'CF', 'Africa/Ndjamena': 'TD',
  'Africa/Casablanca': 'MA', 'Africa/Algiers': 'DZ', 'Africa/Tunis': 'TN', 'Africa/Cairo': 'EG', 'Africa/Nouakchott': 'MR', 'Africa/Kigali': 'RW',
  'Africa/Bujumbura': 'BI', 'Africa/Nairobi': 'KE', 'Africa/Johannesburg': 'ZA', 'Indian/Antananarivo': 'MG', 'Indian/Mauritius': 'MU',
  'Europe/Paris': 'FR', 'Europe/Brussels': 'BE', 'Europe/Zurich': 'CH', 'Europe/Luxembourg': 'LU', 'Europe/Monaco': 'MC', 'Europe/London': 'GB',
  'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT', 'Europe/Lisbon': 'PT', 'Europe/Amsterdam': 'NL', 'Europe/Dublin': 'IE',
  'America/Montreal': 'CA', 'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/New_York': 'US', 'America/Chicago': 'US',
  'America/Denver': 'US', 'America/Los_Angeles': 'US', 'America/Port-au-Prince': 'HT', 'America/Martinique': 'MQ', 'America/Guadeloupe': 'GP',
  'America/Cayenne': 'GF', 'Indian/Reunion': 'RE', 'Asia/Dubai': 'AE', 'Asia/Shanghai': 'CN', 'Asia/Kolkata': 'IN', 'Asia/Beirut': 'LB',
};
export function countryOf(tz, lang) {
  if (tz && TZ[tz]) return TZ[tz];
  const m = /^[a-z]{2,3}-([A-Z]{2})$/i.exec(String(lang || ''));
  return m ? m[1].toUpperCase() : null;
}
