// Espace de travail d'un outil, affiché directement dans sa page du site (pagio.site/fusionner-pdf/…) :
// 1) dépôt des fichiers → 2) miniatures (loupe, croix, ordre, « + ») et réglages, bouton d'action fixé en bas →
// 3) traitement en cours, étape par étape → 4) résultat : télécharger, aperçu, supprimer, continuer avec un autre outil.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, Config, User, api, getConfig, me, recordUse, session, siteEvent, usesToday } from '../api';
import { lang, t } from '../i18n';
import * as pdf from '../pdf';
import * as p2 from '../pdf2';
import { Kind, extOf, fmtSize, handoff, kindOf, openPdf, pdfInfo, renderPage, takeHandoff, zipNames } from '../preview';
import { TOOLS } from '../tools';
import { FormFields, MetaEditor, OrganizeEditor, SignPad } from './Extra';

const L = lang === 'en';
const W = L ? {
  pick: 'Choose files', pickOne: 'Choose a file', drop: 'or drop them here', dropOne: 'or drop it here', local: 'Your files stay in your browser.', server: 'Processed by the Pagio server, then deleted.',
  chosen: (n: number) => `${n} file${n > 1 ? 's' : ''} selected`, reorder: 'Drag the thumbnails to change the order.', add: 'Add files', replace: 'Replace the file',
  settings: 'Settings', pages: (n: number) => `${n} page${n > 1 ? 's' : ''}`, view: 'Preview', remove: 'Remove', left: 'Move left', right: 'Move right',
  working: 'Working on it…', s_read: 'Reading your files', s_proc: 'Processing', s_ready: 'Preparing the download', s_send: 'Sending to the server', s_server: 'Processing on the server', s_get: 'Receiving the result',
  reading: (name: string, i: number, n: number) => `Reading ${name} (${i} of ${n})`,
  doneTitle: 'Your file is ready', doneTitleText: 'Your answer is ready', download: 'Download', again: 'Start over', back: 'Change settings', next: 'Continue with',
  del: 'Delete this result? You will go back to your files.', noPreview: 'No preview for this type of file: download it to open it.', page: (a: number, b: number) => `Page ${a} of ${b}`,
  zip: (n: number) => `${n} files in a ZIP archive`, close: 'Close', signin: 'Sign in', summary: (n: number, p: number) => `${n} file${n > 1 ? 's' : ''}${p ? ` · ${p} page${p > 1 ? 's' : ''}` : ''}`,
  ready: 'Ready', twoFiles: 'Add at least 2 files', credits: (n: number) => `${n} AI credits left`, unknown: 'Unknown tool.',
} : {
  pick: 'Choisir mes fichiers', pickOne: 'Choisir mon fichier', drop: 'ou glissez-les ici', dropOne: 'ou glissez-le ici', local: 'Vos fichiers restent dans votre navigateur.', server: 'Traité par le serveur Pagio, puis effacé.',
  chosen: (n: number) => `${n} fichier${n > 1 ? 's' : ''} choisi${n > 1 ? 's' : ''}`, reorder: 'Glissez les miniatures pour changer l’ordre.', add: 'Ajouter des fichiers', replace: 'Remplacer le fichier',
  settings: 'Réglages', pages: (n: number) => `${n} page${n > 1 ? 's' : ''}`, view: 'Aperçu', remove: 'Retirer', left: 'Vers la gauche', right: 'Vers la droite',
  working: 'C’est en cours…', s_read: 'Lecture de vos fichiers', s_proc: 'Traitement', s_ready: 'Préparation du téléchargement', s_send: 'Envoi au serveur', s_server: 'Traitement sur le serveur', s_get: 'Réception du résultat',
  reading: (name: string, i: number, n: number) => `Lecture de ${name} (${i} sur ${n})`,
  doneTitle: 'Votre fichier est prêt', doneTitleText: 'Votre réponse est prête', download: 'Télécharger', again: 'Recommencer', back: 'Changer les réglages', next: 'Continuer avec',
  del: 'Supprimer ce résultat ? Vous revenez à vos fichiers.', noPreview: 'Pas d’aperçu pour ce type de fichier : téléchargez-le pour l’ouvrir.', page: (a: number, b: number) => `Page ${a} sur ${b}`,
  zip: (n: number) => `${n} fichiers dans une archive ZIP`, close: 'Fermer', signin: 'Se connecter', summary: (n: number, p: number) => `${n} fichier${n > 1 ? 's' : ''}${p ? ` · ${p} page${p > 1 ? 's' : ''}` : ''}`,
  ready: 'Prêt', twoFiles: 'Ajoutez au moins 2 fichiers', credits: (n: number) => `Il vous reste ${n} crédits IA`, unknown: 'Outil inconnu.',
};

