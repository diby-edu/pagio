import { useEffect, useState } from 'react';
import { Admin, Role, api, fmtDate } from '../api';
import { Alert, Badge, Card, Field, Toggle, useFlash } from '../ui';

interface Row { id: number; email: string; name: string; role: Role; active: number; created_at: number; last_login: number | null }
const ROLE_LABEL: Record<Role, string> = { owner: 'Propriétaire (tous les droits)', admin: 'Administrateur', support: 'Support (lecture + notes)' };

export default function Admins({ admin }: { admin: Admin }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, show] = useFlash();
  const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [password, setPassword] = useState(''); const [role, setRole] = useState<Role>('support');
  const load = () => api<{ admins: Row[] }>('GET', '/api/admin/admins').then((r) => setRows(r.admins)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const patch = async (id: number, body: object, msg: string) => { try { await api('PATCH', `/api/admin/admins/${id}`, body); show(msg); load(); } catch (e) { show((e as Error).message, 'error'); } };
  if (error) return <Alert>{error}</Alert>;

  return (
    <div className="stack">
      {flash}
      <Card title="Équipe d'administration">
        {!rows ? <div className="muted">Chargement…</div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Administrateur</th><th>Rôle</th><th>Actif</th><th>Dernière connexion</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className={r.active ? '' : 'dim'}>
                <td><strong>{r.name || '—'}</strong>{r.id === admin.id && <Badge tone="indigo">vous</Badge>}<br /><span className="muted small">{r.email}</span></td>
                <td><select value={r.role} disabled={r.id === admin.id} onChange={(e) => patch(r.id, { role: e.target.value }, 'Rôle modifié')}>
                  {(Object.keys(ROLE_LABEL) as Role[]).map((k) => <option key={k} value={k}>{ROLE_LABEL[k]}</option>)}</select></td>
                <td><Toggle checked={!!r.active} disabled={r.id === admin.id} onChange={(v) => patch(r.id, { active: v }, v ? 'Accès réactivé' : 'Accès désactivé')} /></td>
                <td>{fmtDate(r.last_login)}</td>
                <td><button className="btn small" onClick={() => { const p = prompt('Nouveau mot de passe (10 caractères minimum)'); if (p) patch(r.id, { password: p }, 'Mot de passe réinitialisé'); }}>Mot de passe…</button></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
      <Card title="Ajouter un administrateur">
        <div className="grid2">
          <Field label="E-mail"><input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Nom"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Mot de passe initial" hint="10 caractères minimum."><input value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field label="Rôle"><select value={role} onChange={(e) => setRole(e.target.value as Role)}>{(Object.keys(ROLE_LABEL) as Role[]).map((k) => <option key={k} value={k}>{ROLE_LABEL[k]}</option>)}</select></Field>
        </div>
        <button className="btn primary" onClick={async () => {
          try { await api('POST', '/api/admin/admins', { email, name, password, role }); setEmail(''); setName(''); setPassword(''); show('Administrateur ajouté'); load(); }
          catch (e) { show((e as Error).message, 'error'); }
        }}>Ajouter</button>
      </Card>
    </div>
  );
}
