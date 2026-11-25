// Vague 1 des outils en ligne (étape 4) : tout se passe dans le navigateur, les fichiers ne quittent pas l'appareil.
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFName, PDFOptionList, PDFRadioGroup, PDFTextField, StandardFonts, degrees, rgb } from 'pdf-lib';
import { Out, parseRanges } from './pdf';

const base = (name: string) => name.replace(/\.[^.]+$/, '');
const load = async (f: File) => PDFDocument.load(await f.arrayBuffer());
const PDF = 'application/pdf';

// ---------------------------------------------------------------- ZIP (sans compression) pour les résultats multiples
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zip(files: { name: string; bytes: Uint8Array }[], name: string): Out {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  for (const f of files) {
    const n = enc.encode(f.name); const crc = crc32(f.bytes); const size = f.bytes.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, crc, true);
    h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, n.length, true);
    parts.push(new Uint8Array(h.buffer), n, f.bytes);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true);
    c.setUint32(20, size, true); c.setUint32(24, size, true); c.setUint16(28, n.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), n);
    offset += 30 + n.length + size;
  }
  const cs = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return { name, bytes: out, type: 'application/zip' };
}

// ---------------------------------------------------------------- Diviser
/** Par groupes « 1-3, 4-6 » (un fichier par groupe) ou toutes les N pages. */
export async function split(f: File, mode: 'ranges' | 'every', spec: string, every: number): Promise<Out> {
  const src = await load(f);
  const count = src.getPageCount();
  const groups: number[][] = [];
  if (mode === 'every') {
    const n = Math.max(1, Math.floor(every) || 1);
    for (let i = 0; i < count; i += n) groups.push(Array.from({ length: Math.min(n, count - i) }, (_, k) => i + k));
  } else {
    for (const part of spec.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)) groups.push(parseRanges(part, count));
  }
  if (groups.length === 0) throw new Error('Indiquez comment découper (ex. 1-3, 4-6)');
  const files = [];
  for (const [i, g] of groups.entries()) {
    const doc = await PDFDocument.create();
    for (const p of await doc.copyPages(src, g)) doc.addPage(p);
    files.push({ name: `${base(f.name)}_partie${i + 1}.pdf`, bytes: await doc.save() });
  }
  return files.length === 1 ? { ...files[0], type: PDF } : zip(files, `${base(f.name)}_parties.zip`);
}

// ---------------------------------------------------------------- Organiser (ordre, rotation, suppression)
export interface PagePlan { index: number; rotate: number }
export async function organize(f: File, plan: PagePlan[]): Promise<Out> {
  if (!plan.length) throw new Error('Gardez au moins une page');
  const src = await load(f);
  const doc = await PDFDocument.create();
  const pages = await doc.copyPages(src, plan.map((p) => p.index));
  pages.forEach((p, i) => { if (plan[i].rotate) p.setRotation(degrees((p.getRotation().angle + plan[i].rotate) % 360)); doc.addPage(p); });
  return { name: `${base(f.name)}_organise.pdf`, bytes: await doc.save(), type: PDF };
}

// ---------------------------------------------------------------- Lecture (pdf.js) : texte, miniatures, images de pages
export async function pdfjsDoc(f: Blob) {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
}
export async function extractText(f: File): Promise<{ out: Out; text: string }> {
  const doc = await pdfjsDoc(f);
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    text += `${i > 1 ? '\n' : ''}--- page ${i} ---\n`;
    let line = ''; let lastY: number | null = null;
    for (const it of c.items) {
      if (!('str' in it)) continue;
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) { text += line.trimEnd() + '\n'; line = ''; }
      line += it.str + (it.hasEOL ? '' : ' '); lastY = y;
    }
    text += line.trimEnd() + '\n';
  }
  if (!text.replace(/--- page \d+ ---/g, '').trim()) throw new Error("Ce PDF ne contient pas de texte (document scanné) : utilisez l'OCR de l'application Android.");
  return { out: { name: `${base(f.name)}.txt`, bytes: new TextEncoder().encode(text), type: 'text/plain;charset=utf-8' }, text };
}
const canvasToBytes = (c: HTMLCanvasElement, type: string, q = 0.9) => new Promise<Uint8Array>((res, rej) =>
  c.toBlob((b) => (b ? b.arrayBuffer().then((a) => res(new Uint8Array(a))) : rej(new Error('Image impossible à créer'))), type, q));
