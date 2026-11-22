// Outils PDF exécutés dans le navigateur (pdf-lib) : les fichiers ne quittent pas l'appareil.
// Lecture du texte d'un PDF (pdf.js) pour l'assistant IA : seul le texte est envoyé, à la demande de l'utilisateur.
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

export interface Out { name: string; bytes: Uint8Array; type: string }

const base = (name: string) => name.replace(/\.[^.]+$/, '');
const load = async (f: File) => PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: false });

/** « 1-3, 5, 8-10 » → indices de pages (0-based), dans l'ordre, sans doublons. Erreur lisible si invalide. */
export function parseRanges(spec: string, count: number): number[] {
  const out: number[] = [];
  for (const part of spec.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) throw new Error(`« ${part} » : écrivez par exemple 1-3, 5`);
    const a = Number(m[1]); const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a || b > count) throw new Error(`« ${part} » : le document a ${count} page(s)`);
    for (let i = a; i <= b; i++) if (!out.includes(i - 1)) out.push(i - 1);
  }
  if (!out.length) throw new Error('Indiquez au moins une page');
  return out;
}

export async function merge(files: File[]): Promise<Out> {
  const doc = await PDFDocument.create();
  for (const f of files) {
    const src = await load(f);
    for (const p of await doc.copyPages(src, src.getPageIndices())) doc.addPage(p);
  }
  return { name: 'fusion.pdf', bytes: await doc.save(), type: 'application/pdf' };
}

export async function extractPages(f: File, spec: string, keep: boolean): Promise<Out> {
  const src = await load(f);
  const chosen = parseRanges(spec, src.getPageCount());
  const indices = keep ? chosen : src.getPageIndices().filter((i) => !chosen.includes(i));
  if (!indices.length) throw new Error('Il ne resterait aucune page');
  const doc = await PDFDocument.create();
  for (const p of await doc.copyPages(src, indices)) doc.addPage(p);
  return { name: `${base(f.name)}_${keep ? 'extrait' : 'allege'}.pdf`, bytes: await doc.save(), type: 'application/pdf' };
}

export async function rotate(f: File, angle: number, spec: string): Promise<Out> {
  const doc = await load(f);
  const pages = doc.getPages();
  const which = spec.trim() ? parseRanges(spec, pages.length) : pages.map((_, i) => i);
  for (const i of which) pages[i].setRotation(degrees((pages[i].getRotation().angle + angle) % 360));
  return { name: `${base(f.name)}_pivote.pdf`, bytes: await doc.save(), type: 'application/pdf' };
}

export async function imagesToPdf(files: File[]): Promise<Out> {
  const doc = await PDFDocument.create();
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!isPng && !isJpg) throw new Error(`« ${f.name} » : seules les images JPG et PNG sont acceptées`);
    const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    // Page A4 dans le sens de l'image, image centrée sans déformation.
    const [w, h] = img.width > img.height ? [842, 595] : [595, 842];
    const s = Math.min(w / img.width, h / img.height);
    const page = doc.addPage([w, h]);
    page.drawImage(img, { x: (w - img.width * s) / 2, y: (h - img.height * s) / 2, width: img.width * s, height: img.height * s });
  }
  return { name: 'images.pdf', bytes: await doc.save(), type: 'application/pdf' };
}

export async function pageNumbers(f: File, position: 'bottom' | 'top', startAt: number): Promise<Out> {
  const doc = await load(f);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const label = `${i + startAt} / ${pages.length + startAt - 1}`;
    const { width, height } = p.getSize();
    const w = font.widthOfTextAtSize(label, 10);
    p.drawText(label, { x: (width - w) / 2, y: position === 'bottom' ? 22 : height - 30, size: 10, font, color: rgb(0.25, 0.25, 0.3) });
  });
  return { name: `${base(f.name)}_numerote.pdf`, bytes: await doc.save(), type: 'application/pdf' };
}

export async function watermark(f: File, text: string): Promise<Out> {
  if (!text.trim()) throw new Error('Saisissez le texte du filigrane');
  const doc = await load(f);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const p of doc.getPages()) {
    const { width, height } = p.getSize();
    const size = Math.min(width, height) / Math.max(6, text.length * 0.62);
    const w = font.widthOfTextAtSize(text, size);
    p.drawText(text, { x: width / 2 - (w / 2) * Math.cos(Math.PI / 4), y: height / 2 - (w / 2) * Math.sin(Math.PI / 4), size, font, color: rgb(0.86, 0.2, 0.2), opacity: 0.18, rotate: degrees(45) });
  }
  return { name: `${base(f.name)}_filigrane.pdf`, bytes: await doc.save(), type: 'application/pdf' };
}

/** Texte d'un PDF (pdf.js, chargé seulement quand on en a besoin). Limité pour rester dans les crédits de l'IA. */
export async function pdfText(f: File, maxChars = 60_000): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages && text.length < maxChars; i++) {
    const page = await doc.getPage(i);
    const c = await page.getTextContent();
    text += c.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n\n';
  }
  if (!text.trim()) throw new Error("Ce PDF ne contient pas de texte lisible (document scanné) : passez-le d'abord par l'OCR de l'application Android.");
  return text.slice(0, maxChars);
}
