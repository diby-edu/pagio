import { useEffect, useState } from 'react';
import { Admin, TOOL_LABELS, Tool, api } from '../api';
import { Alert, Card, Toggle, useFlash } from '../ui';

const GROUPS: [string, string[]][] = [
  ['Organiser', ['merge', 'split', 'organize', 'extract_pages', 'delete_pages', 'rotate']],
  ['Optimiser', ['compress', 'repair', 'ocr', 'extract_text']],
  ['Créer et convertir en PDF', ['scan', 'images_to_pdf', 'office_to_pdf', 'html_to_pdf', 'txt_to_pdf', 'create_pdf']],
  ['Convertir depuis PDF', ['pdf_to_word', 'pdf_to_excel', 'pdf_to_ppt', 'pdf_to_images', 'extract_images']],
  ['Modifier', ['edit', 'sign', 'fill_forms', 'page_numbers', 'watermark', 'header_footer', 'replace_text', 'redact']],
  ['Sécurité', ['protect', 'unlock', 'metadata', 'strip_metadata', 'digital_sign', 'verify_sign']],
  ['Intelligence artificielle', ['assistant', 'translate', 'invoice', 'tables', 'classify']],
];

export default function Tools({ admin }: { admin: Admin }) {
  const [tools, setTools] = useState<Tool[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, show] = useFlash();
  const canEdit = admin.role !== 'support';

  useEffect(() => { api<{ tools: Tool[] }>('GET', '/api/admin/tools').then((r) => setTools(r.tools)).catch((e) => setError(e.message)); }, []);

  async function update(id: string, patch: Partial<Tool>) {
    try {
      const r = await api<{ tool: Tool }>('PUT', `/api/admin/tools/${id}`, patch);
      setTools((ts) => ts?.map((t) => (t.id === id ? { ...t, ...r.tool } : t)) ?? null);
      show(`« ${TOOL_LABELS[id] ?? id} » mis à jour — appliqué au prochain démarrage de l'application`);
    } catch (e) { show((e as Error).message, 'error'); }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!tools) return <div className="muted">Chargement…</div>;
  const byId = Object.fromEntries(tools.map((t) => [t.id, t]));

  return (
    <div className="stack">
      {flash}
      <Alert tone="info">Désactivez un outil pour le masquer dans l'application, réservez-le au Premium, ou limitez le nombre de fichiers et la taille (0 = limite de l'offre).
        Les changements sont lus par l'application à chaque démarrage (et conservés hors ligne).</Alert>
      {GROUPS.map(([title, ids]) => (
        <Card key={title} title={title}>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Outil</th><th>Activé</th><th>Premium seulement</th><th>Fichiers max</th><th>Taille max (Mo)</th><th>Utilisations 30 j</th></tr></thead>
            <tbody>{ids.filter((id) => byId[id]).map((id) => {
              const t = byId[id];
              return (
                <tr key={id} className={t.enabled ? '' : 'dim'}>
                  <td><strong>{TOOL_LABELS[id] ?? id}</strong><br /><code className="small">{id}</code></td>
                  <td><Toggle checked={t.enabled} disabled={!canEdit} onChange={(v) => update(id, { enabled: v })} /></td>
                  <td><Toggle checked={t.premium} disabled={!canEdit} onChange={(v) => update(id, { premium: v })} /></td>
                  <td><input type="number" min={0} defaultValue={t.max_files} disabled={!canEdit} style={{ width: 80 }}
                    onBlur={(e) => Number(e.target.value) !== t.max_files && update(id, { max_files: Number(e.target.value) })} /></td>
                  <td><input type="number" min={0} defaultValue={t.max_mb} disabled={!canEdit} style={{ width: 80 }}
                    onBlur={(e) => Number(e.target.value) !== t.max_mb && update(id, { max_mb: Number(e.target.value) })} /></td>
                  <td>{t.runs_30d}</td>
                </tr>);
            })}</tbody>
          </table></div>
        </Card>
      ))}
    </div>
  );
}