/** Chaque page en image JPG ou PNG (résolution au choix), un seul fichier ou un ZIP. */
export async function pdfToImages(f: File, format: 'jpg' | 'png', dpi: number, spec: string): Promise<Out> {
  const doc = await pdfjsDoc(f);
  const which = spec.trim() ? parseRanges(spec, doc.numPages) : Array.from({ length: doc.numPages }, (_, i) => i);
  const files = [];
  for (const i of which) {
    const page = await doc.getPage(i + 1);
    const vp = page.getViewport({ scale: dpi / 72 });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvas: c } as never).promise;
    files.push({ name: `${base(f.name)}_page${i + 1}.${format}`, bytes: await canvasToBytes(c, format === 'png' ? 'image/png' : 'image/jpeg') });
  }
  return files.length === 1 ? { ...files[0], type: format === 'png' ? 'image/png' : 'image/jpeg' } : zip(files, `${base(f.name)}_images.zip`);
}
/** Miniatures (pour Organiser et Signer). */
export async function thumbnails(f: File, width = 140): Promise<string[]> {
  const doc = await pdfjsDoc(f);
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / v1.width });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvas: c } as never).promise;
    out.push(c.toDataURL('image/jpeg', 0.7));
  }
  return out;
}

// ---------------------------------------------------------------- Texte en PDF, créer un PDF
/** Caractères hors de la police standard (émojis, alphabets non latins) remplacés, pour ne jamais échouer. */
const safe = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[–—]/g, '-')
  .replace(/\t/g, '    ').replace(/[^\x20-\x7E\xA0-\xFFŒœ€]/g, '?');
export async function textToPdf(files: File[], size: number): Promise<Out> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const [W, H, M] = [595, 842, 56]; const lh = size * 1.45;
  for (const f of files) {
    const lines: string[] = [];
    for (const raw of safe(await f.text()).split(/\r?\n/)) {
      let cur = '';
      for (const word of raw.split(' ')) {
        const tryLine = cur ? `${cur} ${word}` : word;
        if (font.widthOfTextAtSize(tryLine, size) > W - 2 * M && cur) { lines.push(cur); cur = word; } else cur = tryLine;
      }
      lines.push(cur);
    }
    let page = doc.addPage([W, H]); let y = H - M;
    for (const l of lines) {
      if (y < M) { page = doc.addPage([W, H]); y = H - M; }
      page.drawText(l, { x: M, y, size, font, color: rgb(0.1, 0.1, 0.12) }); y -= lh;
    }
  }
  return { name: files.length === 1 ? `${base(files[0].name)}.pdf` : 'textes.pdf', bytes: await doc.save(), type: PDF };
}
export async function createPdf(pages: number, pattern: 'blank' | 'lined' | 'grid' | 'dots', format: 'A4' | 'A5' | 'Letter', landscape: boolean): Promise<Out> {
  const sizes: Record<string, [number, number]> = { A4: [595.28, 841.89], A5: [419.53, 595.28], Letter: [612, 792] };
  let [w, h] = sizes[format]; if (landscape) [w, h] = [h, w];
  const doc = await PDFDocument.create();
  const c = rgb(0.75, 0.78, 0.86); const step = 22;
  for (let n = 0; n < Math.min(Math.max(1, pages), 200); n++) {
    const p = doc.addPage([w, h]);
    if (pattern === 'lined') for (let y = h - 60; y > 40; y -= step) p.drawLine({ start: { x: 40, y }, end: { x: w - 40, y }, thickness: 0.5, color: c });
    if (pattern === 'grid') {
      for (let y = h - 40; y > 40; y -= step / 1.5) p.drawLine({ start: { x: 40, y }, end: { x: w - 40, y }, thickness: 0.3, color: c });
      for (let x = 40; x < w - 40; x += step / 1.5) p.drawLine({ start: { x, y: 40 }, end: { x, y: h - 40 }, thickness: 0.3, color: c });
    }
    if (pattern === 'dots') for (let y = h - 40; y > 40; y -= step / 1.5) for (let x = 40; x < w - 40; x += step / 1.5) p.drawCircle({ x, y, size: 0.7, color: c });
  }
  return { name: `nouveau_${pattern}.pdf`, bytes: await doc.save(), type: PDF };
}

