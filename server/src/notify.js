// Notifications de Pagio Admin : catégories, préférences par téléphone (cases à cocher du tableau de bord), heures
// calmes et envoi instantané par Firebase Cloud Messaging (FCM, API HTTP v1, gratuite).
// Sans Firebase configuré, rien n'est perdu : l'APK lit le même flux toutes les 15 minutes.
import crypto from 'node:crypto';

/** Catégories proposées en cases à cocher, dans l'ordre d'affichage. `on` = cochée par défaut. */
export const NOTIFY_KINDS = [
  { id: 'critical', label: 'Alertes urgentes', detail: 'Serveur en panne, disque presque plein, sauvegarde ratée, certificat qui expire…', on: true },
  { id: 'warning', label: 'Alertes à surveiller', detail: 'Lenteurs, erreurs en hausse, mémoire chargée, crédits IA bas…', on: true },
  { id: 'outage', label: 'Pannes réparées', detail: 'Le gardien a détecté une coupure et l’a réparée (durée, redémarrage).', on: true },
  { id: 'feedback', label: 'Messages des utilisateurs', detail: 'Nouveau message reçu depuis l’application ou le site.', on: true },
  { id: 'payment', label: 'Paiements', detail: 'Chaque paiement enregistré (montant, moyen de paiement).', on: true },
  { id: 'premium', label: 'Nouveaux Premium', detail: 'Un compte passe en Premium (paiement, code promo, parrainage, cadeau).', on: true },
  { id: 'signup', label: 'Nouvelles inscriptions', detail: 'Chaque nouveau compte créé (peut faire beaucoup de notifications).', on: false },
];
const KIND_IDS = NOTIFY_KINDS.map((k) => k.id);

/** Préférences complètes d'un téléphone : catégories + heures calmes (22 h – 7 h, heure d'Abidjan = UTC). */
export function parsePrefs(raw) {
  let p = {};
  try { p = raw ? JSON.parse(raw) : {}; } catch { p = {}; }
  const kinds = {};
  for (const k of NOTIFY_KINDS) kinds[k.id] = typeof p.kinds?.[k.id] === 'boolean' ? p.kinds[k.id] : k.on;
  return { kinds, quiet: p.quiet === true };
}

/** Nettoie des préférences reçues du tableau de bord (seules les clés connues sont gardées). */
export function cleanPrefs(body) {
  const kinds = {};
  for (const id of KIND_IDS) if (typeof body?.kinds?.[id] === 'boolean') kinds[id] = body.kinds[id];
  return parsePrefs(JSON.stringify({ kinds, quiet: body?.quiet === true }));
}

/** Nuit (22 h – 7 h, heure de Côte d'Ivoire) : les notifications non urgentes arrivent sans son. */
export const isQuietHour = (ts = Date.now()) => { const h = new Date(ts).getUTCHours(); return h >= 22 || h < 7; };

export const wants = (prefs, kind) => KIND_IDS.includes(kind) && prefs.kinds[kind] === true;

// ---------------------------------------------------------------------------- Firebase Cloud Messaging

/**
 * Réglage « firebase » collé dans le tableau de bord : on accepte le fichier google-services.json (pour l'APK) et la
 * clé de compte de service (pour le serveur), dans n'importe quel ordre. Renvoie ce qu'on a pu reconnaître.
 */
export function parseFirebaseJson(text) {
  let j;
  try { j = JSON.parse(String(text || '')); } catch { throw new Error('Ce texte n’est pas un fichier JSON valide'); }
  if (j.type === 'service_account') {
    if (!j.project_id || !j.client_email || !String(j.private_key || '').includes('PRIVATE KEY')) throw new Error('Clé de compte de service incomplète');
    return { service: { project_id: j.project_id, client_email: j.client_email, private_key: j.private_key } };
  }
  if (j.project_info && Array.isArray(j.client)) {
    const c = j.client.find((x) => x.client_info?.android_client_info?.package_name === 'com.pagio.admin');
    if (!c) throw new Error('Ce google-services.json ne contient pas l’application com.pagio.admin');
    return {
      client: {
        project_id: j.project_info.project_id, sender_id: j.project_info.project_number,
        app_id: c.client_info.mobilesdk_app_id, api_key: c.api_key?.[0]?.current_key || '',
      },
    };
  }
  throw new Error('Fichier non reconnu : collez google-services.json ou la clé de compte de service (JSON)');
}

const b64url = (b) => Buffer.from(b).toString('base64url');

/** Jeton d'accès Google (1 h) obtenu avec la clé de compte de service ; gardé en mémoire jusqu'à 5 min avant la fin. */
export function fcmTokenSource(fetchImpl = fetch) {
  let cache = null;
  return async (service) => {
    if (cache && cache.email === service.client_email && cache.exp - 300_000 > Date.now()) return cache.token;
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({ iss: service.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
    const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claims}`).sign(service.private_key, 'base64url');
    const r = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${sig}` }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(`Google a refusé la clé Firebase (${j.error_description || j.error || r.status})`);
    cache = { email: service.client_email, token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
    return cache.token;
  };
}

/**
 * Envoie un message « données » à un téléphone (l'APK fabrique la notification elle-même, avec le bon canal et le son).
 * Renvoie 'ok', 'unregistered' (jeton périmé : à oublier) ou lève une erreur.
 */
export async function fcmSend(fetchImpl, accessToken, projectId, token, data) {
  const r = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ message: { token, data, android: { priority: 'HIGH', ttl: '86400s' } } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (r.ok) return 'ok';
  const j = await r.json().catch(() => ({}));
  const code = j.error?.details?.find?.((d) => d.errorCode)?.errorCode || j.error?.status;
  if (r.status === 404 || code === 'UNREGISTERED') return 'unregistered';
  throw new Error(`Firebase : ${j.error?.message || r.status}`);
}
