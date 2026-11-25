// E-mails automatiques : envoi par l'API de Brevo (aucune bibliothèque à installer), modèles de messages et
// pages web minimales ouvertes depuis les liens reçus (nouveau mot de passe, confirmation d'adresse).
import crypto from 'node:crypto';

/** Les jetons envoyés par e-mail ne sont jamais stockés tels quels : seule leur empreinte est en base. */
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Envoie un message par Brevo. `mail` : réglages (api_key, from_email, from_name).
 * Lève une erreur lisible si Brevo refuse (clé invalide, expéditeur non validé…).
 */
export async function sendWithBrevo(mail, { to, subject, text, html, replyTo }) {
  if (!mail.api_key) throw new Error("Clé d'API Brevo manquante");
  if (!mail.from_email) throw new Error("Adresse d'expéditeur manquante");
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', signal: AbortSignal.timeout(20_000),
    headers: { 'content-type': 'application/json', accept: 'application/json', 'api-key': mail.api_key },
    body: JSON.stringify({
      sender: { email: mail.from_email, name: mail.from_name || 'Pagio' },
      to: [{ email: to }], subject, textContent: text, htmlContent: html,
      ...(replyTo ? { replyTo: { email: replyTo } } : {}),
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error("Brevo ne reconnaît pas cette clé d'API (clé erronée, incomplète ou désactivée)");
  if (!r.ok) throw new Error(`Brevo a refusé l'envoi : ${j?.message || `erreur ${r.status}`}`);
  return { id: j.messageId || null };
}

/**
 * Contact avec Brevo sans envoyer d'e-mail : Brevo désactive une clé d'API restée 90 jours sans servir, et Pagio peut
 * n'envoyer aucun e-mail pendant longtemps. Lit les statistiques d'envoi du jour (droit « E-mails transactionnels »
 * suffisant). Ne lève jamais d'erreur : renvoie { ok, status, message }.
 */
export async function pingBrevo(apiKey) {
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/statistics/aggregatedReport?days=1', {
      signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json', 'api-key': apiKey },
    });
    if (r.ok) return { ok: true, status: r.status, message: '' };
    const j = await r.json().catch(() => ({}));
    const message = r.status === 401 ? "Brevo ne reconnaît plus la clé d'API (expirée, supprimée ou adresse IP du serveur non autorisée)"
      : `Brevo a répondu : ${String(j?.message || `erreur ${r.status}`).slice(0, 200)}`;
    return { ok: false, status: r.status, message };
  } catch (e) {
    return { ok: false, status: 0, message: `Brevo injoignable : ${String(e.message).slice(0, 200)}` };
  }
}

// ---------------------------------------------------------------------------- Modèles de messages

const layout = (title, bodyHtml) => `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f3fa;font-family:Arial,Helvetica,sans-serif;color:#1c1b2e">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="background:#ffffff;border-radius:14px;padding:28px">
<div style="font-size:20px;font-weight:bold;color:#5B4BDB;margin-bottom:18px">Pagio</div>
<h1 style="font-size:18px;margin:0 0 14px">${esc(title)}</h1>
${bodyHtml}
</div>
<p style="font-size:12px;color:#77758a;text-align:center;margin-top:16px">Message automatique : merci de ne pas y répondre.</p>
</div></body></html>`;

const button = (url, label) => `<p style="margin:22px 0"><a href="${esc(url)}" style="background:#5B4BDB;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold;display:inline-block">${esc(label)}</a></p>
<p style="font-size:12px;color:#77758a;word-break:break-all">Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :<br>${esc(url)}</p>`;

