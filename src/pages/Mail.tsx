import { useEffect, useState } from 'react';
import { Admin, MailSettings, api } from '../api';
import { Alert, Badge, Card, Field, Toggle, useFlash } from '../ui';
import { useSettings } from './useSettings';

export default function Mail({ admin }: { admin: Admin }) {
  const { settings, error, save } = useSettings();
  const [mail, setMail] = useState<MailSettings | null>(null);
  const [flash, show] = useFlash();
  const [to, setTo] = useState('');
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!settings) return;
    // Première ouverture : l'adresse publique proposée est celle où le tableau de bord est servi.
    setMail({ ...settings.mail, public_url: settings.mail.public_url || (location.protocol === 'https:' ? location.origin : '') });
  }, [settings]);
  if (error) return <Alert>{error}</Alert>;
  if (!mail) return <div className="muted">Chargement…</div>;
  const ready = mail.enabled && mail.has_key && !!mail.from_email;
  const set = (patch: Partial<MailSettings>) => setMail({ ...mail, ...patch });

  async function record() {
    if (!mail) return;
    try { const s = await save({ mail }); setMail(s.mail); show('Réglages des e-mails enregistrés'); }
    catch (e) { show((e as Error).message, 'error'); }
  }
  async function sendTest() {
    setBusy(true); setTest(null);
    try { setTest({ ok: true, text: (await api<{ message: string }>('POST', '/api/admin/mail/test', { to: to || admin.email })).message }); }
    catch (e) { setTest({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  }

  return (
    <div className="stack">
      {flash}
      <Alert tone="info">Avec les e-mails activés, un utilisateur qui a oublié son mot de passe reçoit un lien pour en choisir un nouveau, sans
        intervention de votre part ; les nouveaux inscrits reçoivent un lien de confirmation de leur adresse ; et vous pouvez recevoir les
        alertes du serveur. L'envoi passe par Brevo : la clé reste sur le serveur, chiffrée.</Alert>
      <Card title="Service d'envoi (Brevo)" actions={<Badge tone={ready ? 'teal' : 'coral'}>{ready ? 'actif' : 'inactif'}</Badge>}>
        <Toggle checked={mail.enabled} onChange={(v) => set({ enabled: v })} label="E-mails automatiques activés" />
        {mail.key_error && <Alert tone="warning">La clé enregistrée ne peut plus être déchiffrée (la clé de chiffrement du serveur a changé). Saisissez-la de nouveau.</Alert>}
        <Field label="Clé d'API Brevo" hint={mail.key_from_env ? 'La clé vient de la variable MAIL_API_KEY du serveur : elle remplace celle saisie ici.'
          : mail.has_key ? 'Une clé est enregistrée, chiffrée dans la base. Laissez tel quel pour la conserver.'
            : 'Dans Brevo : votre nom en haut à droite › SMTP et API › Clés API › Générer une nouvelle clé API. Elle commence par « xkeysib- ».'}>
          <input type="password" value={mail.api_key} disabled={mail.key_from_env} onChange={(e) => set({ api_key: e.target.value })} placeholder="xkeysib-…" autoComplete="off" />
        </Field>
        <div className="grid2">
          <Field label="Adresse d'expéditeur" hint="Elle doit être validée dans Brevo (Expéditeurs, domaines et IP dédiées › Expéditeurs).">
            <input type="email" value={mail.from_email} onChange={(e) => set({ from_email: e.target.value })} placeholder="contact@votre-domaine.com" />
          </Field>
          <Field label="Nom affiché" hint="Ce que le destinataire voit comme expéditeur.">
            <input value={mail.from_name} onChange={(e) => set({ from_name: e.target.value })} />
          </Field>
        </div>
        <Field label="Adresse publique du serveur" hint="Utilisée dans les liens envoyés (nouveau mot de passe, confirmation). Elle doit commencer par https://.">
          <input value={mail.public_url} onChange={(e) => set({ public_url: e.target.value })} placeholder="https://pagio.votre-domaine.com" />
        </Field>
      </Card>

      <Card title="Ce qui est envoyé">
        <p className="muted" style={{ marginTop: 0 }}>Mot de passe oublié : toujours envoyé dès que les e-mails sont actifs (lien valable 1 heure, utilisable une seule fois).</p>
        <Toggle checked={mail.verify_signup} onChange={(v) => set({ verify_signup: v })} label="Demander aux nouveaux inscrits de confirmer leur adresse" />
        <p className="muted">L'inscription n'est pas bloquée : le compte fonctionne tout de suite, et la fiche de l'utilisateur indique si l'adresse est confirmée.</p>
        <Toggle checked={mail.alerts_enabled} onChange={(v) => set({ alerts_enabled: v })} label="M'envoyer les alertes du serveur" />
        <Field label="Adresse qui reçoit les alertes" hint="Disque presque plein, sauvegarde en retard, erreurs du serveur, échecs de l'IA ou des conversions. Chaque alerte est envoyée une fois par jour tant qu'elle dure.">
          <input type="email" value={mail.alerts_to} onChange={(e) => set({ alerts_to: e.target.value })} placeholder={admin.email} />
        </Field>
        <button className="btn primary" onClick={record}>Enregistrer</button>
      </Card>

      <Card title="Essai">
        <p className="muted" style={{ marginTop: 0 }}>Enregistrez d'abord vos réglages, puis envoyez-vous un e-mail d'essai. Regardez aussi dans les courriers indésirables.</p>
        <div className="row gap wrap">
          <input type="email" style={{ flex: 1, minWidth: 220 }} value={to} onChange={(e) => setTo(e.target.value)} placeholder={admin.email} />
          <button className="btn" disabled={busy} onClick={sendTest}>{busy ? 'Envoi…' : "Envoyer un e-mail d'essai"}</button>
        </div>
        {test && <div style={{ marginTop: 12 }}><Alert tone={test.ok ? 'success' : 'error'}>{test.text}</Alert></div>}
      </Card>
    </div>
  );
}
