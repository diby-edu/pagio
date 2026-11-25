import { useEffect, useState } from 'react';
import { User, api } from '../api';
import { t } from '../i18n';

export default function Account({ user, onChanged, onSignOut }: { user: User; onChanged: () => void; onSignOut: () => void }) {
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const premium = user.plan === 'premium';
  const [code, setCode] = useState('');
  const [ref, setRef] = useState<{ enabled: boolean; link: string; referrer_days: number; invited: number; rewarded: number } | null>(null);
  useEffect(() => { api<typeof ref>('GET', '/api/me/referral').then(setRef).catch(() => {}); }, []);
  return (
    <section className="account card">
      <h1>{t('account')}</h1>
      <div className="kv">
        <span>{t('email')}</span><b>{user.email}</b>
        {user.name && <><span>{t('name').replace(/ \(.*\)/, '')}</span><b>{user.name}</b></>}
        <span>{t('plan')}</span><b>{premium ? (user.premium_until ? t('premium_until', new Date(user.premium_until).toLocaleDateString()) : 'Premium') : t('free')}</b>
        <span>{t('ai_credits')}</span><b>{user.ai_credits}</b>
        <span>Confirmation</span><b>{user.email_verified ? `✔ ${t('email_ok')}` : `✘ ${t('email_ko')}`}</b>
      </div>
      {!user.email_verified && <button className="btn" onClick={async () => {
        try { const r = await api<{ message: string }>('POST', '/api/auth/resend-verification'); setMsg({ text: r.message || t('verify_sent'), tone: 'ok' }); }
        catch (e) { setMsg({ text: (e as Error).message, tone: 'error' }); }
      }}>{t('resend')}</button>}
      {msg && <p className={`notice ${msg.tone}`}>{msg.text}</p>}
      <h2 style={{ fontSize: '1.05rem', marginTop: 18 }}>{t('promo_title')}</h2>
      <div className="row">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={t('promo_ph')} maxLength={30} style={{ flex: 1 }} />
        <button className="btn" disabled={code.trim().length < 3} onClick={async () => {
          try { const r = await api<{ message: string }>('POST', '/api/me/redeem', { code }); setMsg({ text: r.message, tone: 'ok' }); setCode(''); onChanged(); }
          catch (e) { setMsg({ text: (e as Error).message, tone: 'error' }); }
        }}>{t('promo_btn')}</button>
      </div>
      {ref?.enabled && <>
        <h2 style={{ fontSize: '1.05rem', marginTop: 18 }}>{t('ref_title')}</h2>
        <p className="muted">{t('ref_text', ref.referrer_days)}</p>
        <div className="row"><input readOnly value={ref.link} style={{ flex: 1 }} onFocus={(e) => e.target.select()} />
          <button className="btn" onClick={() => navigator.clipboard?.writeText(ref.link).then(() => setMsg({ text: t('copied'), tone: 'ok' }))}>{t('copy')}</button></div>
        <p><a className="btn" href={`https://wa.me/?text=${encodeURIComponent(`${t('share_msg')} ${ref.link}`)}`} target="_blank" rel="noreferrer">{t('share_wa')}</a></p>
        <p className="muted small">{t('ref_stats', ref.invited, ref.rewarded)}</p>
      </>}
      <div className="row">
        <button className="btn" onClick={onSignOut}>{t('signout')}</button>
        <button className="btn danger" onClick={async () => {
          if (!confirm(t('delete_confirm'))) return;
          try { await api('DELETE', '/api/me'); onSignOut(); } catch (e) { setMsg({ text: (e as Error).message, tone: 'error' }); }
        }}>{t('delete_account')}</button>
      </div>
      <button className="link" onClick={onChanged}>↻</button>
    </section>
  );
}
