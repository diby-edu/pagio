import { useState } from 'react';
import { PlanLimits, api } from '../api';
import { Alert, Card, Field, useFlash } from '../ui';
import { useSettings } from './useSettings';

export default function Plans() {
  const { settings, error, save } = useSettings();
  const [flash, show] = useFlash();
  const [draft, setDraft] = useState<{ free: PlanLimits; premium: PlanLimits } | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!settings) return <div className="muted">Chargement…</div>;
  const plans = draft ?? settings.plans;
  const set = (p: 'free' | 'premium', k: keyof PlanLimits, v: string) => setDraft({ ...plans, [p]: { ...plans[p], [k]: Math.max(0, Number(v) || 0) } });

  return (
    <div className="stack">
      {flash}
      <Alert tone="info">0 signifie « illimité ». Le quota de tâches par jour s'applique à chaque appareil (et au compte quand l'utilisateur est connecté).
        Les crédits IA indiqués sont attribués à l'inscription et lors d'une recharge.</Alert>
      <div className="grid2">
        {(['free', 'premium'] as const).map((p) => (
          <Card key={p} title={p === 'free' ? 'Offre gratuite' : 'Offre Premium'}>
            <Field label="Tâches par jour"><input type="number" min={0} value={plans[p].daily_tasks} onChange={(e) => set(p, 'daily_tasks', e.target.value)} /></Field>
            <Field label="Fichiers maximum par traitement"><input type="number" min={0} value={plans[p].max_files} onChange={(e) => set(p, 'max_files', e.target.value)} /></Field>
            <Field label="Taille maximale d'un fichier (Mo)"><input type="number" min={0} value={plans[p].max_mb} onChange={(e) => set(p, 'max_mb', e.target.value)} /></Field>
            <Field label="Crédits IA attribués"><input type="number" min={0} value={plans[p].ai_credits} onChange={(e) => set(p, 'ai_credits', e.target.value)} /></Field>
          </Card>
        ))}
      </div>
      <div className="row gap">
        <button className="btn primary" disabled={!draft} onClick={async () => { try { await save({ plans }); setDraft(null); show('Offres enregistrées'); } catch (e) { show((e as Error).message, 'error'); } }}>Enregistrer les offres</button>
        <button className="btn" onClick={async () => {
          if (!confirm('Remonter les crédits IA de chaque utilisateur au niveau de son offre ?')) return;
          try { const r = await api<{ updated: number }>('POST', '/api/admin/credits/refill'); show(`${r.updated} compte(s) rechargé(s)`); } catch (e) { show((e as Error).message, 'error'); }
        }}>Recharger les crédits IA de tous les comptes</button>
      </div>
      <Card title="Paiements et abonnements">
        <p>Le Premium s'attribue ici, compte par compte (page Utilisateurs), avec une date de fin. Pour vendre des abonnements dans l'application,
          branchez Google Play Billing : le guide pas à pas est dans <code>docs/COMMERCIAL.md</code>. La structure (offres, dates de fin, crédits) est déjà prête côté serveur.</p>
      </Card>
    </div>
  );
}
