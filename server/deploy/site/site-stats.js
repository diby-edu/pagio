// Mesure de fréquentation de pagio.site, sans cookies ni stockage : la page vue, d'où vient le visiteur, sa langue, son
// fuseau horaire (pour le pays) et la largeur de l'écran. Les clics sur « Télécharger » (fichier APK) sont comptés aussi.
// Détails : pagio.site/confidentialite/ (statistiques du site).
(() => {
  const send = (path) => {
    try {
      const q = new URLSearchParams(location.search);
      // Lien de parrainage (pagio.site/?ref=CODE) : le code est gardé pour l'inscription sur les outils en ligne.
      const ref = q.get('ref');
      if (ref && /^[A-Za-z0-9]{4,12}$/.test(ref)) { try { localStorage.setItem('pagio.ref', ref.toUpperCase()); } catch { /* indisponible */ } }
      const body = JSON.stringify({
        path, ref: document.referrer || '', utm: q.get('utm_source') || (ref ? 'parrainage' : ''), lang: navigator.language || '',
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

// Google Analytics (facultatif, avec accord) sur toutes les pages du site. La page d'accueil a son propre bandeau.
// Le choix (accepter / refuser) est le même partout : il est gardé dans le navigateur (pagio.consent).
(() => {
  if (location.pathname === '/' || location.pathname === '/index.html') return;
  let choice = null; try { choice = localStorage.getItem('pagio.consent'); } catch { /* indisponible */ }
  if (choice === 'non') return;
  fetch('/api/app/config', { credentials: 'omit' }).then((r) => r.json()).then((conf) => {
    const id = conf && conf.ga_id;
    if (!id || !/^G-[A-Z0-9]{4,16}$/.test(id)) return;
    const load = () => {
      const s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id); document.head.appendChild(s);
      window.dataLayer = window.dataLayer || []; window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag('js', new Date()); window.gtag('config', id);
    };
    if (choice === 'oui') return load();
    const en = (document.documentElement.lang || '').startsWith('en');
    const t = en
      ? { msg: 'We would like to measure site traffic with Google Analytics (cookies). It is optional.', more: 'Learn more', no: 'Decline', ok: 'Accept', link: '/confidentialite/' }
      : { msg: "Nous aimerions mesurer la fréquentation du site avec Google Analytics (cookies). C'est facultatif.", more: 'En savoir plus', no: 'Refuser', ok: 'Accepter', link: '/confidentialite/' };
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const box = document.createElement('div');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Cookies');
    box.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:60;max-width:560px;margin:0 auto;padding:16px 18px;border-radius:18px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;font:14px/1.5 system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.18);'
      + (dark ? 'background:#1c1d33;color:#f1f1f6;border:1px solid #34365a;' : 'background:#fff;color:#14152b;border:1px solid #e3e3ee;');
    const btn = (label, c, main) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.c = c;
      b.style.cssText = 'font:inherit;font-weight:700;padding:9px 16px;border-radius:12px;cursor:pointer;border:1px solid ' + (dark ? '#34365a' : '#e3e3ee') + ';'
        + (main ? (dark ? 'background:#f1f1f6;color:#14152b;' : 'background:#14152b;color:#fff;') : 'background:transparent;color:inherit;');
      return b;
    };
    const p = document.createElement('p'); p.style.cssText = 'margin:0;flex:1 1 260px;';
    const a = document.createElement('a'); a.href = t.link; a.textContent = t.more; a.style.color = 'inherit';
    p.append(t.msg + ' ', a);
    box.append(p, btn(t.no, 'non', false), btn(t.ok, 'oui', true));
    box.addEventListener('click', (e) => {
      const c = e.target instanceof Element && e.target.closest('button') ? e.target.closest('button').dataset.c : null; if (!c) return;
      try { localStorage.setItem('pagio.consent', c); } catch { /* indisponible */ }
      box.remove(); if (c === 'oui') load();
    });
    document.body.appendChild(box);
  }).catch(() => {});
})();
