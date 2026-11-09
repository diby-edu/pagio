import { useState } from 'react';
import { Admin, api } from '../api';
import { Card, Field, useFlash } from '../ui';

export default function Account({ admin }: { admin: Admin }) {
  const [current, setCurrent] = useState(''); const [next, setNext] = useState(''); const [confirm, setConfirm] = useState('');
  const [flash, show] = useFlash();
  return (
    <div className="stack">
      {flash}
      <Card title="Mon compte">
        <div className="kv"><span>E-mail</span><b>{admin.email}</b><span>Rôle</span><b>{admin.role}</b></div>
      </Card>
      <Card title="Changer mon mot de passe">
        <Field label="Mot de passe actuel"><input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
        <Field label="Nouveau mot de passe" hint="10 caractères minimum."><input type="password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <Field label="Confirmer"><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        <button className="btn primary" disabled={next.length < 10 || next !== confirm} onClick={async () => {
          try { await api('POST', '/api/admin/me/password', { current, next }); setCurrent(''); setNext(''); setConfirm(''); show('Mot de passe modifié'); }
          catch (e) { show((e as Error).message, 'error'); }
        }}>Modifier</button>
      </Card>
    </div>
  );
}
