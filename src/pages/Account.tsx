import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Admin, AdminSession, api, fmtDate } from '../api';
import { Alert, Badge, Card, Field, useFlash } from '../ui';

/** Nom lisible du navigateur et du système à partir de l'en-tête User-Agent. */
function device(ua: string): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur inconnu';
  const system = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return system ? `${browser} · ${system}` : browser;
}

function QrCode({ text }: { text: string }) {
  const svg = useMemo(() => { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 5, margin: 3, scalable: true }); }, [text]);
  return <div style={{ width: 200, background: '#fff', borderRadius: 8 }} dangerouslySetInnerHTML={{ __html: svg }} aria-label="QR code à scanner avec l'application d'authentification" />;
}

function TwoFactor({ show }: { show: (msg: string, tone?: 'success' | 'error') => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  useEffect(() => { api<{ admin: Admin }>('GET', '/api/admin/me').then((r) => setEnabled(!!r.admin.totp_enabled)).catch(() => setEnabled(false)); }, []);
  const run = async (f: () => Promise<void>) => { try { await f(); } catch (e) { show((e as Error).message, 'error'); } };

  if (enabled === null) return <Card title="Double authentification"><div className="muted">Chargement…</div></Card>;

  if (recovery) return (
    <Card title="Double authentification activée">
      <Alert tone="warning">Notez ces 8 codes de secours maintenant : ils ne seront plus jamais affichés. Chacun permet une connexion
        si vous n'avez plus votre téléphone, et ne sert qu'une fois.</Alert>
      <pre style={{ fontSize: 16, lineHeight: 1.8, columns: 2, margin: '12px 0' }}>{recovery.join('\n')}</pre>
      <div className="row gap">
        <button className="btn" onClick={() => navigator.clipboard.writeText(recovery.join('\n')).then(() => show('Codes copiés'))}>Copier</button>
        <button className="btn primary" onClick={() => setRecovery(null)}>J'ai noté mes codes</button>
      </div>
    </Card>
  );

  if (enabled) return (
    <Card title="Double authentification" actions={<Badge tone="teal">active</Badge>}>
      <p className="muted">À chaque connexion, un code de votre application d'authentification est demandé en plus du mot de passe.</p>
      {!disabling ? <button className="btn danger" onClick={() => setDisabling(true)}>Désactiver…</button> : (
        <>
          <Field label="Mot de passe"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field label="Code à 6 chiffres ou code de secours"><input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" /></Field>
          <div className="row gap">
            <button className="btn danger" disabled={!password || !code} onClick={() => run(async () => {
              await api('POST', '/api/admin/me/2fa/disable', { password, code: code.trim() });
              setEnabled(false); setDisabling(false); setPassword(''); setCode(''); show('Double authentification désactivée');
            })}>Confirmer la désactivation</button>
            <button className="btn ghost" onClick={() => { setDisabling(false); setPassword(''); setCode(''); }}>Annuler</button>
          </div>
        </>
      )}
    </Card>
  );

  return (
    <Card title="Double authentification" actions={<Badge tone="coral">inactive</Badge>}>
      {!setup ? (
        <>
          <p className="muted">Protège votre compte même si votre mot de passe est volé : un code à 6 chiffres, généré par une application sur
            votre téléphone (Google Authenticator, Microsoft Authenticator, Authy…), est demandé à chaque connexion.</p>
          <Field label="Mot de passe actuel" hint="Demandé pour confirmer que c'est bien vous."><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <button className="btn primary" disabled={!password} onClick={() => run(async () => {
            setSetup(await api<{ secret: string; uri: string }>('POST', '/api/admin/me/2fa/setup', { password })); setPassword('');
          })}>Commencer l'activation</button>
        </>
      ) : (
        <>
          <p><b>1.</b> Ouvrez votre application d'authentification et scannez ce QR code.</p>
          <QrCode text={setup.uri} />
          <p className="muted small">Impossible de scanner ? Saisissez cette clé à la main : <code style={{ wordBreak: 'break-all' }}>{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code></p>
          <p><b>2.</b> Saisissez le code à 6 chiffres affiché par l'application.</p>
          <Field label="Code à 6 chiffres"><input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" /></Field>
          <div className="row gap">
            <button className="btn primary" disabled={code.replace(/\s/g, '').length !== 6} onClick={() => run(async () => {
              const r = await api<{ recovery_codes: string[] }>('POST', '/api/admin/me/2fa/enable', { code: code.trim() });
              setRecovery(r.recovery_codes); setEnabled(true); setSetup(null); setCode('');
            })}>Activer</button>
            <button className="btn ghost" onClick={() => { setSetup(null); setCode(''); }}>Annuler</button>
          </div>
        </>
      )}
    </Card>
  );
}

function Sessions({ admin, show }: { admin: Admin; show: (msg: string, tone?: 'success' | 'error') => void }) {
  const [rows, setRows] = useState<AdminSession[] | null>(null);
  const load = () => api<{ sessions: AdminSession[] }>('GET', '/api/admin/sessions').then((r) => setRows(r.sessions)).catch((e) => show(e.message, 'error'));
  useEffect(() => { load(); }, []);
  const others = (rows ?? []).filter((s) => !s.current && s.admin_id === admin.id).length;
  return (
    <Card title={admin.role === 'owner' ? "Sessions ouvertes (toute l'équipe)" : 'Mes sessions ouvertes'} actions={
      <button className="btn small" disabled={others === 0} onClick={async () => {
        try { const r = await api<{ closed: number }>('POST', '/api/admin/sessions/revoke-others'); show(`${r.closed} session(s) fermée(s)`); load(); } catch (e) { show((e as Error).message, 'error'); }
      }}>Fermer mes autres sessions</button>}>
      <p className="muted small">Une session s'ouvre à chaque connexion et expire au bout de 12 heures. Fermez celles que vous ne reconnaissez pas, puis changez votre mot de passe.</p>
      {!rows ? <div className="muted">Chargement…</div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Administrateur</th><th>Appareil</th><th>Adresse IP</th><th>Ouverte le</th><th>Dernière activité</th><th /></tr></thead>
          <tbody>{rows.map((s) => (
            <tr key={s.id}>
              <td>{s.email}{s.current && <> <Badge tone="indigo">cette session</Badge></>}</td>
              <td title={s.user_agent}>{device(s.user_agent)}</td>
              <td>{s.ip || '—'}</td>
              <td>{fmtDate(s.created_at)}</td>
              <td>{fmtDate(s.last_seen)}</td>
              <td>{!s.current && <button className="btn small danger" onClick={async () => {
                try { await api('DELETE', `/api/admin/sessions/${s.id}`); show('Session fermée'); load(); } catch (e) { show((e as Error).message, 'error'); }
              }}>Fermer</button>}</td>
            </tr>))}
          </tbody>
        </table></div>
      )}
    </Card>
  );
}

export default function Account({ admin }: { admin: Admin }) {
  const [current, setCurrent] = useState(''); const [next, setNext] = useState(''); const [confirm, setConfirm] = useState('');
  const [flash, show] = useFlash();
  return (
    <div className="stack">
      {flash}
      <Card title="Mon compte">
        <div className="kv"><span>E-mail</span><b>{admin.email}</b><span>Rôle</span><b>{admin.role}</b></div>
      </Card>
      <div className="grid2">
        <Card title="Changer mon mot de passe">
          <Field label="Mot de passe actuel"><input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
          <Field label="Nouveau mot de passe" hint="10 caractères minimum. Vos autres sessions seront fermées."><input type="password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
          <Field label="Confirmer"><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
          <button className="btn primary" disabled={next.length < 10 || next !== confirm} onClick={async () => {
            try { await api('POST', '/api/admin/me/password', { current, next }); setCurrent(''); setNext(''); setConfirm(''); show('Mot de passe modifié'); }
            catch (e) { show((e as Error).message, 'error'); }
          }}>Modifier</button>
        </Card>
        <TwoFactor show={show} />
      </div>
      <Sessions admin={admin} show={show} />
    </div>
  );
}
