// Services externes : IA générative (proxy, clés gardées côté serveur) et conversion LibreOffice.
import { execFile } from 'node:child_process';
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

const CANDIDATES = [
  process.env.SOFFICE_PATH,
  'soffice', 'libreoffice',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  '/usr/bin/soffice', '/usr/lib/libreoffice/program/soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
].filter(Boolean);

let sofficePath = null;

export async function detectLibreOffice() {
  for (const c of CANDIDATES) {
    const ok = await new Promise((res) => execFile(c, ['--version'], { timeout: 20_000 }, (err, out) => res(!err && /LibreOffice/i.test(String(out)))));
    if (ok) { sofficePath = c; return c; }
  }
  sofficePath = null;
  return null;
}

export const libreOfficeAvailable = () => sofficePath !== null;

const TARGETS = { pdf: 'pdf', docx: 'docx:"MS Word 2007 XML"', xlsx: 'xlsx', pptx: 'pptx' };

/** Convertit un fichier dans un dossier temporaire privé, puis supprime tout après lecture. */
export async function convertWithLibreOffice(buffer, originalName, target) {
  if (!sofficePath) throw Object.assign(new Error("LibreOffice n'est pas installé sur le serveur"), { status: 501 });
  const filter = TARGETS[target];
  if (!filter) throw Object.assign(new Error(`Format cible non pris en charge : ${target}`), { status: 400 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pagio-conv-'));
  const safe = path.basename(originalName || 'document').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || 'document';
  const input = path.join(dir, safe);
  try {
    fs.writeFileSync(input, buffer);
    const args = ['--headless', '--norestore', `-env:UserInstallation=file:///${dir.replace(/\\/g, '/')}/profile`];
    if (target === 'docx' && /\.pdf$/i.test(safe)) args.push('--infilter=writer_pdf_import');
    args.push('--convert-to', filter, '--outdir', dir, input);
    await new Promise((res, rej) => execFile(sofficePath, args, { timeout: 180_000 }, (err, _o, stderr) => (err ? rej(new Error(`Conversion impossible : ${stderr || err.message}`)) : res())));
    const outName = safe.replace(/\.[^.]+$/, '') + '.' + target;
    const out = path.join(dir, outName);
    if (!fs.existsSync(out)) throw new Error('LibreOffice n\'a produit aucun fichier');
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
