import { useEffect, useState } from 'react';
import { Settings, api } from '../api';

/** Charge et enregistre les réglages du serveur. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [libreoffice, setLibreoffice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ settings: Settings; libreoffice: boolean }>('GET', '/api/admin/settings')
      .then((r) => { setSettings(r.settings); setLibreoffice(r.libreoffice); }).catch((e) => setError(e.message));
  }, []);
  async function save(patch: Partial<Settings>) {
    const r = await api<{ settings: Settings }>('PUT', '/api/admin/settings', patch);
    setSettings(r.settings);
    return r.settings;
  }
  return { settings, setSettings, libreoffice, error, save };
}
