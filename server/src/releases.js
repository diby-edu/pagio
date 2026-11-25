// Versions de l'application Android publiées sur pagio.site/telecharger : envoi d'une APK depuis le tableau de bord,
// vérification du fichier, bascule du lien « pagio.apk », retour à une version précédente, versions d'essai.
// Le dossier (RELEASES_DIR) est celui que sert nginx ; il est monté dans le conteneur.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const versionCode = (v) => { const [a, b, c] = String(v).split('.').map(Number); return a * 10000 + b * 100 + c; };
const VERSION_RE = /^\d{1,3}\.\d{1,2}\.\d{1,2}$/;
const FILE_RE = /^pagio-(\d+\.\d+\.\d+)(-essai)?\.apk$/;

/** Lit une entrée d'une archive ZIP (une APK en est une) ; null si absente. */
export function zipEntry(buf, name) {
  // Fin du répertoire central : signature 0x06054b50 dans les derniers 64 Ko.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count && p + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28); const xlen = buf.readUInt16LE(p + 30); const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entry = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (entry === name) {
      const lnl = buf.readUInt16LE(local + 26); const lxl = buf.readUInt16LE(local + 28);
      const data = buf.subarray(local + 30 + lnl + lxl, local + 30 + lnl + lxl + csize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}

/**
 * Vérifie qu'un fichier est bien une APK de Pagio et que le numéro saisi est le sien (les textes du manifeste
 * compilé sont en UTF-16 : on y cherche le nom du paquet et le numéro de version).
 */
export function checkApk(buf, version, pkg = 'com.pagio.app') {
  if (!VERSION_RE.test(String(version))) throw Object.assign(new Error('Numéro de version invalide (exemple : 2.3.0)'), { status: 400 });
  if (buf.length < 1024 || buf.readUInt32LE(0) !== 0x04034b50) throw Object.assign(new Error("Ce fichier n'est pas une APK"), { status: 400 });
  let manifest;
  try { manifest = zipEntry(buf, 'AndroidManifest.xml'); } catch { manifest = null; }
  if (!manifest || !zipEntry(buf, 'classes.dex')) throw Object.assign(new Error("Ce fichier n'est pas une APK Android complète"), { status: 400 });
  const u16 = (s) => Buffer.from(s, 'utf16le');
  if (!manifest.includes(u16(pkg)) || manifest.includes(u16('com.pagio.admin'))) throw Object.assign(new Error("Cette APK n'est pas l'application Pagio (com.pagio.app)"), { status: 400 });
  if (!manifest.includes(u16(String(version)))) throw Object.assign(new Error(`Le numéro ${version} ne correspond pas à cette APK (vérifiez la version saisie)`), { status: 400 });
}

/** Liste des APK du dossier, la plus récente d'abord, avec celle que sert « pagio.apk ». */
export function listReleases(dir) {
  if (!dir || !fs.existsSync(dir)) return { enabled: false, files: [], current: null };
  let info = null;
  try { info = JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')); } catch { info = null; }
  let current = null;
  try { current = path.basename(fs.readlinkSync(path.join(dir, 'pagio.apk'))); } catch { current = info?.version ? `pagio-${info.version}.apk` : null; }
  const files = fs.readdirSync(dir).filter((f) => FILE_RE.test(f)).map((f) => {
    const m = f.match(FILE_RE); const st = fs.statSync(path.join(dir, f));
    return { file: f, version: m[1], essai: !!m[2], code: versionCode(m[1]), bytes: st.size, date: st.mtimeMs, current: f === current };
  }).sort((a, b) => b.code - a.code || Number(a.essai) - Number(b.essai));
  return { enabled: true, files, current, info };
}

/** Enregistre l'APK (fichier temporaire puis renommage, empreinte vérifiée). Renvoie { file, sha256, bytes }. */
export function saveApk(dir, buf, version, essai) {
  const file = `pagio-${version}${essai ? '-essai' : ''}.apk`;
  const tmp = path.join(dir, `${file}.part`);
  fs.writeFileSync(tmp, buf, { mode: 0o644 });
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(tmp)).digest('hex');
  if (sha256 !== crypto.createHash('sha256').update(buf).digest('hex')) { fs.rmSync(tmp, { force: true }); throw new Error('Fichier abîmé pendant l\'enregistrement'); }
  fs.renameSync(tmp, path.join(dir, file));
  return { file, sha256, bytes: buf.length };
}

/** Fait pointer « pagio.apk » (bouton du site) sur ce fichier et réécrit version.json. */
export function makeCurrent(dir, file, today = new Date().toISOString().slice(0, 10)) {
  const m = String(file).match(FILE_RE);
  if (!m || m[2]) throw Object.assign(new Error('Seule une version normale (pas une version d\'essai) peut être proposée à tous'), { status: 400 });
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) throw Object.assign(new Error('Fichier introuvable'), { status: 404 });
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  const bytes = fs.statSync(full).size;
  const link = path.join(dir, 'pagio.apk.new');
  fs.rmSync(link, { force: true });
  // Lien symbolique (serveur Linux) ; copie si le système ne le permet pas (Windows sans droits).
  try { fs.symlinkSync(file, link); } catch { fs.copyFileSync(full, link); }
  fs.renameSync(link, path.join(dir, 'pagio.apk'));
  const info = { version: m[1], code: versionCode(m[1]), taille_mo: Math.round(bytes / 1048576), sha256, date: today };
  fs.writeFileSync(path.join(dir, 'version.json.new'), JSON.stringify(info) + '\n', { mode: 0o644 });
  fs.renameSync(path.join(dir, 'version.json.new'), path.join(dir, 'version.json'));
  return info;
}

export function removeRelease(dir, file) {
  if (!FILE_RE.test(String(file))) throw Object.assign(new Error('Fichier inconnu'), { status: 400 });
  const { current } = listReleases(dir);
  if (file === current) throw Object.assign(new Error('Impossible de supprimer la version proposée au téléchargement'), { status: 400 });
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) throw Object.assign(new Error('Fichier introuvable'), { status: 404 });
  fs.rmSync(full);
}
