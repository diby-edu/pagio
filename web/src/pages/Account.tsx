import { useState } from 'react';
import { User, api } from '../api';
import { t } from '../i18n';

export default function Account({ user, onChanged, onSignOut }: { user: User; onChanged: () => void; onSignOut: () => void }) {
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const premium = user.plan === 'premium';
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
