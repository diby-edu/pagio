import { FormEvent, useEffect, useRef, useState } from 'react';
import { Config, User, api } from '../api';
import { t } from '../i18n';

type Mode = 'connexion' | 'inscription' | 'oubli';
interface GoogleId { accounts: { id: { initialize(o: object): void; renderButton(el: HTMLElement, o: object): void } } }
declare global { interface Window { google?: GoogleId } }

/** Bouton officiel « Continuer avec Google » (Google Identity Services), affiché seulement si l'identifiant client est réglé. */
function GoogleButton({ clientId, onCredential }: { clientId: string; onCredential: (c: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const render = () => {
      if (!window.google || !box.current) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: (r: { credential: string }) => onCredential(r.credential), ux_mode: 'popup' });
      window.google.accounts.id.renderButton(box.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', locale: document.documentElement.lang, width: 300 });
    };
    if (window.google) { render(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = render;
    document.head.appendChild(s);
  }, [clientId]);
  return <div ref={box} className="google" />;
}

export default function Auth({ mode, config, onSignedIn, go }: { mode: Mode; config: Config | null; onSignedIn: (token: string, u: User) => void; go: (p: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null); setInfo(null);
    try {
      if (mode === 'oubli') { const r = await api<{ message: string }>('POST', '/api/auth/forgot', { email }); setInfo(r.message || t('link_sent')); }
      else {
        const r = await api<{ token: string; user: User }>('POST', mode === 'inscription' ? '/api/auth/register' : '/api/auth/login', { email, password, name });
        onSignedIn(r.token, r.user);
      }
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function google(credential: string) {
    setBusy(true); setError(null);
    try { const r = await api<{ token: string; user: User }>('POST', '/api/auth/google', { credential }); onSignedIn(r.token, r.user); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  const heading = mode === 'inscription' ? t('signup_title') : mode === 'oubli' ? t('forgot_title') : t('signin_title');
  return (
    <section className="auth card">
      <h1>{heading}</h1>
      {mode !== 'oubli' && <p className="muted">{t('same_account')}</p>}
      {mode !== 'oubli' && config?.google_client_id && <>
        <GoogleButton clientId={config.google_client_id} onCredential={google} />
        <div className="or"><span>{t('or')}</span></div>
      </>}
      <form onSubmit={submit}>
        <label>{t('email')}<input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        {mode === 'inscription' && <label>{t('name')}<input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>}
        {mode !== 'oubli' && <label>{t('password')}<input type="password" required minLength={mode === 'inscription' ? 8 : 1} autoComplete={mode === 'inscription' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
        {error && <p className="notice error">{error}</p>}
        {info && <p className="notice ok">{info}</p>}
        <button className="btn primary big" disabled={busy || (mode === 'inscription' && config?.registration_open === false)}>
          {busy ? t('working') : mode === 'inscription' ? t('signup') : mode === 'oubli' ? t('send_link') : t('signin')}
        </button>
      </form>
      <div className="links">
        {mode === 'connexion' && <><a href="#/oubli">{t('forgot')}</a><a href="#/inscription">{t('no_account')}</a></>}
        {mode !== 'connexion' && <a href="#/connexion" onClick={() => go('/connexion')}>{t('have_account')}</a>}
      </div>
      {mode === 'inscription' && <p className="muted small">En créant un compte, vous acceptez les <a href="/conditions/">conditions d'utilisation</a> et la <a href="/confidentialite/">politique de confidentialité</a>.</p>}
    </section>
  );
}
