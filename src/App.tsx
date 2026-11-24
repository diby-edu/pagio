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
import Sales from './pages/Sales';
import Stats from './pages/Stats';

type Go = (page: string) => void;
type Page = { id: string; label: string; icon: string; group: string; min: Admin['role']; el: (a: Admin, go: Go) => JSX.Element };
const RANK = { support: 1, admin: 2, owner: 3 } as const;
/** Catégories du menu, dans l'ordre d'affichage (la page sans catégorie reste tout en haut). */
const GROUPS: { id: string; label: string }[] = [
  { id: 'clients', label: 'Utilisateurs et ventes' },
  { id: 'appli', label: 'Application et outils' },
  { id: 'ia', label: 'Intelligence artificielle' },
  { id: 'suivi', label: 'Suivi et journaux' },
  { id: 'serveur', label: 'Serveur' },
  { id: 'securite', label: 'Administrateurs et sécurité' },
];
const FOLD_KEY = 'pagio-admin-menu-replie';
function readFolded(): string[] {
  try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '[]'); } catch { return []; }
}

const PAGES: Page[] = [
  { id: 'overview', label: "Vue d'ensemble", icon: '◧', group: '', min: 'support', el: (_a, go) => <Overview go={go} /> },
  { id: 'users', label: 'Utilisateurs', icon: '◉', group: 'clients', min: 'support', el: (a) => <Users admin={a} /> },
  { id: 'sales', label: 'Ventes et revenus', icon: '₣', group: 'clients', min: 'support', el: (a) => <Sales canEdit={a.role !== 'support'} /> },
  { id: 'plans', label: 'Offres et tarifs', icon: '★', group: 'clients', min: 'admin', el: () => <Plans /> },
  { id: 'feedback', label: 'Avis et support', icon: '✉', group: 'clients', min: 'support', el: () => <Feedback /> },
  { id: 'tools', label: 'Outils et limites', icon: '▦', group: 'appli', min: 'support', el: (a) => <Tools admin={a} /> },
  { id: 'conversions', label: 'Conversions', icon: '⇄', group: 'appli', min: 'support', el: () => <Conversions /> },
  { id: 'app', label: "Pilotage de l'application", icon: '⚙', group: 'appli', min: 'admin', el: () => <AppControl /> },
  { id: 'ai', label: "Réglages de l'IA", icon: '✦', group: 'ia', min: 'admin', el: () => <AiSettings /> },
  { id: 'aiusage', label: 'Consommation IA', icon: '◔', group: 'ia', min: 'support', el: () => <AiUsage /> },
  { id: 'stats', label: 'Statistiques', icon: '▤', group: 'suivi', min: 'support', el: () => <Stats /> },
  { id: 'events', label: 'Événements', icon: '≡', group: 'suivi', min: 'support', el: () => <Events /> },
  { id: 'errors', label: 'Erreurs du serveur', icon: '⚠', group: 'suivi', min: 'admin', el: (a) => <Errors admin={a} /> },
  { id: 'audit', label: "Journal d'audit", icon: '⌂', group: 'suivi', min: 'admin', el: () => <Audit /> },
  { id: 'mail', label: 'E-mails', icon: '@', group: 'serveur', min: 'admin', el: (a) => <Mail admin={a} /> },
  { id: 'backups', label: 'Sauvegardes', icon: '⛃', group: 'serveur', min: 'admin', el: (a) => <Backups admin={a} /> },
  { id: 'system', label: 'Système', icon: '⛁', group: 'serveur', min: 'admin', el: (_a, go) => <System go={go} /> },
  { id: 'admins', label: 'Administrateurs', icon: '⚑', group: 'securite', min: 'owner', el: (a) => <Admins admin={a} /> },
  { id: 'account', label: 'Mon compte et sécurité', icon: '☺', group: 'securite', min: 'support', el: (a) => <Account admin={a} /> },
];

export default function App() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [checking, setChecking] = useState(!!session.token);
  const [page, setPage] = useState(() => location.hash.slice(1) || 'overview');
  const [menuOpen, setMenuOpen] = useState(false);
  // Catégories repliées par l'administrateur (mémorisées sur cet appareil seulement).
  const [folded, setFolded] = useState<string[]>(readFolded);
  const toggleGroup = (g: string) => setFolded((f) => {
    const next = f.includes(g) ? f.filter((x) => x !== g) : [...f, g];
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(next)); } catch { /* stockage indisponible : sans mémoire */ }
    return next;
  });

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
  const navButton = (p: Page) => (
    <button key={p.id} className={p.id === current.id ? 'active' : ''} onClick={() => { setPage(p.id); setMenuOpen(false); }}>
      <span className="nav-icon" aria-hidden>{p.icon}</span>{p.label}
    </button>
  );

  return (
    <div className={`layout ${menuOpen ? 'menu-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand"><img src="./favicon.svg" alt="" /><div><strong>Pagio</strong><span>Administration</span></div>
          <button className="btn ghost menu-close" onClick={() => setMenuOpen(false)} aria-label="Fermer le menu">✕</button></div>
        <nav>
          {visible.filter((p) => !p.group).map(navButton)}
          {GROUPS.map((g) => {
            const items = visible.filter((p) => p.group === g.id);
            if (items.length === 0) return null;
            // La catégorie de la page affichée reste toujours ouverte.
            const open = !folded.includes(g.id) || items.some((p) => p.id === current.id);
            return (
              <div key={g.id} className="nav-group">
                <button className="nav-group-title" onClick={() => toggleGroup(g.id)} aria-expanded={open}>
                  <span>{g.label}</span><span className="nav-chevron" aria-hidden>{open ? '▾' : '▸'}</span>
                </button>
                {open && items.map(navButton)}
              </div>
            );
          })}
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