// ---------------------------------------------------------------- En-tête / pied de page
export interface HF { hl: string; hc: string; hr: string; fl: string; fc: string; fr: string; size: number }
/** Variables : {n} numéro de page, {p} nombre de pages, {date} date du jour, {fichier} nom du fichier. */
export async function headerFooter(f: File, o: HF): Promise<Out> {
  const doc = await load(f);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const date = new Date().toLocaleDateString(document.documentElement.lang === 'en' ? 'en-GB' : 'fr-FR');
  const fill = (t: string, i: number) => safe(t.replace(/\{n\}/g, String(i + 1)).replace(/\{p\}/g, String(pages.length)).replace(/\{date\}/g, date).replace(/\{fichier\}|\{file\}/g, base(f.name)));
  pages.forEach((p, i) => {
    const { width, height } = p.getSize();
    const put = (t: string, align: 'l' | 'c' | 'r', y: number) => {
      const s = fill(t, i); if (!s) return;
      const w = font.widthOfTextAtSize(s, o.size);
      const x = align === 'l' ? 36 : align === 'r' ? width - 36 - w : (width - w) / 2;
      p.drawText(s, { x, y, size: o.size, font, color: rgb(0.3, 0.3, 0.36) });
    };
    put(o.hl, 'l', height - 26); put(o.hc, 'c', height - 26); put(o.hr, 'r', height - 26);
    put(o.fl, 'l', 18); put(o.fc, 'c', 18); put(o.fr, 'r', 18);
  });
  return { name: `${base(f.name)}_entete.pdf`, bytes: await doc.save(), type: PDF };
}

// ---------------------------------------------------------------- Propriétés, nettoyage des métadonnées
export interface Meta { title: string; author: string; subject: string; keywords: string; creator: string; producer: string; created: string; modified: string; pages: number }
export async function readMeta(f: File): Promise<Meta> {
  const d = await PDFDocument.load(await f.arrayBuffer(), { updateMetadata: false });
  return {
    title: d.getTitle() ?? '', author: d.getAuthor() ?? '', subject: d.getSubject() ?? '', keywords: d.getKeywords() ?? '',
    creator: d.getCreator() ?? '', producer: d.getProducer() ?? '', created: d.getCreationDate()?.toLocaleString() ?? '',
    modified: d.getModificationDate()?.toLocaleString() ?? '', pages: d.getPageCount(),
  };
}
export async function writeMeta(f: File, m: Pick<Meta, 'title' | 'author' | 'subject' | 'keywords'>): Promise<Out> {
  const d = await load(f);
  d.setTitle(m.title); d.setAuthor(m.author); d.setSubject(m.subject); d.setKeywords(m.keywords.split(',').map((k) => k.trim()).filter(Boolean));
  return { name: `${base(f.name)}.pdf`, bytes: await d.save(), type: PDF };
}
export async function stripMeta(f: File): Promise<Out> {
  const d = await PDFDocument.load(await f.arrayBuffer(), { updateMetadata: false });
  d.setTitle(''); d.setAuthor(''); d.setSubject(''); d.setKeywords([]); d.setCreator(''); d.setProducer('');
  const info = d.context.trailerInfo.Info; if (info) d.context.trailerInfo.Info = undefined;
  d.catalog.delete(PDFName.of('Metadata')); // XMP
  d.catalog.delete(PDFName.of('OpenAction')); d.catalog.delete(PDFName.of('AA')); // actions et scripts automatiques
  const names = d.catalog.lookup(PDFName.of('Names'));
  if (names && 'delete' in names) (names as unknown as { delete: (n: PDFName) => void }).delete(PDFName.of('JavaScript'));
  return { name: `${base(f.name)}_nettoye.pdf`, bytes: await d.save({ updateFieldAppearances: false }), type: PDF };
}