/** Verbe du bouton d'action, par outil. */
const ACTION: Record<string, [string, string]> = {
  merge: ['Fusionner', 'Merge'], split: ['Diviser', 'Split'], organize: ['Enregistrer l’ordre', 'Save the order'], extract_pages: ['Extraire', 'Extract'], delete_pages: ['Supprimer les pages', 'Delete pages'],
  rotate: ['Pivoter', 'Rotate'], images_to_pdf: ['Créer le PDF', 'Create the PDF'], page_numbers: ['Numéroter', 'Number pages'], watermark: ['Ajouter le filigrane', 'Add watermark'],
  extract_text: ['Extraire le texte', 'Extract text'], pdf_to_images: ['Convertir en images', 'Convert to images'], txt_to_pdf: ['Convertir en PDF', 'Convert to PDF'], create_pdf: ['Créer le PDF', 'Create the PDF'],
  header_footer: ['Ajouter', 'Add'], sign: ['Signer', 'Sign'], fill_forms: ['Remplir', 'Fill in'], metadata: ['Enregistrer', 'Save'], strip_metadata: ['Nettoyer', 'Clean'], id_card: ['Créer la page', 'Create the page'],
  compress: ['Compresser', 'Compress'], repair: ['Réparer', 'Repair'], protect: ['Protéger', 'Protect'], unlock: ['Déverrouiller', 'Unlock'], html_to_pdf: ['Convertir en PDF', 'Convert to PDF'],
  ocr: ['Lancer l’OCR', 'Run OCR'], pdf_to_word: ['Convertir en Word', 'Convert to Word'], pdf_to_ppt: ['Convertir en PowerPoint', 'Convert to PowerPoint'], office_to_pdf: ['Convertir en PDF', 'Convert to PDF'],
  assistant: ['Demander à l’IA', 'Ask the AI'],
};
/** Outils proposés après un PDF produit (« Continuer avec… »). */
const NEXT = ['compress', 'page_numbers', 'watermark', 'sign', 'protect', 'split', 'organize', 'header_footer', 'merge', 'pdf_to_word', 'ocr', 'assistant'];

interface Item { key: string; file: File; kind: Kind; info?: { pages: number; thumb: string } | null; url?: string }
interface Done { file: File; url: string; kind: Kind; info?: { pages: number; thumb: string } | null; zip?: string[]; text?: string; preview?: string; note?: string }
interface Prog { step: number; pct: number; now: string }

let seq = 0;
const ico = {
  up: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>,
  eye: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></svg>,
  x: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>,
  plus: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>,
  arrow: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  dl: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>,
  ok: <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5 10 17 19 7" /></svg>,
};

/** Envoi au serveur avec la progression réelle de l'envoi (fetch ne la donne pas). */
function sendFile(url: string, body: Blob, headers: Record<string, string>, onUp: (f: number) => void): Promise<{ blob: Blob; note: string | null }> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url); x.responseType = 'blob';
    Object.entries(headers).forEach(([k, v]) => x.setRequestHeader(k, v));
    x.upload.onprogress = (e) => { if (e.lengthComputable) onUp(e.loaded / e.total); };
    x.onload = async () => {
      if (x.status === 200) return resolve({ blob: x.response as Blob, note: x.getResponseHeader('x-pagio-note') });
      let msg = `Erreur ${x.status}`;
      try { msg = JSON.parse(await (x.response as Blob).text()).error || msg; } catch { /* réponse vide */ }
      reject(new ApiError(x.status, msg));
    };
    x.onerror = () => reject(new Error(L ? 'Connection lost. Check your internet and try again.' : 'Connexion interrompue. Vérifiez votre Internet et réessayez.'));
    x.send(body);
  });
}