export const messages = {
  reset: (url) => ({
    subject: 'Pagio : choisissez un nouveau mot de passe',
    text: `Bonjour,\n\nVous avez demandé à changer le mot de passe de votre compte Pagio.\nOuvrez ce lien pour en choisir un nouveau (valable 1 heure) :\n${url}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.`,
    html: layout('Choisissez un nouveau mot de passe', `<p>Vous avez demandé à changer le mot de passe de votre compte Pagio. Ce lien est valable 1 heure.</p>${button(url, 'Choisir un nouveau mot de passe')}<p>Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.</p>`),
  }),
  // À l'inscription : e-mail d'information (le compte est créé et utilisable tout de suite). La confirmation de
  // l'adresse y est seulement recommandée (elle sert à retrouver le mot de passe) ; `url` absent = adresse déjà
  // confirmée (inscription avec Google).
  welcome: (url, credits, site) => {
    const tools = `${site}/outils/`;
    const confirmText = url ? `\n\nRecommandé : confirmez votre adresse e-mail. Elle vous permettra de retrouver votre mot de passe si vous l'oubliez :\n${url}\n(Rien ne change si vous ne le faites pas tout de suite : le lien peut être renvoyé à tout moment depuis Réglages › Compte.)` : '';
    return {
      subject: 'Bienvenue sur Pagio : votre compte est créé',
      text: `Bienvenue sur Pagio !\n\nVotre compte est créé et prêt à l'emploi : vous pouvez déjà utiliser tous les outils PDF, dans l'application Android et sur ${site}.\nVous disposez de ${credits} crédits pour l'assistant IA.${confirmText}\n\nTous les outils : ${tools}\n\nSi vous n'avez pas créé de compte Pagio, ignorez ce message ou répondez-y pour nous prévenir.`,
      html: layout('Bienvenue sur Pagio', `<p>Votre compte est <b>créé et prêt à l'emploi</b> : vous pouvez déjà utiliser tous les outils PDF, dans l'application Android et sur <a href="${esc(site)}">${esc(site.replace(/^https?:\/\//, ''))}</a>.</p>`
        + `<p>Vous disposez de <b>${esc(credits)} crédits</b> pour l'assistant IA.</p>`
        + (url ? `<p style="margin-top:22px"><b>Recommandé :</b> confirmez votre adresse e-mail. Elle vous permettra de retrouver votre mot de passe si vous l'oubliez.</p>${button(url, 'Confirmer mon adresse')}<p style="color:#6b6a80;font-size:13px">Rien ne change si vous ne le faites pas tout de suite : le lien peut être renvoyé à tout moment depuis Réglages › Compte.</p>` : '')
        + `<p><a href="${esc(tools)}">Voir tous les outils</a></p><p style="color:#6b6a80;font-size:13px">Si vous n'avez pas créé de compte Pagio, ignorez ce message ou répondez-y pour nous prévenir.</p>`),
    };
  },
  // Renvoyé à la demande depuis le compte : seulement le lien de confirmation.
  verify: (url) => ({
    subject: 'Pagio : confirmez votre adresse e-mail',
    text: `Bonjour,\n\nVoici le lien pour confirmer votre adresse e-mail sur Pagio. Elle vous permettra de retrouver votre mot de passe si vous l'oubliez :\n${url}\n\nSi vous n'avez rien demandé, ignorez ce message.`,
    html: layout('Confirmez votre adresse', `<p>Voici le lien pour confirmer votre adresse e-mail sur Pagio. Elle vous permettra de retrouver votre mot de passe si vous l'oubliez.</p>${button(url, 'Confirmer mon adresse')}<p style="color:#6b6a80;font-size:13px">Si vous n'avez rien demandé, ignorez ce message.</p>`),
  }),
  test: () => ({
    subject: "Pagio : e-mail d'essai",
    text: "Ceci est un e-mail d'essai envoyé depuis le tableau de bord Pagio. S'il vous parvient, l'envoi d'e-mails fonctionne.",
    html: layout("E-mail d'essai", "<p>Ceci est un e-mail d'essai envoyé depuis le tableau de bord Pagio. S'il vous parvient, l'envoi d'e-mails fonctionne.</p>"),
  }),
  // Rapport du lundi : la semaine écoulée comparée à la précédente.
  weekly: (r, url) => {
    const evo = (a, b) => (b ? ` (${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)} %)` : '');
    const n = (x) => Number(x || 0).toLocaleString('fr-FR');
    const lines = [
      ['Visiteurs du site', `${n(r.visitors)}${evo(r.visitors, r.prev.visitors)}`],
      ["Installations de l'application", `${n(r.installs)}${evo(r.installs, r.prev.installs)}`],
      ['Appareils actifs', `${n(r.active)}${evo(r.active, r.prev.active)}`],
      ['Comptes créés', `${n(r.accounts)}${evo(r.accounts, r.prev.accounts)}`],
      ['Revenus', `${n(r.revenue)} F${evo(r.revenue, r.prev.revenue)}`],
      ['Premium actifs', n(r.premium_active)],
      ["Utilisations d'outils", `${n(r.runs)}${evo(r.runs, r.prev.runs)}`],
      ["Coût estimé de l'IA", `${n(r.ai_cost)} F`],
      ['Disponibilité de Pagio', r.uptime == null ? '—' : `${String(r.uptime).replace('.', ',')} %`],
      ['Erreurs du serveur', n(r.errors)],
    ];
    const top = (title, list) => (list.length ? `${title} : ${list.map((x) => `${x.k} (${n(x.n)})`).join(', ')}` : '');
    const tops = [top('Outils les plus utilisés', r.top_tools), top('Pays', r.top_countries), top('Provenance des visiteurs', r.top_sources)].filter(Boolean);
    return {
      subject: `Pagio : votre semaine (${r.period})`,
      text: `Rapport de la semaine ${r.period} (comparé à la semaine précédente)\n\n${lines.map(([k, v]) => `- ${k} : ${v}`).join('\n')}\n\n${tops.join('\n')}\n\n${url ? `Tableau de bord : ${url}` : ''}`,
      html: layout(`Votre semaine : ${r.period}`, `<table style="width:100%;border-collapse:collapse">${lines.map(([k, v]) => `<tr><td style="padding:6px 0;color:#55536b">${esc(k)}</td><td style="padding:6px 0;text-align:right;font-weight:bold">${esc(v)}</td></tr>`).join('')}</table>
${tops.map((t) => `<p style="font-size:14px">${esc(t)}</p>`).join('')}${url ? button(url, 'Ouvrir les statistiques') : ''}<p style="font-size:12px;color:#77758a">Comparaison avec la semaine précédente entre parenthèses. Rapport envoyé chaque lundi ; désactivable dans le tableau de bord (page E-mails).</p>`),
    };
  },
  // Réponse du support : la personne peut répondre directement (réponse adressée à contact@pagio.site).
  supportReply: (original, reply) => ({
    subject: 'Pagio : réponse à votre message',
    text: `Bonjour,\n\n${reply}\n\nL'équipe Pagio\n\n---\nVotre message :\n${original}`,
    html: layout('Réponse à votre message', `<div style="white-space:pre-wrap">${esc(reply)}</div><p>L'équipe Pagio</p>
<blockquote style="margin:18px 0 0;padding:10px 14px;border-left:3px solid #d9d7ea;color:#77758a;white-space:pre-wrap;font-size:13px">${esc(original)}</blockquote>`)
      .replace('Message automatique : merci de ne pas y répondre.', 'Vous pouvez répondre directement à cet e-mail.'),
  }),
  // Campagne : message libre (sauts de ligne gardés), lien de désinscription obligatoire en bas.
  campaign: (subject, body, name, unsub) => ({
    subject,
    text: `${name ? `Bonjour ${name},\n\n` : ''}${body}\n\n—\nPagio · pagio.site\nNe plus recevoir ces e-mails : ${unsub}`,
    html: layout(subject, `${name ? `<p>Bonjour ${esc(name)},</p>` : ''}<div style="white-space:pre-wrap">${esc(body).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</div>`)
      .replace('Message automatique : merci de ne pas y répondre.', `Vous recevez cet e-mail car vous avez un compte Pagio. <a href="${esc(unsub)}" style="color:#77758a">Ne plus recevoir ces e-mails</a>`),
  }),
  alerts: (list, url) => ({
    subject: `Pagio : ${list.length} alerte(s) sur le serveur`,
    text: `Le serveur Pagio signale :\n\n${list.map((a) => `- [${a.level === 'critical' ? 'URGENT' : 'À surveiller'}] ${a.message}`).join('\n')}\n\n${url ? `Tableau de bord : ${url}\n\n` : ''}Chaque alerte n'est renvoyée qu'une fois par jour tant qu'elle dure.`,
    html: layout('Alertes du serveur', `<ul style="padding-left:18px">${list.map((a) => `<li style="margin-bottom:8px"><b style="color:${a.level === 'critical' ? '#c0392b' : '#b7791f'}">${a.level === 'critical' ? 'Urgent' : 'À surveiller'}</b> : ${esc(a.message)}</li>`).join('')}</ul>${url ? button(url, 'Ouvrir le tableau de bord') : ''}<p style="font-size:12px;color:#77758a">Chaque alerte n'est renvoyée qu'une fois par jour tant qu'elle dure.</p>`),
  }),
};