// ---------------------------------------------------------------- Signer, remplir un formulaire
/** Signature dessinée (PNG) posée sur une page, à l'emplacement choisi. */
export async function sign(f: File, png: Uint8Array, pageIdx: number, place: 'br' | 'bl' | 'bc' | 'tr', widthPt: number): Promise<Out> {
  const d = await load(f);
  const img = await d.embedPng(png);
  const p = d.getPages()[Math.min(pageIdx, d.getPageCount() - 1)];
  const { width, height } = p.getSize();
  const w = Math.min(widthPt, width - 72); const h = (img.height / img.width) * w;
  const x = place === 'bl' ? 36 : place === 'bc' ? (width - w) / 2 : width - 36 - w;
  const y = place === 'tr' ? height - 36 - h : 48;
  p.drawImage(img, { x, y, width: w, height: h });
  return { name: `${base(f.name)}_signe.pdf`, bytes: await d.save(), type: PDF };
}
export interface Field { name: string; type: 'text' | 'check' | 'choice' | 'radio'; value: string; options: string[] }
export async function readFields(f: File): Promise<Field[]> {
  const form = (await load(f)).getForm();
  return form.getFields().map((x) => {
    // instanceof (et non le nom de la classe, raccourci une fois le site construit)
    const name = x.getName();
    if (x instanceof PDFCheckBox) return { name, type: 'check', value: x.isChecked() ? 'oui' : '', options: [] };
    if (x instanceof PDFDropdown || x instanceof PDFOptionList) { const dd = x; return { name, type: 'choice', value: dd.getSelected()[0] ?? '', options: dd.getOptions() }; }
    if (x instanceof PDFRadioGroup) { const r = x; return { name, type: 'radio', value: r.getSelected() ?? '', options: r.getOptions() }; }
    if (x instanceof PDFTextField) return { name, type: 'text', value: x.getText() ?? '', options: [] };
    return null;
  }).filter(Boolean) as Field[];
}
export async function fillForm(f: File, values: Record<string, string>, flatten: boolean): Promise<Out> {
  const d = await load(f);
  const form = d.getForm();
  for (const x of form.getFields()) {
    const name = x.getName(); const v = values[name]; if (v === undefined) continue;
    if (x instanceof PDFTextField) x.setText(safe(v));
    else if (x instanceof PDFCheckBox) { if (v) x.check(); else x.uncheck(); }
    else if (x instanceof PDFDropdown && v) x.select(v);
    else if (x instanceof PDFOptionList && v) x.select(v);
    else if (x instanceof PDFRadioGroup && v) x.select(v);
  }
  if (flatten) form.flatten();
  return { name: `${base(f.name)}_rempli.pdf`, bytes: await d.save(), type: PDF };
}

// ---------------------------------------------------------------- Étape 5 : carte d'identité recto verso sur une page
// Les deux faces sont posées à la taille réelle d'une carte (85,6 × 54 mm) sur une page A4, comme une photocopie.
const MM = 72 / 25.4;
async function cardImage(f: File, gray: boolean): Promise<Uint8Array> {
  const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }).catch(() => { throw new Error(`Image illisible : ${f.name}`); });
  // Photo prise en hauteur : on la couche pour qu'elle ait le sens d'une carte.
  const turn = bmp.height > bmp.width;
  const w = turn ? bmp.height : bmp.width; const h = turn ? bmp.width : bmp.height;
  const scale = Math.min(1, 2000 / w);
  const c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  if (gray) ctx.filter = 'grayscale(1)';
  if (turn) { ctx.translate(c.width, 0); ctx.rotate(Math.PI / 2); }
  ctx.drawImage(bmp, 0, 0, turn ? c.height : c.width, turn ? c.width : c.height);
  bmp.close();
  return canvasToBytes(c, 'image/jpeg', 0.9);
}
export async function idCard(recto: File, verso: File, o: { size: 'real' | 'large'; copies: 1 | 2; gray: boolean }): Promise<Out> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const faces = [await doc.embedJpg(await cardImage(recto, o.gray)), await doc.embedJpg(await cardImage(verso, o.gray))];
  const boxW = (o.size === 'real' ? 85.6 : 128) * MM; const boxH = (o.size === 'real' ? 54 : 81) * MM;
  const cols = o.size === 'real' ? o.copies : 1;
  const gapX = 15 * MM; const gapY = 20 * MM;
  const totalW = cols * boxW + (cols - 1) * gapX; const totalH = 2 * boxH + gapY;
  const x0 = (595.28 - totalW) / 2; const yTop = (841.89 + totalH) / 2;
  for (let col = 0; col < cols; col++) {
    faces.forEach((img, i) => {
      // L'image garde ses proportions dans le cadre de la carte, centrée.
      const s = Math.min(boxW / img.width, boxH / img.height);
      const w = img.width * s; const h = img.height * s;
      const bx = x0 + col * (boxW + gapX); const by = yTop - (i + 1) * boxH - i * gapY;
      page.drawImage(img, { x: bx + (boxW - w) / 2, y: by + (boxH - h) / 2, width: w, height: h });
    });
  }
  doc.setTitle('Carte recto verso'); doc.setProducer('Pagio'); doc.setCreator('Pagio');
  return { name: 'carte-recto-verso.pdf', bytes: await doc.save(), type: PDF };
}
