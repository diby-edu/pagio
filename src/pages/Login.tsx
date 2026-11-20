import { FormEvent, useState } from 'react';
import { Admin, ApiError, api, serverChoice, session } from '../api';
import { Alert, Field } from '../ui';

export default function Login({ onLogin }: { onLogin: (a: Admin) => void }) {
  const [server, setServer] = useState(session.server);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Double authentification : le serveur demande le code après avoir validé le mot de passe.
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    if (serverChoice) session.server = server.trim() || 'http://localhost:8787';
    try {
      const r = await api<{ token: string; admin: Admin }>('POST', '/api/admin/login', { email, password, ...(needCode ? { code: code.trim() } : {}) });
      session.token = r.token;
      onLogin(r.admin);
    } catch (err) {
      const asked = err instanceof ApiError && err.data.totp_required === true;
      if (asked && !needCode) { setNeedCode(true); setError(null); }
      else setError((err as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="login">
      <div className="login-hero">
        <img src="./favicon.svg" alt="" />
        <h1>Pagio</h1>
        <p>Tableau de bord d'administration</p>
        <ul>
          <li>Utilisateurs, offres Premium et crédits IA</li>
          <li>Activation des outils et limites gratuites</li>
          <li>Annonces, maintenance et mises à jour obligatoires</li>
          <li>Statistiques d'usage, erreurs et journal d'audit</li>
        </ul>
      </div>
      <form className="login-card" onSubmit={submit}>
        <h2>Connexion administrateur</h2>
        {serverChoice && (
          <Field label="Adresse du serveur Pagio" hint="Développement : par défaut http://localhost:8787 (serveur lancé sur cet ordinateur).">
            <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://admin.pagio.site" />
          </Field>
        )}
        <Field label="E-mail">
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Mot de passe">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {needCode && (
          <Field label="Code">
            <input autoFocus autoComplete="one-time-code" inputMode="text" value={code} onChange={(e) => setCode(e.target.value)} required />
          </Field>
        )}
        {error && <Alert>{error}</Alert>}
        <button className="btn primary wide" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
        {serverChoice && (
          <p className="muted small">Premier démarrage : l'identifiant et le mot de passe initiaux s'affichent dans la console du serveur
            (et dans <code>server/data/premier-admin.txt</code>). Changez-les dès la première connexion.</p>
        )}
      </form>
    </div>
  );
}