// ---------------------------------------------------------------------------- Pages web ouvertes depuis les e-mails
// Sans script (la politique de sécurité du serveur les interdit hors du tableau de bord) : simples formulaires.

export const page = (title, bodyHtml) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} – Pagio</title>
<style>body{margin:0;background:#f4f3fa;font-family:system-ui,Arial,sans-serif;color:#1c1b2e}main{max-width:420px;margin:8vh auto;padding:0 16px}
.card{background:#fff;border-radius:16px;padding:28px;box-shadow:0 2px 12px rgba(40,30,120,.08)}.brand{font-size:22px;font-weight:700;color:#5B4BDB;margin-bottom:16px}
h1{font-size:19px;margin:0 0 12px}label{display:block;font-size:14px;font-weight:600;margin:14px 0 6px}
input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #d9d7ea;border-radius:10px;font-size:16px}
button{margin-top:18px;width:100%;padding:13px;border:0;border-radius:10px;background:#5B4BDB;color:#fff;font-size:16px;font-weight:700;cursor:pointer}
.err{background:#fdecea;color:#a12a1f;padding:10px 12px;border-radius:10px;margin-bottom:12px}.ok{color:#1d7a4f;font-weight:600}.muted{color:#77758a;font-size:13px}</style></head>
<body><main><div class="card"><div class="brand">Pagio</div><h1>${esc(title)}</h1>${bodyHtml}</div></main></body></html>`;

export const resetForm = (token, error = '') => page('Nouveau mot de passe', `${error ? `<div class="err">${esc(error)}</div>` : ''}
<form method="post" action="/reinitialiser"><input type="hidden" name="token" value="${esc(token)}">
<label for="p1">Nouveau mot de passe</label><input id="p1" name="password" type="password" minlength="8" required autocomplete="new-password">
<label for="p2">Confirmez-le</label><input id="p2" name="confirm" type="password" minlength="8" required autocomplete="new-password">
<p class="muted">8 caractères minimum.</p><button type="submit">Enregistrer</button></form>`);

export const messagePage = (title, text, good = true) => page(title, `<p class="${good ? 'ok' : 'err'}">${esc(text)}</p><p class="muted">Vous pouvez fermer cette page et revenir dans l'application Pagio.</p>`);
