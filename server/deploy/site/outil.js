// Pages d'outils : déjà connecté aux outils en ligne (même navigateur) → le bouton mène au compte.
(() => {
  let signedIn = false;
  try { signedIn = !!localStorage.getItem('pagio.web.token'); } catch { /* stockage indisponible */ }
  const a = document.querySelector('.nav-signin');
  if (signedIn && a) { a.textContent = a.dataset.compte; a.href = '/app/#/compte'; }
})();
