import { useEffect, useState } from 'react';
import { Config, User, getConfig, me, session } from './api';
import { Lang, lang as initialLang, setLang, t } from './i18n';
import Account from './pages/Account';
import Auth from './pages/Auth';
import Home from './pages/Home';
import ToolPage from './pages/ToolPage';

/** Navigation par l'adresse (#/, #/outil/merge, #/connexion, #/compte) : liens partageables, retour arrière du navigateur. */
const route = () => location.hash.replace(/^#/, '') || '/';

export default function App() {
  const [path, setPath] = useState(route);
  const [config, setConfig] = useState<Config | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [, setLangState] = useState<Lang>(initialLang);

  useEffect(() => { const f = () => { setPath(route()); window.scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  useEffect(() => { getConfig().then(setConfig).catch(() => setConfig(null)); }, []);
  const refreshUser = () => (session.token ? me().then(setUser).catch(() => setUser(null)) : Promise.resolve(setUser(null)));
  useEffect(() => { refreshUser(); }, []);

  const go = (p: string) => { location.hash = p; };
  const signedIn = (token: string, u: User) => { session.token = token; setUser(u); go('/'); };
  const signOut = () => { session.token = null; setUser(null); go('/'); };
  const switchLang = (l: Lang) => { setLang(l); setLangState(l); };

  let page;
  if (path.startsWith('/outil/')) page = <ToolPage id={path.slice(7)} config={config} user={user} onUser={setUser} go={go} />;
  else if (path === '/connexion' || path === '/inscription' || path === '/oubli') page = <Auth mode={path.slice(1) as 'connexion' | 'inscription' | 'oubli'} config={config} onSignedIn={signedIn} go={go} />;
  else if (path === '/compte') page = user ? <Account user={user} onChanged={refreshUser} onSignOut={signOut} /> : <Auth mode="connexion" config={config} onSignedIn={signedIn} go={go} />;
  else page = <Home config={config} user={user} go={go} />;

  return (
    <>
      <header className="top">
        <div className="wrap bar">
          <a className="brand" href="/"><img src="/favicon.svg" alt="" />Pagio</a>
          <nav>
            <a href="#/">{t('tools')}</a>
            {user ? <a href="#/compte">{t('account')}</a> : <a className="btn small" href="#/connexion">{t('signin')}</a>}
          </nav>
          <div className="lang" role="group" aria-label="Langue / Language">
            {(['fr', 'en'] as Lang[]).map((l) => <button key={l} type="button" aria-pressed={initialLangIs(l)} onClick={() => switchLang(l)}>{l.toUpperCase()}</button>)}
          </div>
        </div>
      </header>
      {config?.maintenance && <div className="wrap"><p className="notice warn">{config.maintenance_message || 'Maintenance en cours.'}</p></div>}
      <main className="wrap">{page}</main>
      <footer className="wrap foot">
        <span>© {new Date().getFullYear()} Pagio · KODY BUSINESS</span>
        <nav>
          <a href="/confidentialite/">{t('legal')}</a>
          <a href="/conditions/">{t('terms')}</a>
          <a href="/suppression-compte/">{t('del_page')}</a>
          <a href="/mentions-legales/">{t('notice')}</a>
          <a href="mailto:contact@pagio.site">contact@pagio.site</a>
        </nav>
      </footer>
    </>
  );
}

function initialLangIs(l: Lang) { return document.documentElement.lang === l; }
