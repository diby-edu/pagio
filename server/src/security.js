// Sécurité : mots de passe (scrypt), jetons signés HMAC-SHA256 (format JWT), limitation des tentatives.
import crypto from 'node:crypto';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [algo, salt, hash] = String(stored).split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(payload, secret, ttlSeconds) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (expected.length !== parts[2].length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

/**
 * Limite simple en mémoire : au plus `max` essais par clé sur `windowMs`.
 * Le plafond peut être précisé à chaque appel (limites réglables depuis le tableau de bord).
 */
export function rateLimiter(max, windowMs) {
  const hits = new Map();
  return (key, limit = max) => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    list.push(now);
    hits.set(key, list);
    if (hits.size > 10000) hits.clear();
    return list.length <= limit;
  };
}

// ---------------------------------------------------------------------------- Chiffrement des secrets
// Les secrets stockés en base (clé d'IA, secrets de double authentification) sont chiffrés en AES-256-GCM
// avec une clé conservée hors de la base (variable SECRETS_KEY ou fichier secrets.key) : une sauvegarde
// de la base ne suffit donc pas à les lire.

const ENC_PREFIX = 'enc:v1:';

/** Transforme une phrase secrète quelconque en clé de 32 octets. */
export const deriveKey = (secret) => crypto.createHash('sha256').update(String(secret)).digest();

export const isEncrypted = (value) => typeof value === 'string' && value.startsWith(ENC_PREFIX);

export function encryptSecret(plain, key) {
  if (!key || !plain || isEncrypted(plain)) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `${ENC_PREFIX}${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${data.toString('base64url')}`;
}

/** Rend la valeur en clair. Lève une erreur si la clé est absente ou ne correspond pas. */
export function decryptSecret(value, key) {
  if (!isEncrypted(value)) return value;
  if (!key) throw new Error('Clé de chiffrement des secrets absente');
  const [iv, tag, data] = value.slice(ENC_PREFIX.length).split('.').map((p) => Buffer.from(p, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------- Double authentification (TOTP, RFC 6238)
// Compatible Google Authenticator, Microsoft Authenticator, Authy, etc. : SHA-1, 6 chiffres, 30 secondes.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  let bits = 0; let value = 0; const out = [];
  for (const ch of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

export function totpCode(secretB32, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

/**
 * Vérifie un code à 6 chiffres (période courante, précédente ou suivante pour tolérer un léger décalage d'horloge).
 * Renvoie le numéro de période accepté, ou 0. `lastStep` interdit de rejouer un code déjà utilisé.
 */
export function verifyTotp(secretB32, code, lastStep = 0, now = Date.now()) {
  const clean = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return 0;
  const current = Math.floor(now / 30_000);
  for (const step of [current, current - 1, current + 1]) {
    if (step <= lastStep) continue;
    if (crypto.timingSafeEqual(Buffer.from(totpCode(secretB32, step)), Buffer.from(clean))) return step;
  }
  return 0;
}

export const totpUri = (secretB32, account, issuer = 'Pagio Admin') =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/** Codes de secours à usage unique (affichés une seule fois, stockés sous forme d'empreintes). */
export function newRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => {
    const s = crypto.randomBytes(5).toString('hex');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export const hashRecoveryCode = (code) => crypto.createHash('sha256').update(String(code || '').trim().toLowerCase()).digest('hex');

export function randomPassword(length = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%';
  return Array.from(crypto.randomBytes(length), (b) => chars[b % chars.length]).join('');
}
