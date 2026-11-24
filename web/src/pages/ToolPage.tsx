import { useEffect, useRef, useState } from 'react';
import { ApiError, Config, User, api, recordUse, session, usesToday } from '../api';
import { t } from '../i18n';
import * as pdf from '../pdf';
import { TOOLS, desc, title } from '../tools';

type Result = { kind: 'file'; out: pdf.Out; url: string } | { kind: 'text'; text: string };

export default function ToolPage({ id, config, user, onUser, go }: { id: string; config: Config | null; user: User | null; onUser: (u: User) => void; go: (p: string) => void }) {
  const tool = TOOLS.find((x) => x.id === id);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Options des outils
  const [pages, setPages] = useState('');
  const [angle, setAngle] = useState(90);
  const [text, setText] = useState('CONFIDENTIEL');
  const [position, setPosition] = useState<'bottom' | 'top'>('bottom');
  const [startAt, setStartAt] = useState(1);
  const [question, setQuestion] = useState('');
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => () => { if (result?.kind === 'file') URL.revokeObjectURL(result.url); }, [result]);
  if (!tool) return <p className="notice">Outil inconnu. <a href="/#outils">{t('back')}</a></p>;
  const flag = config?.tools[tool.id];
  const premium = user?.plan === 'premium';

  // Contrôles AVANT de commencer : compte, Premium, limite gratuite du jour.
  const blocker = (): string | null => {
    if (tool.where === 'server' && !user) return t('login_needed');
    if (flag?.premium && !premium) return t('premium_only');
    const limit = flag?.daily_free ?? 0;
    if (!premium && limit > 0 && usesToday(tool.id) >= limit) return t('limit_reached', limit);
    return null;
  };
  const blocked = blocker();

  const add = (list: FileList | null) => {
    if (!list) return;
    setResult(null); setError(null);
    const picked = Array.from(list);
    setFiles((prev) => (tool.multiple ? [...prev, ...picked] : picked.slice(0, 1)));
  };
  const move = (i: number, d: number) => setFiles((f) => { const n = [...f]; const j = i + d; if (j < 0 || j >= n.length) return f; [n[i], n[j]] = [n[j], n[i]]; return n; });

  async function run() {
    const why = blocker();
    if (why) { setError(why); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      let r: Result;
      const f = files[0];
      switch (tool!.id) {
        case 'merge': r = file(await pdf.merge(files)); break;
        case 'extract_pages': r = file(await pdf.extractPages(f, pages, true)); break;
        case 'delete_pages': r = file(await pdf.extractPages(f, pages, false)); break;
        case 'rotate': r = file(await pdf.rotate(f, angle, pages)); break;
        case 'images_to_pdf': r = file(await pdf.imagesToPdf(files)); break;
        case 'page_numbers': r = file(await pdf.pageNumbers(f, position, startAt)); break;
        case 'watermark': r = file(await pdf.watermark(f, text)); break;
        case 'office_to_pdf': {
          const resp = await fetch(`/api/convert?to=pdf&name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/octet-stream' }, body: f });
          if (!resp.ok) throw new ApiError(resp.status, (await resp.json().catch(() => ({}))).error || `Erreur ${resp.status}`);
          r = file({ name: f.name.replace(/\.[^.]+$/, '') + '.pdf', bytes: new Uint8Array(await resp.arrayBuffer()), type: 'application/pdf' });
          break;
        }
        case 'assistant': {
          const content = await pdf.pdfText(f);
          const ask = question.trim();
          const system = document.documentElement.lang === 'en'
            ? 'You are Pagio\'s document assistant. Answer in English, clearly and concisely, using only the document provided.'
            : "Tu es l'assistant de documents de Pagio. Réponds en français, clairement et brièvement, en t'appuyant uniquement sur le document fourni.";
          const prompt = (ask || (document.documentElement.lang === 'en' ? 'Summarise this document: key points, then a short conclusion.' : 'Résume ce document : points essentiels, puis une courte conclusion.')) + '\n\n---\n' + content;
          const a = await api<{ text: string; credits_left: number }>('POST', '/api/ai/complete', { system, messages: [{ role: 'user', content: prompt }] });
          setCredits(a.credits_left);
          if (user) onUser({ ...user, ai_credits: a.credits_left });
          r = { kind: 'text', text: a.text };
          break;
        }
        default: throw new Error('Outil indisponible');
      }
      recordUse(tool!.id);
      setResult(r);
    } catch (e) {
      const err = e as Error;
      setError(/password|encrypt/i.test(err.message) ? 'Ce PDF est protégé par un mot de passe : déverrouillez-le d\'abord.' : err.message);
    } finally { setBusy(false); }
  }
  const file = (out: pdf.Out): Result => ({ kind: 'file', out, url: URL.createObjectURL(new Blob([out.bytes], { type: out.type })) });

  const needsPages = tool.id === 'extract_pages' || tool.id === 'delete_pages';
  return (
    <section className="toolpage">
      <a className="back" href="/#outils">{t('back')}</a>
      <h1>{t(title(tool.id))}</h1>
      <p className="lead">{t(desc(tool.id))}</p>
      {blocked && <p className="notice warn">{blocked} {tool.where === 'server' && !user && <a href="#/connexion">{t('signin')} →</a>}</p>}

      <div className={`drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
        <input ref={input} type="file" accept={tool.accept} multiple={tool.multiple} hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        <button className="btn primary" onClick={() => input.current?.click()}>{t('choose')}</button>
        <span className="muted">{t('drop')}</span>
      </div>

      {files.length > 0 && (
        <ul className="files">
          {files.map((f, i) => (
            <li key={i}>
              <span className="name">{f.name}</span><span className="muted">{(f.size / 1048576).toFixed(1)} Mo</span>
              {tool.multiple && <><button className="icon" aria-label={t('up')} onClick={() => move(i, -1)}>↑</button><button className="icon" aria-label={t('down')} onClick={() => move(i, 1)}>↓</button></>}
              <button className="icon" aria-label={t('remove')} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>✕</button>
            </li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <div className="options">
          {(needsPages || tool.id === 'rotate') && <label>{t('pages_label')}{tool.id === 'rotate' && ' — vide = toutes'}<input value={pages} onChange={(e) => setPages(e.target.value)} placeholder="1-3, 5" /></label>}
          {tool.id === 'rotate' && <label>{t('angle')}<select value={angle} onChange={(e) => setAngle(Number(e.target.value))}><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option></select></label>}
          {tool.id === 'watermark' && <label>{t('text')}<input value={text} onChange={(e) => setText(e.target.value)} maxLength={40} /></label>}
          {tool.id === 'page_numbers' && <>
            <label>{t('position')}<select value={position} onChange={(e) => setPosition(e.target.value as 'bottom' | 'top')}><option value="bottom">{t('bottom')}</option><option value="top">{t('top')}</option></select></label>
            <label>{t('start_at')}<input type="number" min={1} value={startAt} onChange={(e) => setStartAt(Math.max(1, Number(e.target.value) || 1))} /></label>
          </>}
          {tool.id === 'assistant' && <label className="wide">{t('question')}<textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} /></label>}
          <button className="btn primary big" disabled={busy || !!blocked || (tool.id === 'merge' && files.length < 2) || (needsPages && !pages.trim())} onClick={run}>
            {busy ? t('working') : t('run')}
          </button>
        </div>
      )}

      {error && <p className="notice error">{error}</p>}
      {result?.kind === 'file' && (
        <div className="result">
          <a className="btn primary big" href={result.url} download={result.out.name}>⬇ {t('download')}</a>
          <span className="muted">{result.out.name} · {(result.out.bytes.length / 1048576).toFixed(2)} Mo</span>
          <button className="btn" onClick={() => { setFiles([]); setResult(null); }}>{t('again')}</button>
        </div>
      )}
      {result?.kind === 'text' && (
        <div className="result text">
          <h3>{t('answer')}</h3>
          <div className="answer">{result.text}</div>
          {credits !== null && <p className="muted">{t('credits_left', credits)}</p>}
        </div>
      )}
      {tool.where === 'server' && !user && <p className="muted"><a href="#/inscription" onClick={() => go('/inscription')}>{t('signup')}</a></p>}
    </section>
  );
}
