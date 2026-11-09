// Composants d'interface partagés du tableau de bord.
import { ReactNode, useEffect, useState } from 'react';

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && <header className="card-head"><h3>{title}</h3><div className="row gap">{actions}</div></header>}
      {children}
    </section>
  );
}

export function Kpi({ label, value, hint, tone = 'indigo' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string }) {
  return (
    <div className={`kpi tone-${tone}`}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      {hint && <span className="kpi-hint">{hint}</span>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <label className={`toggle ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track"><span className="thumb" /></span>
      {label && <span>{label}</span>}
    </label>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Badge({ children, tone = 'grey' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Alert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'success' | 'info' | 'warning' }) {
  return <div className={`alert alert-${tone}`}>{children}</div>;
}

/** Message temporaire de confirmation. */
export function useFlash(): [ReactNode, (msg: string, tone?: 'success' | 'error') => void] {
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t); }, [msg]);
  return [msg ? <div className={`flash flash-${msg.tone}`}>{msg.text}</div> : null, (text, tone = 'success') => setMsg({ text, tone })];
}

/** Histogramme en SVG, sans bibliothèque. */
export function BarChart({ data, height = 160, color = '#5B4BDB' }: { data: { label: string; value: number }[]; height?: number; color?: string }) {
  if (data.length === 0) return <div className="empty">Aucune donnée sur la période.</div>;
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100 / data.length;
  return (
    <div className="chart">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label="Graphique">
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2="100" y1={height * f} y2={height * f} className="grid" />)}
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 8);
          return <rect key={d.label} x={i * w + w * 0.15} width={w * 0.7} y={height - h} height={h} rx="0.8" fill={color}><title>{`${d.label} : ${d.value}`}</title></rect>;
        })}
      </svg>
      <div className="chart-axis"><span>{data[0].label}</span><span>max {max}</span><span>{data[data.length - 1].label}</span></div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div>; }