export default function Workspace({ id }: { id: string }) {
  const tool = TOOLS.find((x) => x.id === id);
  const [config, setConfig] = useState<Config | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [links, setLinks] = useState<Record<string, { fr: string; en: string }>>({});
  const [items, setItems] = useState<Item[]>([]);
  const [stage, setStage] = useState<'pick' | 'work' | 'done'>('pick');
  const [prog, setProg] = useState<Prog>({ step: 0, pct: 0, now: '' });
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [view, setView] = useState<{ file: File; kind: Kind } | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragTo, setDragTo] = useState<number | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // Réglages des outils
  const [pages, setPages] = useState('');
  const [angle, setAngle] = useState(90);
  const [text, setText] = useState('CONFIDENTIEL');
  const [position, setPosition] = useState<'bottom' | 'top'>('bottom');
  const [startAt, setStartAt] = useState(1);
  const [question, setQuestion] = useState('');
  const [splitMode, setSplitMode] = useState<'ranges' | 'every'>('every');
  const [every, setEvery] = useState(1);
  const [imgFormat, setImgFormat] = useState<'jpg' | 'png'>('jpg');
  const [dpi, setDpi] = useState(150);
  const [textSize, setTextSize] = useState(11);
  const [blank, setBlank] = useState({ pages: 1, pattern: 'lined' as 'blank' | 'lined' | 'grid' | 'dots', format: 'A4' as 'A4' | 'A5' | 'Letter', landscape: false });
  const [hf, setHf] = useState<p2.HF>({ hl: '', hc: '', hr: '{date}', fl: '{fichier}', fc: '', fr: 'Page {n} / {p}', size: 9 });
  const [plan, setPlan] = useState<p2.PagePlan[]>([]);
  const [signature, setSignature] = useState<Uint8Array | null>(null);
  const [signAt, setSignAt] = useState({ page: 1, place: 'br' as 'br' | 'bl' | 'bc' | 'tr', width: 160 });
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [flatten, setFlatten] = useState(false);
  const [meta, setMeta] = useState<p2.Meta | null>(null);
  const [level, setLevel] = useState<'low' | 'medium' | 'high'>('medium');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [card, setCard] = useState({ size: 'real' as 'real' | 'large', copies: 1 as 1 | 2, gray: false });

  useEffect(() => {
    getConfig().then(setConfig).catch(() => setConfig(null));
    if (session.token) me().then(setUser).catch(() => setUser(null));
    fetch('/outils-liens.json').then((r) => r.json()).then(setLinks).catch(() => setLinks({}));
  }, []);

  const addFiles = useCallback((list: File[]) => {
    if (!tool || !list.length) return;
    setError(null);
    const fresh: Item[] = list.map((file) => ({ key: `f${++seq}`, file, kind: kindOf(file.name, file.type), url: kindOf(file.name, file.type) === 'image' ? URL.createObjectURL(file) : undefined }));
    setItems((prev) => (tool.multiple ? [...prev, ...fresh] : fresh.slice(0, 1)));
    setPlan([]); setMeta(null); setFormValues({});
    // Miniature et nombre de pages des PDF, l'un après l'autre (le premier apparaît vite).
    (async () => {
      for (const it of fresh) {
        if (it.kind !== 'pdf') continue;
        const info = await pdfInfo(it.file);
        setItems((prev) => prev.map((x) => (x.key === it.key ? { ...x, info } : x)));
      }
    })();
  }, [tool]);

  // Fichier transmis par l'outil précédent (« Continuer avec… »).
  useEffect(() => { if (tool) takeHandoff(tool.id).then((f) => { if (f) addFiles([f]); }); }, [tool, addFiles]);
  // Retour arrière du navigateur depuis le résultat : on revient aux fichiers.
  useEffect(() => {
    const f = () => { if (stage === 'done') setStage('pick'); };
    addEventListener('popstate', f); return () => removeEventListener('popstate', f);
  }, [stage]);
  useEffect(() => { if (stage !== 'pick') root.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [stage]);

  if (!tool) return <div className="pgw"><p className="pgw-notice err">{W.unknown}</p></div>;
  const flag = config?.tools[tool.id];
  const premium = user?.plan === 'premium';
  const files = items.map((x) => x.file);
  const noInput = tool.id === 'create_pdf';
  const needsPages = tool.id === 'extract_pages' || tool.id === 'delete_pages';
  const totalPages = items.reduce((n, x) => n + (x.info?.pages || 0), 0);

  const blocker = (): string | null => {
    if (flag && !flag.enabled) return L ? 'This tool is temporarily unavailable.' : 'Cet outil est momentanément indisponible.';
    if (tool.where === 'server' && !user) return t('login_needed');
    if (flag?.premium && !premium) return t('premium_only');
    const limit = flag?.daily_free ?? 0;
    if (!premium && limit > 0 && usesToday(tool.id) >= limit) return t('limit_reached', limit);
    return null;
  };
  const why = blocker();
  const signin = () => { try { sessionStorage.setItem('pagio.retour', location.pathname); } catch { /* indisponible */ } location.href = '/app/#/connexion'; };
  const remove = (k: string) => setItems((prev) => { const it = prev.find((x) => x.key === k); if (it?.url) URL.revokeObjectURL(it.url); return prev.filter((x) => x.key !== k); });
  const move = (from: number, to: number) => setItems((prev) => { if (to < 0 || to >= prev.length || from === to) return prev; const n = [...prev]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n; });
  const reset = () => { items.forEach((x) => x.url && URL.revokeObjectURL(x.url)); if (done) URL.revokeObjectURL(done.url); setItems([]); setDone(null); setStage('pick'); };

  const canRun = !why && (noInput || items.length > 0) && !(tool.id === 'merge' && items.length < 2) && !(needsPages && !pages.trim()) && !(tool.id === 'id_card' && items.length !== 2);

  async function run() {
    if (!tool) return;
    const block = blocker();
    if (block) { setError(block); if (block === t('limit_reached', flag?.daily_free ?? 0)) siteEvent('limit_reached', { tool: tool.id }); return; }
    setError(null); setStage('work');
    const server = tool.where === 'server';
    const started = Date.now();
    const stats = { tool: tool.id, files: files.length, bytes_in: files.reduce((n, x) => n + x.size, 0) };
    // Progression : monte doucement vers `cap` pendant les étapes sans mesure réelle.
    let cap = 0; let pct = 0; let step = 0; let now = '';
    const push = () => setProg({ step, pct: Math.round(pct), now });
    const timer = setInterval(() => { if (pct < cap) { pct += Math.max(0.4, (cap - pct) * 0.06); push(); } }, 120);
    const go = (s: number, c: number, label: string) => { step = s; cap = c; now = label; push(); };
    try {
      let out: pdf.Out | null = null; let answer: string | undefined; let preview: string | undefined; let note: string | undefined;
      const f = files[0];
      if (!server) {
        go(0, 5, W.s_read);
        for (let i = 0; i < files.length; i++) { now = W.reading(files[i].name, i + 1, files.length); await files[i].arrayBuffer(); pct = cap = 5 + (25 * (i + 1)) / files.length; push(); }
        go(1, 90, W.s_proc);
      }
      const srv = async (url: string, headers: Record<string, string> = {}) => {
        go(0, 0, W.s_send);
        const r = await sendFile(url, f, { authorization: `Bearer ${session.token}`, 'content-type': 'application/octet-stream', ...headers }, (x) => { pct = cap = 5 + 45 * x; now = `${W.s_send} · ${Math.round(x * 100)} %`; push(); });
        return r;
      };
      const serverStep = () => go(1, 92, W.s_server);
      switch (tool.id) {
        case 'merge': out = await pdf.merge(files); break;
        case 'extract_pages': out = await pdf.extractPages(f, pages, true); break;
        case 'delete_pages': out = await pdf.extractPages(f, pages, false); break;
        case 'rotate': out = await pdf.rotate(f, angle, pages); break;
        case 'images_to_pdf': out = await pdf.imagesToPdf(files); break;
        case 'page_numbers': out = await pdf.pageNumbers(f, position, startAt); break;
        case 'watermark': out = await pdf.watermark(f, text); break;
        case 'split': out = await p2.split(f, splitMode, pages, every); break;
        case 'organize': out = await p2.organize(f, plan); break;
        case 'extract_text': { const x = await p2.extractText(f); out = x.out; preview = x.text.slice(0, 6000); break; }
        case 'pdf_to_images': out = await p2.pdfToImages(f, imgFormat, dpi, pages); break;
        case 'txt_to_pdf': out = await p2.textToPdf(files, textSize); break;
        case 'create_pdf': out = await p2.createPdf(blank.pages, blank.pattern, blank.format, blank.landscape); break;
        case 'header_footer': out = await p2.headerFooter(f, hf); break;
        case 'sign': if (!signature) throw new Error(t('sign_needed')); out = await p2.sign(f, signature, signAt.page - 1, signAt.place, signAt.width); break;
        case 'fill_forms': out = await p2.fillForm(f, formValues, flatten); break;
        case 'metadata': if (!meta) throw new Error(t('working')); out = await p2.writeMeta(f, meta); break;
        case 'strip_metadata': out = await p2.stripMeta(f); break;
        case 'id_card': out = await p2.idCard(files[0], files[1], card); break;
        case 'compress': case 'repair': case 'protect': case 'unlock': case 'html_to_pdf': case 'ocr': {
          const op = tool.id;
          if (op === 'protect' && password.length < 4) throw new Error(t('pw_short'));
          if (op === 'protect' && password !== password2) throw new Error(t('pw_mismatch'));
          if (op === 'unlock' && !password) throw new Error(t('pw_needed'));
          const q = `name=${encodeURIComponent(f.name)}${op === 'compress' ? `&level=${level}` : ''}${op === 'ocr' ? `&lang=${L ? 'eng' : 'fra'}` : ''}`;
          const pending = srv(`/api/pdf/${op}?${q}`, op === 'protect' || op === 'unlock' ? { 'x-pdf-password': password } : {});
          const r = await pending.then((x) => { serverStep(); return x; });
          const bytes = new Uint8Array(await r.blob.arrayBuffer());
          const suffix = ({ compress: '_compresse', repair: '_repare', protect: '_protege', unlock: '_deverrouille', html_to_pdf: '', ocr: '_texte' } as Record<string, string>)[op];
          out = { name: f.name.replace(/\.[^.]+$/, '') + suffix + '.pdf', bytes, type: 'application/pdf' };
          if (op === 'compress') note = r.note === 'already_small' ? t('already_small') : t('gain', Math.round((1 - bytes.length / f.size) * 100));
          else if (r.note === 'rebuilt') note = t('rebuilt');
          break;
        }
        case 'pdf_to_word': case 'pdf_to_ppt': case 'office_to_pdf': {
          const to = tool.id === 'pdf_to_word' ? 'docx' : tool.id === 'pdf_to_ppt' ? 'pptx' : 'pdf';
          const r = await srv(`/api/convert?to=${to}&name=${encodeURIComponent(f.name)}`).then((x) => { serverStep(); return x; });
          const type = to === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : to === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : 'application/pdf';
          out = { name: f.name.replace(/\.[^.]+$/, '') + '.' + to, bytes: new Uint8Array(await r.blob.arrayBuffer()), type };
          if (to !== 'pdf') note = t('conv_note');
          break;
        }
        case 'assistant': {
          go(0, 30, W.s_read);
          const content = await pdf.pdfText(f);
          go(1, 92, W.s_server);
          const ask = question.trim();
          const system = L ? 'You are Pagio\'s document assistant. Answer in English, clearly and concisely, using only the document provided.'
            : "Tu es l'assistant de documents de Pagio. Réponds en français, clairement et brièvement, en t'appuyant uniquement sur le document fourni.";
          const prompt = (ask || (L ? 'Summarise this document: key points, then a short conclusion.' : 'Résume ce document : points essentiels, puis une courte conclusion.')) + '\n\n---\n' + content;
          const a = await api<{ text: string; credits_left: number }>('POST', '/api/ai/complete', { system, messages: [{ role: 'user', content: prompt }] });
          setCredits(a.credits_left); if (user) setUser({ ...user, ai_credits: a.credits_left });
          answer = a.text;
          out = { name: `${f.name.replace(/\.[^.]+$/, '')}_reponse.txt`, bytes: new TextEncoder().encode(a.text), type: 'text/plain;charset=utf-8' };
          break;
        }
        default: throw new Error('Outil indisponible');
      }
      go(2, 100, server ? W.s_get : W.s_ready);
      const file = new File([out!.bytes], out!.name, { type: out!.type });
      const kind = kindOf(file.name, file.type);
      const result: Done = { file, url: URL.createObjectURL(file), kind, text: answer, preview, note };
      if (kind === 'pdf') result.info = await pdfInfo(file);
      if (kind === 'zip') result.zip = await zipNames(file);
      // Laisse voir la fin de la progression (au moins un instant), puis le résultat.
      pct = 100; push();
      await new Promise((r) => setTimeout(r, Math.max(450, 1100 - (Date.now() - started))));
      recordUse(tool.id);
      siteEvent('tool_run', { ...stats, ok: true, ms: Date.now() - started });
      setDone(result); setStage('done');
      try { history.pushState({ pagio: 'resultat' }, '', '#resultat'); } catch { /* sans historique */ }
    } catch (e) {
      const err = e as Error;
      siteEvent('tool_run', { ...stats, ok: false, ms: Date.now() - started, error: err instanceof ApiError ? `http_${err.status}` : err.name });
      setError(/password|encrypt/i.test(err.message) ? (L ? 'This PDF is password protected: unlock it first.' : 'Ce PDF est protégé par un mot de passe : déverrouillez-le d’abord.') : err.message);
      setStage('pick');
    } finally { clearInterval(timer); }
  }

  const steps = tool.where === 'server' && tool.id !== 'assistant' ? [W.s_send, W.s_server, W.s_get] : tool.id === 'assistant' ? [W.s_read, W.s_server, W.s_ready] : [W.s_read, W.s_proc, W.s_ready];
  const action = ACTION[tool.id]?.[L ? 1 : 0] || t('run');
  const nextTools = done?.kind === 'pdf' ? NEXT.filter((n) => n !== tool.id && links[n] && TOOLS.some((x) => x.id === n)) : [];

  return (
    <div className="pgw" ref={root}>
      {stage === 'pick' && <>
        {why && <p className="pgw-notice warn">{why} {tool.where === 'server' && !user && <a href="/app/#/connexion" onClick={(e) => { e.preventDefault(); signin(); }}>{W.signin} →</a>}</p>}
        {error && <p className="pgw-notice err" role="alert">{error}</p>}
        <input ref={input} type="file" accept={tool.accept} multiple={tool.multiple} hidden onChange={(e) => { addFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />

        {!noInput && items.length === 0 && (
          <div className={`pgw-drop${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(Array.from(e.dataTransfer.files)); }}>
            <div className="pgw-ic">{ico.up}</div>
            <button type="button" className="pgw-pick" onClick={() => input.current?.click()}>{tool.multiple ? W.pick : W.pickOne}</button>
            <p>{tool.multiple ? W.drop : W.dropOne}</p>
            <small>{tool.where === 'server' ? W.server : W.local}</small>
          </div>
        )}

        {items.length > 0 && (
          <div onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setOver(false); addFiles(Array.from(e.dataTransfer.files)); } }}>
            <div className="pgw-head">
              <h3>{W.chosen(items.length)}</h3>
              <button type="button" className="pgw-plus" aria-label={tool.multiple ? W.add : W.replace} title={tool.multiple ? W.add : W.replace} onClick={() => input.current?.click()}>
                {ico.plus}<span className="pgw-badge">{items.length}</span>
              </button>
            </div>
            {tool.multiple && items.length > 1 && <p className="pgw-hint">{W.reorder}</p>}
            <div className="pgw-grid">
              {items.map((it, i) => (
                <div key={it.key} className={`pgw-card${dragFrom === i ? ' drag' : ''}${dragTo === i && dragFrom !== i ? ' target' : ''}`}
                  draggable={tool.multiple && items.length > 1}
                  onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={(e) => { if (dragFrom !== null) { e.preventDefault(); setDragTo(i); } }}
                  onDrop={(e) => { if (dragFrom !== null) { e.preventDefault(); e.stopPropagation(); move(dragFrom, i); } setDragFrom(null); setDragTo(null); }}
                  onDragEnd={() => { setDragFrom(null); setDragTo(null); }}>
                  <span className="pgw-tip">{fmtSize(it.file.size, lang)}{it.info ? ` · ${W.pages(it.info.pages)}` : ''}</span>
                  <Thumb item={it} />
                  {tool.multiple && items.length > 1 && <span className="pgw-num">{i + 1}</span>}
                  <div className="pgw-tools">
                    <button type="button" className="pgw-ib" aria-label={W.view} title={W.view} onClick={() => setView({ file: it.file, kind: it.kind })}>{ico.eye}</button>
                    <button type="button" className="pgw-ib x" aria-label={W.remove} title={W.remove} onClick={() => remove(it.key)}>{ico.x}</button>
                  </div>
                  <p className="pgw-name" title={it.file.name}>{it.file.name}</p>
                  <p className="pgw-meta">{fmtSize(it.file.size, lang)}{it.info ? ` · ${W.pages(it.info.pages)}` : ''}</p>
                  {tool.multiple && items.length > 1 && <div className="pgw-move">
                    <button type="button" aria-label={W.left} onClick={() => move(i, i - 1)}>‹</button>
                    <button type="button" aria-label={W.right} onClick={() => move(i, i + 1)}>›</button>
                  </div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {(items.length > 0 || noInput) && renderOptions()}

        {(items.length > 0 || noInput) && (
          <div className="pgw-bar">
            <div className="pgw-sum"><b>{t(`t_${tool.id}` as Parameters<typeof t>[0])}</b>{noInput ? W.ready : tool.id === 'merge' && items.length < 2 ? W.twoFiles : W.summary(items.length, totalPages)}</div>
            <button type="button" className="pgw-go" disabled={!canRun} onClick={run}>{action}{ico.arrow}</button>
          </div>
        )}
      </>}

      {stage === 'work' && (
        <div className="pgw-work" aria-live="polite">
          <div className="pgw-orb"><span>{prog.pct}%</span></div>
          <h3>{W.working}</h3>
          <p className="pgw-now">{prog.now}</p>
          <div className="pgw-track"><div style={{ width: `${prog.pct}%` }} /></div>
          <ul className="pgw-steps">{steps.map((s, i) => <li key={s} className={i < prog.step ? 'done' : i === prog.step ? 'on' : ''}><span className="pgw-dot" />{s}</li>)}</ul>
        </div>
      )}

      {stage === 'done' && done && (
        <div className="pgw-done">
          <div className="pgw-ok">{ico.ok}</div>
          <h3>{done.text ? W.doneTitleText : W.doneTitle}</h3>
          <p className="pgw-sub">{done.file.name} · {fmtSize(done.file.size, lang)}{done.info ? ` · ${W.pages(done.info.pages)}` : ''}{done.zip ? ` · ${W.zip(done.zip.length)}` : ''}</p>
          {done.text
            ? <div className="pgw-answer">{done.text}</div>
            : <div className="pgw-card">
              <Thumb item={{ key: 'r', file: done.file, kind: done.kind, info: done.info, url: done.kind === 'image' ? done.url : undefined }} />
              <div className="pgw-tools">
                <button type="button" className="pgw-ib" aria-label={W.view} title={W.view} onClick={() => setView({ file: done.file, kind: done.kind })}>{ico.eye}</button>
                <button type="button" className="pgw-ib x" aria-label={W.remove} title={W.remove} onClick={() => { if (confirm(W.del)) { URL.revokeObjectURL(done.url); setDone(null); setStage('pick'); } }}>{ico.x}</button>
              </div>
              <p className="pgw-name" title={done.file.name}>{done.file.name}</p>
            </div>}
          {done.preview && <pre className="pgw-text">{done.preview}</pre>}
          {done.note && <p className="pgw-notice" style={{ maxWidth: 560, margin: '16px auto 0' }}>{done.note}</p>}
          {credits !== null && <p className="pgw-sub" style={{ marginTop: 10 }}>{W.credits(credits)}</p>}
          <div><a className="pgw-dl" href={done.url} download={done.file.name} onClick={() => siteEvent('tool_download', { tool: tool.id })}>{ico.dl}{W.download}</a></div>
          <div className="pgw-links">
            <button type="button" className="pgw-ghost" onClick={() => setStage('pick')}>{W.back}</button>
            <button type="button" className="pgw-ghost" onClick={reset}>{W.again}</button>
          </div>
          {nextTools.length > 0 && <div className="pgw-next">
            <p>{W.next}</p>
            {nextTools.map((n) => <button key={n} type="button" className="pgw-chip" onClick={async () => {
              await handoff(n, done.file).catch(() => {});
              siteEvent('tool_next', { from: tool.id, to: n });
              location.href = links[n][L ? 'en' : 'fr'];
            }}>{t(`t_${n}` as Parameters<typeof t>[0])}</button>)}
          </div>}
        </div>
      )}

      {view && <Preview file={view.file} kind={view.kind} onClose={() => setView(null)} />}
    </div>
  );

  function renderOptions() {
    const f0 = files[0];
    const body = (
      <>
        {tool!.id === 'split' && <>
          <label>{t('split_mode')}<select value={splitMode} onChange={(e) => setSplitMode(e.target.value as 'ranges' | 'every')}><option value="every">{t('split_every')}</option><option value="ranges">{t('split_ranges')}</option></select></label>
          {splitMode === 'every' ? <label>{t('every_n')}<input type="number" min={1} value={every} onChange={(e) => setEvery(Math.max(1, Number(e.target.value) || 1))} /></label>
            : <label>{t('groups')}<input value={pages} onChange={(e) => setPages(e.target.value)} placeholder="1-3, 4-6, 7" /></label>}
        </>}
        {tool!.id === 'organize' && f0 && <OrganizeEditor file={f0} plan={plan} setPlan={setPlan} />}
        {tool!.id === 'pdf_to_images' && <>
          <label>{t('format')}<select value={imgFormat} onChange={(e) => setImgFormat(e.target.value as 'jpg' | 'png')}><option value="jpg">JPG</option><option value="png">PNG</option></select></label>
          <label>{t('resolution')}<select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}><option value={72}>72 dpi</option><option value={150}>150 dpi</option><option value={300}>300 dpi</option></select></label>
          <label>{t('pages_opt')}<input value={pages} onChange={(e) => setPages(e.target.value)} placeholder="1-3, 5" /></label>
        </>}
        {tool!.id === 'txt_to_pdf' && <label>{t('text_size')}<select value={textSize} onChange={(e) => setTextSize(Number(e.target.value))}>{[9, 10, 11, 12, 14].map((n) => <option key={n} value={n}>{n} pt</option>)}</select></label>}
        {tool!.id === 'create_pdf' && <>
          <label>{t('pattern')}<select value={blank.pattern} onChange={(e) => setBlank({ ...blank, pattern: e.target.value as typeof blank.pattern })}>
            <option value="blank">{t('p_blank')}</option><option value="lined">{t('p_lined')}</option><option value="grid">{t('p_grid')}</option><option value="dots">{t('p_dots')}</option></select></label>
          <label>{t('format')}<select value={blank.format} onChange={(e) => setBlank({ ...blank, format: e.target.value as typeof blank.format })}><option>A4</option><option>A5</option><option value="Letter">Letter</option></select></label>
          <label>{t('page_count')}<input type="number" min={1} max={200} value={blank.pages} onChange={(e) => setBlank({ ...blank, pages: Math.max(1, Number(e.target.value) || 1) })} /></label>
          <label className="check"><input type="checkbox" checked={blank.landscape} onChange={(e) => setBlank({ ...blank, landscape: e.target.checked })} />{t('landscape')}</label>
        </>}
        {tool!.id === 'header_footer' && <>
          {(['hl', 'hc', 'hr', 'fl', 'fc', 'fr'] as const).map((k) => <label key={k}>{t(({ hl: 'h_left', hc: 'h_center', hr: 'h_right', fl: 'f_left', fc: 'f_center', fr: 'f_right' } as const)[k])}<input value={hf[k]} onChange={(e) => setHf({ ...hf, [k]: e.target.value })} /></label>)}
          <p className="muted small wide">{t('hf_help')}</p>
        </>}
        {tool!.id === 'sign' && <>
          <SignPad onChange={setSignature} />
          <label>{t('sign_page')}<input type="number" min={1} value={signAt.page} onChange={(e) => setSignAt({ ...signAt, page: Math.max(1, Number(e.target.value) || 1) })} /></label>
          <label>{t('sign_place')}<select value={signAt.place} onChange={(e) => setSignAt({ ...signAt, place: e.target.value as typeof signAt.place })}>
            <option value="br">{t('pl_br')}</option><option value="bl">{t('pl_bl')}</option><option value="bc">{t('pl_bc')}</option><option value="tr">{t('pl_tr')}</option></select></label>
          <label>{t('sign_size')}<input type="number" min={60} max={400} value={signAt.width} onChange={(e) => setSignAt({ ...signAt, width: Number(e.target.value) || 160 })} /></label>
        </>}
        {tool!.id === 'fill_forms' && f0 && <><FormFields file={f0} values={formValues} setValues={setFormValues} />
          <label className="check"><input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />{t('flatten')}</label></>}
        {tool!.id === 'metadata' && f0 && <MetaEditor file={f0} meta={meta} setMeta={setMeta} />}
        {(needsPages || tool!.id === 'rotate') && <label>{t('pages_label')}{tool!.id === 'rotate' && (L ? ' — empty = all' : ' — vide = toutes')}<input value={pages} onChange={(e) => setPages(e.target.value)} placeholder="1-3, 5" /></label>}
        {tool!.id === 'rotate' && <label>{t('angle')}<select value={angle} onChange={(e) => setAngle(Number(e.target.value))}><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option></select></label>}
        {tool!.id === 'id_card' && <>
          <p className="muted small wide">{t('card_help')}</p>
          <label>{t('card_size')}<select value={card.size} onChange={(e) => setCard({ ...card, size: e.target.value as 'real' | 'large' })}><option value="real">{t('card_real')}</option><option value="large">{t('card_large')}</option></select></label>
          {card.size === 'real' && <label>{t('card_copies')}<select value={card.copies} onChange={(e) => setCard({ ...card, copies: Number(e.target.value) as 1 | 2 })}><option value={1}>1</option><option value={2}>2</option></select></label>}
          <label className="check"><input type="checkbox" checked={card.gray} onChange={(e) => setCard({ ...card, gray: e.target.checked })} />{t('card_gray')}</label>
        </>}
        {tool!.id === 'compress' && <label>{t('level')}<select value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>
          <option value="low">{t('lv_low')}</option><option value="medium">{t('lv_medium')}</option><option value="high">{t('lv_high')}</option></select></label>}
        {(tool!.id === 'protect' || tool!.id === 'unlock') && <label>{t('password')}<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
        {tool!.id === 'protect' && <label>{t('password2')}<input type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} /></label>}
        {tool!.id === 'protect' && <p className="muted small wide">{t('pw_help')}</p>}
        {tool!.id === 'watermark' && <label>{t('text')}<input value={text} onChange={(e) => setText(e.target.value)} maxLength={40} /></label>}
        {tool!.id === 'page_numbers' && <>
          <label>{t('position')}<select value={position} onChange={(e) => setPosition(e.target.value as 'bottom' | 'top')}><option value="bottom">{t('bottom')}</option><option value="top">{t('top')}</option></select></label>
          <label>{t('start_at')}<input type="number" min={1} value={startAt} onChange={(e) => setStartAt(Math.max(1, Number(e.target.value) || 1))} /></label>
        </>}
        {tool!.id === 'assistant' && <label className="wide">{t('question')}<textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} /></label>}
      </>
    );
    // Pas de cadre « Réglages » vide pour les outils sans option.
    const empty = ['merge', 'images_to_pdf', 'extract_text', 'strip_metadata', 'repair', 'html_to_pdf', 'ocr', 'pdf_to_word', 'pdf_to_ppt', 'office_to_pdf'].includes(tool!.id);
    return empty ? null : <div className="pgw-opts"><h4>{W.settings}</h4>{body}</div>;
  }
}

function Thumb({ item }: { item: Item }) {
  return (
    <div className="pgw-page">
      {item.kind === 'pdf' && item.info === undefined && <span className="pgw-load" />}
      {item.kind === 'pdf' && item.info && <img src={item.info.thumb} alt="" />}
      {item.kind === 'image' && item.url && <img src={item.url} alt="" />}
      {((item.kind === 'pdf' && item.info === null) || (item.kind !== 'pdf' && item.kind !== 'image')) && <span className="pgw-ext">{extOf(item.file.name) || 'PDF'}</span>}
    </div>
  );
}

/** Aperçu en grand (loupe) : pages d'un PDF une par une, image, texte, contenu d'une archive. */
function Preview({ file, kind, onClose }: { file: File; kind: Kind; onClose: () => void }) {
  const [n, setN] = useState(1);
  const [count, setCount] = useState(0);
  const [img, setImg] = useState<string | null>(null);
  const [txt, setTxt] = useState<string | null>(null);
  const [names, setNames] = useState<string[] | null>(null);
  const doc = useRef<Awaited<ReturnType<typeof openPdf>> | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') setN((x) => x + 1); if (e.key === 'ArrowLeft') setN((x) => Math.max(1, x - 1)); };
    addEventListener('keydown', esc);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', esc); document.body.style.overflow = prev; };
  }, [onClose]);
  useEffect(() => {
    let url: string | null = null;
    if (kind === 'pdf') openPdf(file).then((d) => { doc.current = d; setCount(d.numPages); }).catch(() => setTxt(W.noPreview));
    else if (kind === 'image') { url = URL.createObjectURL(file); setImg(url); }
    else if (kind === 'text') file.text().then((x) => setTxt(x.slice(0, 30000)));
    else if (kind === 'zip') zipNames(file).then(setNames);
    else setTxt(W.noPreview);
    return () => { if (url) URL.revokeObjectURL(url); doc.current?.destroy(); };
  }, [file, kind]);
  useEffect(() => {
    if (kind !== 'pdf' || !doc.current || !count) return;
    const p = Math.min(Math.max(1, n), count); if (p !== n) { setN(p); return; }
    setImg(null);
    renderPage(doc.current, p, Math.min(760, innerWidth - 60)).then(setImg).catch(() => setTxt(W.noPreview));
  }, [n, count, kind]);
  return (
    <div className="pgw-modal" role="dialog" aria-modal="true" aria-label={file.name} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pgw-sheet">
        <header><b title={file.name}>{file.name}</b><button type="button" className="pgw-ib" aria-label={W.close} onClick={onClose}>{ico.x}</button></header>
        <div className="pgw-view">
          {img && <img src={img} alt={kind === 'pdf' ? W.page(n, count) : file.name} />}
          {!img && kind === 'pdf' && !txt && <span className="pgw-page" style={{ width: 120, background: 'transparent', border: 0 }}><span className="pgw-load" /></span>}
          {txt && <pre>{txt}</pre>}
          {names && <ul>{names.map((x) => <li key={x}>{x}</li>)}</ul>}
        </div>
        {kind === 'pdf' && count > 1 && <footer>
          <button type="button" className="pgw-ghost" disabled={n <= 1} onClick={() => setN(n - 1)}>‹</button>
          <span>{W.page(n, count)}</span>
          <button type="button" className="pgw-ghost" disabled={n >= count} onClick={() => setN(n + 1)}>›</button>
        </footer>}
      </div>
    </div>
  );
}
