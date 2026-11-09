import { useEffect, useState } from 'react';
import { Settings, api } from '../api';
import { Alert, Card, Field, Toggle, useFlash } from '../ui';
import { useSettings } from './useSettings';

const PRESETS: Record<string, { provider: Settings['ai']['provider']; base_url: string; model: string; label: string }> = {
  openai: { provider: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', label: 'OpenAI' },
  anthropic: { provider: 'anthropic', base_url: 'https://api.anthropic.com/v1', model: 'claude-haiku-5-5', label: 'Anthropic Claude' },
  gemini: { provider: 'gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', label: 'Google Gemini' },
  mistral: { provider: 'openai', base_url: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', label: 'Mistral (compatible OpenAI)' },
  groq: { provider: 'openai', base_url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', label: 'Groq (compatible OpenAI)' },
  ollama: { provider: 'openai', base_url: 'http://localhost:11434/v1', model: 'llama3.1', label: 'Ollama local (gratuit, sur votre serveur)' },
};

export default function AiSettings() {
  const { settings, error, save } = useSettings();
  const [ai, setAi] = useState<Settings['ai'] | null>(null);
  const [flash, show] = useFlash();
  const [test, setTest] = useState<string | null>(null);
  useEffect(() => { if (settings) setAi(settings.ai); }, [settings]);
  if (error) return <Alert>{error}</Alert>;
  if (!ai) return <div className="muted">Chargement…</div>;

  return (
    <div className="stack">
      {flash}
      <Alert tone="info">Ces réglages alimentent le fournisseur « Serveur Pagio » de l'application : la clé reste sur le serveur, jamais dans l'APK,
        et chaque requête décompte des crédits IA de l'utilisateur. Les utilisateurs peuvent aussi utiliser leur propre clé dans l'application.</Alert>
      <Card title="Fournisseur d'IA générative">
        <Toggle checked={ai.enabled} onChange={(v) => setAi({ ...ai, enabled: v })} label="IA du serveur activée" />
        <div className="row gap wrap" style={{ margin: '12px 0' }}>
          {Object.entries(PRESETS).map(([k, p]) => <button key={k} className="chip" onClick={() => setAi({ ...ai, provider: p.provider, base_url: p.base_url, model: p.model })}>{p.label}</button>)}
        </div>
        <Field label="Type d'API"><select value={ai.provider} onChange={(e) => setAi({ ...ai, provider: e.target.value as Settings['ai']['provider'] })}>
          <option value="openai">Compatible OpenAI (OpenAI, Mistral, Groq, OpenRouter, Ollama…)</option><option value="anthropic">Anthropic Claude</option><option value="gemini">Google Gemini</option>
        </select></Field>
        <Field label="Adresse de l'API"><input value={ai.base_url} onChange={(e) => setAi({ ...ai, base_url: e.target.value })} /></Field>
        <Field label="Modèle"><input value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} /></Field>
        {ai.key_error && <Alert tone="warning">La clé enregistrée ne peut plus être déchiffrée (la clé de chiffrement du serveur a changé). Saisissez-la de nouveau.</Alert>}
        <Field label="Clé d'API" hint={ai.key_from_env ? "La clé vient de la variable AI_API_KEY du serveur : elle remplace celle saisie ici."
          : ai.has_key ? 'Une clé est enregistrée, chiffrée dans la base. Laissez tel quel pour la conserver.' : 'Aucune clé enregistrée. Elle sera chiffrée dans la base.'}>
          <input type="password" value={ai.api_key} disabled={ai.key_from_env} onChange={(e) => setAi({ ...ai, api_key: e.target.value })} placeholder="sk-…" />
        </Field>
        <div className="grid2">
          <Field label="Crédits par requête"><input type="number" min={0} value={ai.cost_per_request} onChange={(e) => setAi({ ...ai, cost_per_request: Number(e.target.value) })} /></Field>
          <Field label="Longueur maximale de réponse (jetons)"><input type="number" min={100} max={8000} value={ai.max_tokens} onChange={(e) => setAi({ ...ai, max_tokens: Number(e.target.value) })} /></Field>
        </div>
        <div className="row gap">
          <button className="btn primary" onClick={async () => { try { await save({ ai }); show('Réglages IA enregistrés'); } catch (e) { show((e as Error).message, 'error'); } }}>Enregistrer</button>
          <button className="btn" onClick={async () => { setTest('Test en cours…'); try { setTest('✔ ' + (await api<{ text: string }>('POST', '/api/admin/ai/test')).text); } catch (e) { setTest('✘ ' + (e as Error).message); } }}>Tester (après enregistrement)</button>
        </div>
        {test && <p className="muted">{test}</p>}
      </Card>
    </div>
  );
}
