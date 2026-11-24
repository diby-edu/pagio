import { useEffect, useState } from 'react';
import { Admin, api, session, setUnauthorizedHandler } from './api';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Users from './pages/Users';
import Tools from './pages/Tools';
import Plans from './pages/Plans';
import AiSettings from './pages/AiSettings';
import AppControl from './pages/AppControl';
import Feedback from './pages/Feedback';
import Events from './pages/Events';
import Audit from './pages/Audit';
import Admins from './pages/Admins';
import System from './pages/System';
import Account from './pages/Account';
import Backups from './pages/Backups';
import Errors from './pages/Errors';
import Conversions from './pages/Conversions';
import AiUsage from './pages/AiUsage';
import Mail from './pages/Mail';

type Go = (page: string) => void;
type Page = { id: string; label: string; icon: string; min: Admin['role']; el: (a: Admin, go: Go) => JSX.Element };
const RANK = { support: 1, admin: 2, owner: 3 } as const;

const PAGES: Page[] = [
  { id: 'overview', label: "Vue d'ensemble", icon: '◧', min: 'support', el: (_a, go) => <Overview go={go} /> },
  { id: 'users', label: 'Utilisateurs', icon: '◉', min: 'support', el: (a) => <Users admin={a} /> },
  { id: 'tools', label: 'Outils et limites', icon: '▦', min: 'support', el: (a) => <Tools admin={a} /> },
  { id: 'plans', label: 'Offres et crédits', icon: '★', min: 'admin', el: () => <Plans /> },
  { id: 'ai', label: 'Intelligence artificielle', icon: '✦', min: 'admin', el: () => <AiSettings /> },
  { id: 'aiusage', label: 'Consommation IA', icon: '◔', min: 'support', el: () => <AiUsage /> },
  { id: 'conversions', label: 'Conversions', icon: '⇄', min: 'support', el: () => <Conversions /> },
  { id: 'app', label: "Pilotage de l'application", icon: '⚙', min: 'admin', el: () => <AppControl /> },
  { id: 'mail', label: 'E-mails', icon: '@', min: 'admin', el: (a) => <Mail admin={a} /> },
  { id: 'feedback', label: 'Avis et support', icon: '✉', min: 'support', el: () => <Feedback /> },
  { id: 'events', label: 'Événements', icon: '≡', min: 'support', el: () => <Events /> },
  { id: 'errors', label: 'Erreurs du serveur', icon: '⚠', min: 'admin', el: (a) => <Errors admin={a} /> },
  { id: 'audit', label: "Journal d'audit", icon: '⌂', min: 'admin', el: () => <Audit /> },
  { id: 'admins', label: 'Administrateurs', icon: '⚑', min: 'owner', el: (a) => <Admins admin={a} /> },
  { id: 'backups', label: 'Sauvegardes', icon: '⛃', min: 'admin', el: (a) => <Backups admin={a} /> },
  { id: 'system', label: 'Système', icon: '⛁', min: 'admin', el: (_a, go) => <System go={go} /> },
  { id: 'account', label: 'Mon compte et sécurité', icon: '☺', min: 'support', el: (a) => <Account admin={a} /> },
];

export default function App() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [checking, setChecking] = useState(!!session.token);
  const [page, setPage] = useState(() => location.hash.slice(1) || 'overview');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => setAdmin(null));
    if (!session.token) return;
    api<{ admin: Admin }>('GET', '/api/admin/me').then((r) => setAdmin(r.admin)).catch(() => setAdmin(null)).finally(() => setChecking(false));
  }, []);
  // Dans l'APK admin : une fois connecté, le téléphone reçoit sa clé de notification (une seule fois).
  useEffect(() => {
    const bridge = window.PagioAdmin;
    if (!admin || !bridge || bridge.hasNotifyKey()) return;
    api<{ token: string }>('POST', '/api/admin/notify/devices', { name: bridge.deviceName() })
      .then((r) => bridge.setNotifyKey(r.token, admin.email)).catch(() => {});
  }, [admin]);
  useEffect(() => { location.hash = page; setMenuOpen(false); }, [page]);
  // Une adresse saisie ou un retour arrière du navigateur change aussi de page.
  useEffect(() => {
    const onHash = () => setPage(location.hash.slice(1) || 'overview');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (checking) return <div className="splash">Connexion…</div>;
  if (!admin) return <Login onLogin={setAdmin} />;

  const visible = PAGES.filter((p) => RANK[admin.role] >= RANK[p.min]);
  const current = visible.find((p) => p.id === page) ?? visible[0];

  return (
    <div className={`layout ${menuOpen ? 'menu-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand"><img src="./favicon.svg" alt="" /><div><strong>Pagio</strong><span>Administration</span></div>
          <button className="btn ghost menu-close" onClick={() => setMenuOpen(false)} aria-label="Fermer le menu">✕</button></div>
        <nav>
          {visible.map((p) => (
            <button key={p.id} className={p.id === current.id ? 'active' : ''} onClick={() => { setPage(p.id); setMenuOpen(false); }}>
              <span className="nav-icon" aria-hidden>{p.icon}</span>{p.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="who"><strong>{admin.name || admin.email}</strong><span>{admin.email} · {admin.role}</span></div>
          <button className="btn ghost small" onClick={() => {
            // La session est fermée côté serveur : le jeton ne peut plus servir, même s'il a été copié.
            api('POST', '/api/admin/logout').catch(() => {}).finally(() => { session.token = null; setAdmin(null); });
          }}>Se déconnecter</button>
          <span className="server-line" title={session.server}>{session.server}</span>
        </div>
      </aside>
      {/* Sur téléphone : toucher la zone assombrie referme le menu. */}
      {menuOpen && <div className="menu-backdrop" onClick={() => setMenuOpen(false)} aria-hidden />}
      <main className="content">
        <header className="topbar">
          <button className="btn ghost menu-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu" aria-expanded={menuOpen}>☰</button>
          <h1>{current.label}</h1>
        </header>
        <div className="page">{current.el(admin, setPage)}</div>
      </main>
    </div>
  );
}
