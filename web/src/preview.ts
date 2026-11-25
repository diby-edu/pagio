// Aperçus des fichiers dans l'espace de travail : miniature de la première page, nombre de pages, rendu d'une page en
// grand (loupe), et passage d'un fichier d'un outil à l'autre (« Continuer avec… »). Tout reste dans le navigateur.
import { pdfjsDoc } from './pdf2';

export type Kind = 'pdf' | 'image' | 'text' | 'zip' | 'office' | 'other';

export function kindOf(name: string, type = ''): Kind {
  const n = name.toLowerCase();
  if (type === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|bmp)$/.test(n)) return 'image';
  if (/\.(txt|md|csv|html?)$/.test(n) || type.startsWith('text/')) return 'text';
  if (n.endsWith('.zip') || type === 'application/zip') return 'zip';
  if (/\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf)$/.test(n)) return 'office';
  return 'other';
}

export const extOf = (name: string) => (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] || '').toUpperCase();

export function fmtSize(bytes: number, lang: string): string {
  if (bytes < 1024) return `${bytes} ${lang === 'en' ? 'B' : 'o'}`;
  const ko = bytes / 1024;
  if (ko < 1024) return `${ko.toFixed(ko < 10 ? 1 : 0)} ${lang === 'en' ? 'KB' : 'Ko'}`;
  return `${(ko / 1024).toFixed(1)} ${lang === 'en' ? 'MB' : 'Mo'}`;
}

/** Miniature (image) de la première page et nombre de pages d'un PDF ; null si illisible (protégé, abîmé). */
export async function pdfInfo(f: Blob, width = 220): Promise<{ pages: number; thumb: string } | null> {
  try {
    const doc = await pdfjsDoc(f);
    const thumb = await renderPage(doc, 1, width);
    const pages = doc.numPages;
    doc.destroy();
    return { pages, thumb };
  } catch { return null; }
}

type Doc = Awaited<ReturnType<typeof pdfjsDoc>>;

/** Rend une page (1-based) en image de la largeur demandée (écran haute densité pris en compte). */
export async function renderPage(doc: Doc, n: number, width: number): Promise<string> {
  const page = await doc.getPage(n);
  const v1 = page.getViewport({ scale: 1 });
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const vp = page.getViewport({ scale: (width * ratio) / v1.width });
  const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas: c } as never).promise;
  return c.toDataURL('image/jpeg', 0.82);
}

export const openPdf = (f: Blob) => pdfjsDoc(f);

/** Noms des fichiers d'une archive ZIP produite par Pagio (sans compression). */
export async function zipNames(f: Blob): Promise<string[]> {
  const b = new Uint8Array(await f.arrayBuffer());
  const dv = new DataView(b.buffer);
  const out: string[] = [];
  let p = 0;
  while (p + 30 <= b.length && dv.getUint32(p, true) === 0x04034b50) {
    const size = dv.getUint32(p + 18, true); const nl = dv.getUint16(p + 26, true); const xl = dv.getUint16(p + 28, true);
    out.push(new TextDecoder().decode(b.subarray(p + 30, p + 30 + nl)));
    p += 30 + nl + xl + size;
  }
  return out;
}

// ---------------------------------------------------------------- Passage d'un fichier à l'outil suivant
// Le résultat est gardé quelques minutes dans le navigateur (IndexedDB) ; la page de l'outil suivant le reprend.
const DB = 'pagio-relais';
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('f');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function handoff(tool: string, file: File): Promise<void> {
  const db = await idb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction('f', 'readwrite');
    tx.objectStore('f').put({ tool, ts: Date.now(), name: file.name, type: file.type, blob: file }, 'next');
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
export async function takeHandoff(tool: string): Promise<File | null> {
  try {
    const db = await idb();
    const v = await new Promise<{ tool: string; ts: number; name: string; type: string; blob: Blob } | undefined>((res) => {
      const tx = db.transaction('f', 'readwrite');
      const st = tx.objectStore('f');
      const g = st.get('next');
      g.onsuccess = () => { res(g.result); st.delete('next'); };
      g.onerror = () => res(undefined);
    });
    if (!v || v.tool !== tool || Date.now() - v.ts > 10 * 60_000) return null;
    return new File([v.blob], v.name, { type: v.type });
  } catch { return null; }
}
