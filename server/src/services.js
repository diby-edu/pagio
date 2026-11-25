// Services externes : IA générative (proxy, clés gardées côté serveur) et conversion LibreOffice.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------- IA

/**
 * Appelle le fournisseur configuré par l'administrateur. Ajouter un fournisseur = ajouter un cas ici.
 * provider : openai (et tout service compatible : Mistral, Groq, OpenRouter, Ollama…), anthropic, gemini.
 */
export async function aiComplete(ai, system, messages, maxTokens) {
  const max = Math.min(Number(maxTokens) || ai.max_tokens || 1800, 8000);
  const timeout = AbortSignal.timeout(120_000);
  if (!ai.api_key && ai.provider !== 'openai') throw new Error("Clé d'API manquante côté serveur");
  if (ai.provider === 'anthropic') {
    const r = await fetch(`${(ai.base_url || 'https://api.anthropic.com/v1').replace(/\/$/, '')}/messages`, {
      method: 'POST', signal: timeout,
      headers: { 'content-type': 'application/json', 'x-api-key': ai.api_key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: ai.model || 'claude-haiku-5-5', system, messages, max_tokens: max }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || `Erreur Anthropic ${r.status}`);
    return j.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  }
  if (ai.provider === 'gemini') {
    const model = ai.model || 'gemini-2.5-flash';
    const r = await fetch(`${(ai.base_url || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')}/models/${model}:generateContent`, {
      method: 'POST', signal: timeout,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': ai.api_key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: max, temperature: 0.3 },
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || `Erreur Gemini ${r.status}`);
    return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  }
  const r = await fetch(`${(ai.base_url || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', signal: timeout,
    headers: { 'content-type': 'application/json', ...(ai.api_key ? { authorization: `Bearer ${ai.api_key}` } : {}) },
    body: JSON.stringify({ model: ai.model || 'gpt-4.1-mini', messages: [{ role: 'system', content: system }, ...messages], max_tokens: max, temperature: 0.3 }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `Erreur du fournisseur IA ${r.status}`);
  return j.choices?.[0]?.message?.content || '';
}

// ---------------------------------------------------------------------------- LibreOffice

// Fonction (et non constante) : SOFFICE_PATH peut venir du fichier .env, chargé après l'import de ce module.
const candidates = () => [
  process.env.SOFFICE_PATH,
  'soffice', 'libreoffice',
  // Windows : soffice.exe (application graphique) n'écrit rien sur la sortie standard, donc « --version »
  // ne permet pas de le détecter ; soffice.com est la variante console du même programme.
  'C:\\Program Files\\LibreOffice\\program\\soffice.com',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  '/usr/bin/soffice', '/usr/lib/libreoffice/program/soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
].filter(Boolean);

let sofficePath = null;

export async function detectLibreOffice() {
  for (const c of candidates()) {
    const ok = await new Promise((res) => execFile(c, ['--version'], { timeout: 20_000 }, (err, out) => res(!err && /LibreOffice/i.test(String(out)))));
    if (ok) { sofficePath = c; return c; }
  }
  sofficePath = null;
  return null;
}

export const libreOfficeAvailable = () => sofficePath !== null;

// Pas de guillemets autour du nom du filtre : execFile transmet l'argument tel quel (aucun shell ne les retire).
const TARGETS = { pdf: 'pdf', docx: 'docx:MS Word 2007 XML', xlsx: 'xlsx', pptx: 'pptx' };

/** Convertit un fichier dans un dossier temporaire privé, puis supprime tout après lecture. */
export async function convertWithLibreOffice(buffer, originalName, target) {
  if (!sofficePath) throw Object.assign(new Error("LibreOffice n'est pas installé sur le serveur"), { status: 501 });
  const filter = TARGETS[target];
  if (!filter) throw Object.assign(new Error(`Format cible non pris en charge : ${target}`), { status: 400 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pagio-conv-'));
  const safe = path.basename(originalName || 'document').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || 'document';
  const input = path.join(dir, safe);
  // Dans l'image Docker, LibreOffice tourne sous un compte sans droits (SOFFICE_UID) : un document piégé exploitant
  // une faille de LibreOffice ne pourrait lire ni la base ni les clés (/data, réservé à root).
  const uid = Number(process.env.SOFFICE_UID) || 0;
  const asUser = uid > 0 && process.getuid?.() === 0 ? { uid, gid: uid, env: { PATH: process.env.PATH, HOME: dir } } : {};
  try {
    fs.writeFileSync(input, buffer);
    if (asUser.uid) { fs.chownSync(dir, uid, uid); fs.chownSync(input, uid, uid); }
    const args = ['--headless', '--norestore', `-env:UserInstallation=file:///${dir.replace(/\\/g, '/')}/profile`];
    // Un PDF s'ouvre par défaut dans Draw, qui n'exporte ni Word ni PowerPoint : on force le bon module.
    const isPdf = /\.pdf$/i.test(safe);
    if (isPdf && target === 'xlsx') throw Object.assign(new Error("LibreOffice ne sait pas convertir un PDF en Excel : utilisez la conversion de l'application"), { status: 400 });
    if (isPdf && target === 'docx') args.push('--infilter=writer_pdf_import');
    if (isPdf && target === 'pptx') args.push('--infilter=impress_pdf_import');
    args.push('--convert-to', filter, '--outdir', dir, input);
    await new Promise((res, rej) => execFile(sofficePath, args, { timeout: 180_000, ...asUser }, (err, _o, stderr) => (err ? rej(new Error(`Conversion impossible : ${stderr || err.message}`)) : res())));
    const outName = safe.replace(/\.[^.]+$/, '') + '.' + target;
    const out = path.join(dir, outName);
    if (!fs.existsSync(out)) throw new Error('LibreOffice n\'a produit aucun fichier');
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------- Outils PDF du serveur (étape 4, vague 2)
// qpdf (réparer, protéger, déverrouiller) et Ghostscript (compresser), lancés comme LibreOffice : dossier temporaire
// privé, compte sans droits dans Docker, tout est effacé après lecture.

const run = (cmd, args, opts) => new Promise((res, rej) => execFile(cmd, args, { timeout: 180_000, maxBuffer: 4 << 20, ...opts }, (err, out, stderr) => {
  // qpdf : code 3 = réussi avec des avertissements (PDF abîmé mais réparé).
  if (err && !(cmd === 'qpdf' && err.code === 3)) return rej(Object.assign(new Error(String(stderr || err.message).slice(0, 400)), { code: err.code }));
  res(String(out));
}));

const GS_LEVELS = { low: '/printer', medium: '/ebook', high: '/screen' };
export const PDF_OPS = ['compress', 'repair', 'protect', 'unlock', 'html_to_pdf', 'ocr'];

/** Lance un outil PDF du serveur. opts : { level, password, name }. Renvoie { bytes, note }. */
export async function pdfTool(op, buffer, opts = {}) {
  if (op === 'html_to_pdf') {
    const name = /\.html?$/i.test(opts.name || '') ? opts.name : 'page.html';
    return { bytes: await convertWithLibreOffice(Buffer.from(cleanHtml(buffer.toString('utf8'))), name, 'pdf') };
  }
  if (!PDF_OPS.includes(op)) throw Object.assign(new Error('Outil inconnu'), { status: 400 });
  if (buffer.subarray(0, 1024).indexOf('%PDF') < 0) throw Object.assign(new Error("Ce fichier n'est pas un PDF"), { status: 400 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pagio-pdf-'));
  const uid = Number(process.env.SOFFICE_UID) || 0;
  const asUser = uid > 0 && process.getuid?.() === 0 ? { uid, gid: uid, env: { PATH: process.env.PATH, HOME: dir } } : {};
  const input = path.join(dir, 'in.pdf');
  const output = path.join(dir, 'out.pdf');
  try {
    fs.writeFileSync(input, buffer);
    if (asUser.uid) { fs.chownSync(dir, uid, uid); fs.chownSync(input, uid, uid); }
    let note = '';
    if (op === 'compress') {
      const level = GS_LEVELS[opts.level] || GS_LEVELS.medium;
      await run('gs', ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', `-dPDFSETTINGS=${level}`, '-dNOPAUSE', '-dBATCH', '-dQUIET', '-dSAFER',
        '-dDetectDuplicateImages=true', '-dCompressFonts=true', `-sOutputFile=${output}`, input], asUser);
      if (fs.statSync(output).size >= buffer.length) { note = 'already_small'; fs.copyFileSync(input, output); }
    } else if (op === 'repair') {
      try { await run('qpdf', [input, output], asUser); } catch {
        // qpdf n'a rien pu lire : Ghostscript réécrit le document à partir de ce qu'il arrive à interpréter.
        await run('gs', ['-sDEVICE=pdfwrite', '-dNOPAUSE', '-dBATCH', '-dQUIET', '-dSAFER', `-sOutputFile=${output}`, input], asUser);
        note = 'rebuilt';
      }
    } else if (op === 'protect') {
      const pw = String(opts.password || '');
      if (pw.length < 4) throw Object.assign(new Error('Mot de passe trop court (4 caractères minimum)'), { status: 400 });
      const owner = crypto.randomUUID();
      await run('qpdf', ['--encrypt', pw, owner, '256', '--', input, output], asUser);
    } else if (op === 'ocr') {
      // Texte invisible ajouté sous l'image des pages scannées ; les pages qui ont déjà du texte sont laissées telles quelles.
      const lang = opts.lang === 'eng' ? 'eng+fra' : 'fra+eng';
      const env = { ...(asUser.env || { PATH: process.env.PATH }), TMPDIR: dir, HOME: dir, OMP_THREAD_LIMIT: '1' };
      try {
        await run('ocrmypdf', ['--skip-text', '--rotate-pages', '--deskew', '--output-type', 'pdf', '--jobs', '1', '-l', lang, input, output], { ...asUser, env, timeout: 300_000 });
      } catch (e) {
        if (e.code === 6) throw Object.assign(new Error('Ce PDF contient déjà du texte : pas besoin d’OCR.'), { status: 400 });
        if (e.code === 8) throw Object.assign(new Error('Ce PDF est protégé par un mot de passe : déverrouillez-le d’abord.'), { status: 400 });
        throw e;
      }
    } else if (op === 'unlock') {
      const pwFile = path.join(dir, 'pw.txt');
      fs.writeFileSync(pwFile, String(opts.password || ''));
      if (asUser.uid) fs.chownSync(pwFile, uid, uid);
      try { await run('qpdf', [`--password-file=${pwFile}`, '--decrypt', input, output], asUser); } catch (e) {
        if (/password/i.test(e.message)) throw Object.assign(new Error('Mot de passe incorrect'), { status: 400 });
        throw e;
      }
    }
    if (!fs.existsSync(output)) throw new Error('Aucun fichier produit');
    return { bytes: fs.readFileSync(output), note };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export const pdfToolsAvailable = () => new Promise((res) => execFile('qpdf', ['--version'], { timeout: 10_000 }, (err) => res(!err)));

/**
 * Page HTML envoyée par un utilisateur : on retire scripts, cadres et toute ressource externe (http, file, ftp…)
 * pour que LibreOffice ne puisse ni aller chercher une adresse interne du serveur ni lire un fichier local.
 * Les images intégrées (data:) restent.
 */
export function cleanHtml(html) {
  return String(html)
    .replace(/<(script|iframe|object|applet|frameset|style)\b[\s\S]*?<\/\1\s*>/gi, (m, tag) => (tag.toLowerCase() === 'style' ? m : ''))
    .replace(/<\/?(script|iframe|object|embed|frame|frameset|applet|meta|link|base)\b[^>]*>/gi, '')
    .replace(/\s(src|href|background|poster|data|action|srcset|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (m, attr, v) => {
      const val = v.replace(/^["']|["']$/g, '').trim();
      return /^(data:image\/|#)/i.test(val) ? m : '';
    })
    .replace(/url\(\s*(['"]?)(?!data:image\/)[^)]*\)/gi, 'none')
    .replace(/@import[^;]*;/gi, '');
}
