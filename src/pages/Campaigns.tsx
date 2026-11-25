import { useCallback, useEffect, useState } from 'react';
import { api, fmtDate, fmtNum } from '../api';
import { Alert, Badge, Card, Empty, Field, useFlash } from '../ui';

interface Data {
  segments: Record<string, { label: string; count: number }>;
  campaigns: { id: number; ts: number; admin_email: string; subject: string; segment: string; recipients: number; sent: number; failed: number; status: string }[];
  unsubscribed: number;
}

/** Campagnes e-mail aux utilisateurs (Brevo), avec désinscription. */
export default function Campaigns({ email }: { email: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [flash, show] = useFlash();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [segment, setSegment] = useState('all');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<Data>('GET', '/api/admin/campaigns').then(setD).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  if (error) return <Alert>{error}</Alert>;
  if (!d) return <div className="muted">Chargement…</div>;
  const n = d.segments[segment]?.count ?? 0;

  return (
    <div className="stack">
      {flash}
      <Card title="Nouvelle campagne">
        <Field label="Destinataires"><select value={segment} onChange={(e) => setSegment(e.target.value)}>
          {Object.entries(d.segments).map(([k, s]) => <option key={k} value={k}>{s.label} ({fmtNum(s.count)})</option>)}</select></Field>
        <Field label="Objet"><input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} placeholder="Nouveau : tous les outils PDF en ligne" /></Field>
        <Field label="Message" hint="Texte simple ; les adresses https://… deviennent des liens. « Bonjour Prénom » est ajouté si le nom est connu.">
          <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <p className="muted small">Un lien « Ne plus recevoir ces e-mails » est ajouté en bas. Les désinscrits ({fmtNum(d.unsubscribed)}) et les comptes suspendus sont exclus.</p>
        <div className="row gap wrap">
          <button className="btn" disabled={busy || !subject || body.length < 10} onClick={async () => {
            setBusy(true); try { await api('POST', '/api/admin/campaigns', { subject, body, test_to: email }); show(`Essai envoyé à ${email}`); } catch (e) { show((e as Error).message, 'error'); } setBusy(false);
          }}>M'envoyer un essai</button>
          <button className="btn primary" disabled={busy || !subject || body.length < 10 || n === 0} onClick={async () => {
            if (!confirm(`Envoyer « ${subject} » à ${n} personne(s) ? L'envoi ne peut pas être annulé.`)) return;
            setBusy(true);
            try { const r = await api<{ recipients: number }>('POST', '/api/admin/campaigns', { subject, body, segment }); show(`Envoi en cours à ${r.recipients} personne(s)`); setSubject(''); setBody(''); load(); }
            catch (e) { show((e as Error).message, 'error'); }
            setBusy(false);
          }}>Envoyer à {fmtNum(n)} personne(s)</button>
        </div>
      </Card>
      <Card title="Campagnes envoyées">
        {d.campaigns.length === 0 ? <Empty>Aucune campagne pour l'instant.</Empty> :
          <table className="table small"><thead><tr><th>Date</th><th>Objet</th><th>Destinataires</th><th>Envoyés</th><th>Échecs</th><th>État</th></tr></thead><tbody>
            {d.campaigns.map((c) => <tr key={c.id}><td>{fmtDate(c.ts)}</td><td>{c.subject}</td><td>{d.segments[c.segment]?.label ?? c.segment} ({fmtNum(c.recipients)})</td>
              <td>{fmtNum(c.sent)}</td><td>{c.failed ? <Badge tone="red">{c.failed}</Badge> : 0}</td><td>{c.status === 'en cours' ? <Badge tone="amber">en cours</Badge> : <Badge tone="teal">terminée</Badge>}</td></tr>)}
          </tbody></table>}
      </Card>
    </div>
  );
}
