// Réglages des outils de la vague 1 qui demandent plus qu'un champ : miniatures (Organiser), signature à dessiner,
// champs de formulaire, propriétés du document.
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import * as p2 from '../pdf2';

/** Organiser : miniatures dans l'ordre choisi ; déplacer, pivoter, retirer. */
export function OrganizeEditor({ file, plan, setPlan }: { file: File; plan: p2.PagePlan[]; setPlan: (p: p2.PagePlan[]) => void }) {
  const [thumbs, setThumbs] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    p2.thumbnails(file).then((list) => { if (!live) return; setThumbs(list); setPlan(list.map((_, i) => ({ index: i, rotate: 0 }))); }).catch((e) => setError(e.message));
    return () => { live = false; };
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <p className="notice error">{error}</p>;
  if (!thumbs) return <p className="muted">{t('working')}</p>;
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= plan.length) return; const n = [...plan]; [n[i], n[j]] = [n[j], n[i]]; setPlan(n); };
  return (
    <div className="thumbs wide">
      {plan.map((p, i) => (
        <figure key={`${p.index}-${i}`} className="thumb">
          <img src={thumbs[p.index]} alt={`${t('page')} ${p.index + 1}`} style={{ transform: `rotate(${p.rotate}deg)` }} />
          <figcaption>{i + 1} <span className="muted">({t('page')} {p.index + 1})</span></figcaption>
          <div className="thumb-actions">
            <button className="icon" aria-label={t('up')} onClick={() => move(i, -1)}>←</button>
            <button className="icon" aria-label={t('angle')} onClick={() => setPlan(plan.map((q, j) => (j === i ? { ...q, rotate: (q.rotate + 90) % 360 } : q)))}>↻</button>
            <button className="icon" aria-label={t('remove')} onClick={() => setPlan(plan.filter((_, j) => j !== i))}>✕</button>
            <button className="icon" aria-label={t('down')} onClick={() => move(i, 1)}>→</button>
          </div>
        </figure>
      ))}
    </div>
  );
}

/** Signature dessinée au doigt ou à la souris ; renvoie une image PNG transparente. */
export function SignPad({ onChange }: { onChange: (png: Uint8Array | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [(e.clientX - r.left) * (ref.current!.width / r.width), (e.clientY - r.top) * (ref.current!.height / r.height)]; };
  const export_ = () => ref.current!.toBlob((b) => b?.arrayBuffer().then((a) => onChange(new Uint8Array(a))), 'image/png');
  const clear = () => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setEmpty(true); onChange(null); };
  return (
    <div className="wide">
      <canvas ref={ref} width={600} height={220} className="signpad" aria-label={t('sign_here')}
        onPointerDown={(e) => { drawing.current = true; ref.current!.setPointerCapture(e.pointerId); const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); }}
        onPointerMove={(e) => { if (!drawing.current) return; const ctx = ref.current!.getContext('2d')!; ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#14152b'; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); setEmpty(false); }}
        onPointerUp={() => { drawing.current = false; export_(); }} />
      <div className="row"><span className="muted small">{t('sign_here')}</span>{!empty && <button className="btn" onClick={clear}>{t('clear')}</button>}</div>
    </div>
  );
}

/** Remplir un formulaire : un champ par zone du PDF. */
export function FormFields({ file, values, setValues }: { file: File; values: Record<string, string>; setValues: (v: Record<string, string>) => void }) {
  const [fields, setFields] = useState<p2.Field[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    p2.readFields(file).then((list) => { setFields(list); setValues(Object.fromEntries(list.map((f) => [f.name, f.value]))); }).catch((e) => setError(e.message));
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <p className="notice error">{error}</p>;
  if (!fields) return <p className="muted">{t('working')}</p>;
  if (fields.length === 0) return <p className="notice warn wide">{t('no_fields')}</p>;
  return (
    <div className="form-fields wide">
      {fields.map((f) => (
        <label key={f.name}>{f.name}
          {f.type === 'text' && <input value={values[f.name] ?? ''} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />}
          {f.type === 'check' && <input type="checkbox" checked={!!values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.checked ? 'oui' : '' })} />}
          {(f.type === 'choice' || f.type === 'radio') && <select value={values[f.name] ?? ''} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}><option value="">—</option>{f.options.map((o) => <option key={o}>{o}</option>)}</select>}
        </label>
      ))}
    </div>
  );
}

/** Propriétés : lecture puis modification du titre, de l'auteur, du sujet et des mots-clés. */
export function MetaEditor({ file, meta, setMeta }: { file: File; meta: p2.Meta | null; setMeta: (m: p2.Meta) => void }) {
  const [error, setError] = useState('');
  useEffect(() => { p2.readMeta(file).then(setMeta).catch((e) => setError(e.message)); }, [file]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <p className="notice error">{error}</p>;
  if (!meta) return <p className="muted">{t('working')}</p>;
  const set = (k: keyof p2.Meta, v: string) => setMeta({ ...meta, [k]: v });
  return (
    <>
      {(['title', 'author', 'subject', 'keywords'] as const).map((k) => <label key={k}>{t(`m_${k}` as Parameters<typeof t>[0])}<input value={meta[k] as string} onChange={(e) => set(k, e.target.value)} /></label>)}
      <p className="muted small wide">{t('m_info', meta.pages, meta.creator || '—', meta.producer || '—', meta.created || '—')}</p>
    </>
  );
}
