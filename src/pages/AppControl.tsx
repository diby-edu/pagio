import { useEffect, useState } from 'react';
import { Settings } from '../api';
import { Alert, Card, Field, Toggle, useFlash } from '../ui';
import { useSettings } from './useSettings';

export default function AppControl() {
  const { settings, libreoffice, error, save } = useSettings();
  const [s, setS] = useState<Settings | null>(null);
  const [flash, show] = useFlash();
  useEffect(() => { if (settings) setS(settings); }, [settings]);
  if (error) return <Alert>{error}</Alert>;
  if (!s) return <div className="muted">Chargement…</div>;
  const submit = async (keys: (keyof Settings)[], msg: string) => {
    try { await save(Object.fromEntries(keys.map((k) => [k, s[k]])) as Partial<Settings>); show(msg); } catch (e) { show((e as Error).message, 'error'); }
  };

  return (
    <div className="stack">
      {flash}
      <div className="grid2">
        <Card title="Maintenance">
          <p className="muted">Bloque l'application avec un message (les utilisateurs voient un bouton « Réessayer »).</p>
          <Toggle checked={s.maintenance} onChange={(v) => setS({ ...s, maintenance: v })} label={s.maintenance ? 'Maintenance ACTIVE' : 'Maintenance désactivée'} />
          <Field label="Message affiché"><textarea rows={2} value={s.maintenance_message} onChange={(e) => setS({ ...s, maintenance_message: e.target.value })} placeholder="Pagio revient à 14 h." /></Field>
          <button className="btn primary" onClick={() => submit(['maintenance', 'maintenance_message'], 'Maintenance enregistrée')}>Enregistrer</button>
        </Card>
        <Card title="Annonce sur l'accueil">
          <Field label="Texte de l'annonce" hint="Vide = aucune annonce."><textarea rows={2} value={s.announcement} onChange={(e) => setS({ ...s, announcement: e.target.value })} /></Field>
          <Field label="Style"><select value={s.announcement_level} onChange={(e) => setS({ ...s, announcement_level: e.target.value })}><option value="info">Information</option><option value="warning">Avertissement</option></select></Field>
          <button className="btn primary" onClick={() => submit(['announcement', 'announcement_level'], 'Annonce publiée')}>Publier</button>
        </Card>
      </div>
      <div className="grid2">
        <Card title="Versions et mises à jour">
          <Field label="Dernière version disponible" hint="Affiche un bandeau « Nouvelle version » si l'appareil a une version différente."><input value={s.latest_version_name} onChange={(e) => setS({ ...s, latest_version_name: e.target.value })} placeholder="1.1.0" /></Field>
          <Field label="Version minimale obligatoire (versionCode)" hint="Les applications plus anciennes sont bloquées jusqu'à la mise à jour. 0 = aucune."><input type="number" min={0} value={s.min_version_code} onChange={(e) => setS({ ...s, min_version_code: Number(e.target.value) })} /></Field>
          <Field label="Lien de mise à jour" hint="Page Google Play ou lien de téléchargement de l'APK."><input value={s.update_url} onChange={(e) => setS({ ...s, update_url: e.target.value })} placeholder="https://play.google.com/store/apps/details?id=com.pagio.app" /></Field>
          <button className="btn primary" onClick={() => submit(['latest_version_name', 'min_version_code', 'update_url'], 'Versions enregistrées')}>Enregistrer</button>
        </Card>
        <Card title="Services">
          <Toggle checked={s.registration_open} onChange={(v) => setS({ ...s, registration_open: v })} label="Inscriptions ouvertes" />
          <div style={{ height: 8 }} />
          <Toggle checked={s.conversion_enabled} onChange={(v) => setS({ ...s, conversion_enabled: v })} label="Conversion haute fidélité (LibreOffice)" />
          <p className={libreoffice ? 'ok-text' : 'warn-text'}>{libreoffice ? '✔ LibreOffice est installé sur ce serveur.' : '✘ LibreOffice n\'est pas détecté : installez-le (ou utilisez l\'image Docker) pour activer ce service.'}</p>
          <Field label="E-mail du support"><input value={s.support_email} onChange={(e) => setS({ ...s, support_email: e.target.value })} /></Field>
          <button className="btn primary" onClick={() => submit(['registration_open', 'conversion_enabled', 'support_email'], 'Services enregistrés')}>Enregistrer</button>
        </Card>
      </div>
      <Card title="Protection contre les abus">
        <p className="muted">Ces limites empêchent un robot de saturer le serveur ou de créer des comptes en masse. 0 = illimité.</p>
        <Toggle checked={s.limits.convert_require_account} onChange={(v) => setS({ ...s, limits: { ...s.limits, convert_require_account: v } })}
          label={s.limits.convert_require_account ? 'Conversion en ligne réservée aux utilisateurs connectés' : 'Conversion en ligne ouverte aussi sans compte'} />
        <div className="grid2" style={{ marginTop: 12 }}>
          <Field label="Conversions par heure, sans compte" hint="Par adresse IP."><input type="number" min={0} value={s.limits.convert_anon_per_hour} onChange={(e) => setS({ ...s, limits: { ...s.limits, convert_anon_per_hour: Number(e.target.value) } })} /></Field>
          <Field label="Conversions par heure, par compte"><input type="number" min={0} value={s.limits.convert_user_per_hour} onChange={(e) => setS({ ...s, limits: { ...s.limits, convert_user_per_hour: Number(e.target.value) } })} /></Field>
          <Field label="Taille maximale d'un fichier à convertir (Mo)" hint="De 1 à 100."><input type="number" min={1} max={100} value={s.limits.convert_max_mb} onChange={(e) => setS({ ...s, limits: { ...s.limits, convert_max_mb: Number(e.target.value) } })} /></Field>
          <Field label="Inscriptions par heure" hint="Par adresse IP."><input type="number" min={0} value={s.limits.register_per_hour} onChange={(e) => setS({ ...s, limits: { ...s.limits, register_per_hour: Number(e.target.value) } })} /></Field>
        </div>
        <button className="btn primary" onClick={() => submit(['limits'], 'Limites enregistrées')}>Enregistrer</button>
      </Card>
    </div>
  );
}
