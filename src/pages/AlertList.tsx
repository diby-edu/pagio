import { useEffect, useState } from 'react';
import { api } from '../api';

export interface ServerAlert { level: 'critical' | 'warning' | 'info'; code: string; message: string; page: string }

const TONE = { critical: 'error', warning: 'warning', info: 'info' } as const;
const LABEL = { critical: 'Urgent', warning: 'À surveiller', info: 'Information' } as const;

/** Liste des points à surveiller renvoyés par le serveur ; chaque ligne mène à la page où agir. */
export function AlertList({ alerts, go }: { alerts: ServerAlert[]; go?: (page: string) => void }) {
  if (alerts.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {alerts.map((a) => (
        <div key={a.code} className={`alert alert-${TONE[a.level]}`} style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
          <span><b>{LABEL[a.level]} :</b> {a.message}</span>
          {go && <button className="btn small" onClick={() => go(a.page)}>Voir</button>}
        </div>
      ))}
    </div>
  );
}

/** Charge les alertes du serveur (visibles par tous les rôles). */
export function useAlerts(): ServerAlert[] {
  const [alerts, setAlerts] = useState<ServerAlert[]>([]);
  useEffect(() => { api<{ alerts: ServerAlert[] }>('GET', '/api/admin/alerts').then((r) => setAlerts(r.alerts)).catch(() => {}); }, []);
  return alerts;
}
