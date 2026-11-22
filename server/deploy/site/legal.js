// Pages légales : choix FR / EN partagé avec la page d'accueil (clé pagio.lang), ?lang=en dans l'adresse possible.
(() => {
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* indisponible */ } } };
  const asked = new URLSearchParams(location.search).get('lang');
  let lang = asked === 'en' || asked === 'fr' ? asked : store.get('pagio.lang') || ((navigator.language || 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en');
  const titles = JSON.parse(document.body.dataset.titles || '{}');
  const apply = () => {
    document.documentElement.lang = lang;
    document.querySelectorAll('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    if (titles[lang]) document.title = titles[lang];
  };
  document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => { lang = b.dataset.lang; store.set('pagio.lang', lang); apply(); }));
  apply();
  const y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();
})();
