// Mesure de fréquentation de pagio.site, sans cookies ni stockage : la page vue, d'où vient le visiteur, sa langue, son
// fuseau horaire (pour le pays) et la largeur de l'écran. Les clics sur « Télécharger » (fichier APK) sont comptés aussi.
// Détails : pagio.site/confidentialite/ (statistiques du site).
(() => {
  const send = (path) => {
    try {
      const q = new URLSearchParams(location.search);
      const body = JSON.stringify({
        path, ref: document.referrer || '', utm: q.get('utm_source') || q.get('ref') || '', lang: navigator.language || '',
        tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || ''), w: screen.width || 0,
      });
      fetch('/api/site/hit', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true, credentials: 'omit' }).catch(() => {});
    } catch { /* jamais bloquant */ }
  };
  send(location.pathname);
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href*="/telecharger/"]') : null;
    if (a) send(new URL(a.href, location.href).pathname);
  }, { capture: true });
})();
