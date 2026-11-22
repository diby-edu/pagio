// Connexion « avec Google » : vérification du jeton d'identité (JWT signé RS256) envoyé par le bouton Google,
// sans bibliothèque. Clés publiques de Google mises en cache selon leur durée de validité.
import crypto from 'node:crypto';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
let cache = { keys: null, until: 0 };

async function googleKeys(fetchImpl = fetch) {
  if (cache.keys && Date.now() < cache.until) return cache.keys;
  const r = await fetchImpl(CERTS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error('Clés de Google indisponibles');
  const maxAge = Number(/max-age=(\d+)/.exec(r.headers.get('cache-control') || '')?.[1]) || 3600;
  const { keys } = await r.json();
  cache = { keys, until: Date.now() + Math.min(maxAge, 6 * 3600) * 1000 };
  return keys;
}

const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

/**
 * Vérifie le jeton et renvoie { email, name, sub } ; lève une erreur lisible sinon.
 * Contrôles : signature par une clé de Google, émetteur, destinataire (notre identifiant client), expiration, e-mail vérifié.
 */
export async function verifyGoogleToken(token, clientId, { fetchImpl = fetch, now = Date.now(), keys = null } = {}) {
  if (!clientId) throw new Error('Connexion avec Google non configurée');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Jeton Google invalide');
  let header, payload;
  try { header = b64json(parts[0]); payload = b64json(parts[1]); } catch { throw new Error('Jeton Google invalide'); }
  if (header.alg !== 'RS256') throw new Error('Jeton Google invalide');
  const jwk = (keys || await googleKeys(fetchImpl)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Jeton Google signé par une clé inconnue');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('Signature du jeton Google invalide');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) throw new Error('Jeton Google : émetteur inattendu');
  if (payload.aud !== clientId) throw new Error('Jeton Google destiné à une autre application');
  if (!payload.exp || payload.exp * 1000 < now - 60_000) throw new Error('Jeton Google expiré');
  if (!payload.email || payload.email_verified !== true && payload.email_verified !== 'true') throw new Error('Adresse Google non vérifiée');
  return { email: String(payload.email).toLowerCase(), name: String(payload.name || '').slice(0, 80), sub: String(payload.sub) };
}
