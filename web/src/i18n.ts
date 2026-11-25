// Langue de l'application web : français ou anglais, choix partagé avec pagio.site (clé « pagio.lang »).
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* indisponible */ } } };

export type Lang = 'fr' | 'en';
export let lang: Lang = (store.get('pagio.lang') as Lang) || ((navigator.language || 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en');
export function setLang(l: Lang) { lang = l; store.set('pagio.lang', l); document.documentElement.lang = l; }
document.documentElement.lang = lang;

const FR = {
  nav_tools: 'Outils', nav_privacy: 'Confidentialité', nav_ai: 'Assistant IA', nav_online: 'Outils en ligne', nav_cta: 'Télécharger',
  tools: 'Outils', account: 'Mon compte', signin: 'Se connecter', signout: 'Se déconnecter', signup: 'Créer un compte',
  hero: 'Vos PDF, directement dans le navigateur.', hero_sub: "Les outils de base fonctionnent sur votre ordinateur : vos fichiers ne sont pas envoyés. Conversion et IA passent par le serveur Pagio, avec le même compte que l'application Android.",
  local: 'Sur votre appareil', server: 'Serveur Pagio', needs_account: 'Compte requis', premium: 'Premium',
  apk: "Scanner des documents ? Utilisez l'application Android.", get_apk: "Télécharger l'application",
  choose: 'Choisir des fichiers', drop: 'ou déposez-les ici', run: 'Lancer', working: 'Traitement…', download: 'Télécharger le résultat', again: 'Recommencer',
  files: 'fichier(s)', remove: 'Retirer', up: 'Monter', down: 'Descendre', back: '← Tous les outils',
  pages_label: 'Pages (ex. 1-3, 5, 8-10)', angle: 'Rotation', text: 'Texte', position: 'Position', bottom: 'En bas', top: 'En haut', start_at: 'Commencer à',
  question: 'Votre question (laisser vide pour un résumé)', answer: 'Réponse', credits_left: 'Crédits IA restants : %s', to_format: 'Convertir en',
  email: 'E-mail', password: 'Mot de passe', name: 'Nom (facultatif)', forgot: 'Mot de passe oublié ?', send_link: 'Recevoir un lien',
  have_account: "J'ai déjà un compte", no_account: "Pas encore de compte ? S'inscrire", or: 'ou', google: 'Continuer avec Google',
  signin_title: 'Connexion à Pagio', signup_title: 'Créer votre compte Pagio', forgot_title: 'Mot de passe oublié',
  same_account: "Même compte que l'application Android : votre offre et vos crédits IA sont partagés.",
  plan: 'Offre', free: 'Gratuite', premium_until: "Premium jusqu'au %s", ai_credits: 'Crédits IA', email_ok: 'Adresse confirmée', email_ko: 'Adresse non confirmée', resend: 'Renvoyer le lien',
  promo_title: 'Vous avez un code ?', promo_ph: 'Code promo', promo_btn: 'Valider', ref_title: 'Parrainez vos proches', ref_text: 'Partagez votre lien : quand une personne inscrite avec lui prend Premium, vous recevez %s jours de Premium offerts.', ref_stats: '%s inscrit(s) avec votre lien, dont %s ont pris Premium.', copy: 'Copier le lien', copied: 'Lien copié', share_wa: 'Partager sur WhatsApp', share_msg: 'Tous vos PDF dans votre poche, gratuitement :',
  delete_account: 'Supprimer mon compte', delete_confirm: 'Supprimer définitivement votre compte et ses données ? Cette action est irréversible.',
  limit_reached: "Vous avez utilisé cet outil %s fois aujourd'hui, la limite de l'offre gratuite. Il sera de nouveau disponible demain. Avec Premium, il est illimité.",
  login_needed: 'Connectez-vous pour utiliser cet outil (il passe par le serveur Pagio).',
  premium_only: "Cet outil est réservé à l'offre Premium.", verify_sent: 'E-mail de confirmation envoyé.', link_sent: 'Si un compte existe pour cette adresse, un e-mail vient de partir.',
  legal: 'Confidentialité', terms: 'Conditions', del_page: 'Suppression de compte', notice: 'Mentions légales',
  t_merge: 'Fusionner', d_merge: 'Assembler plusieurs PDF en un seul, dans l\'ordre choisi.',
  t_extract_pages: 'Extraire des pages', d_extract_pages: 'Garder seulement certaines pages dans un nouveau PDF.',
  t_delete_pages: 'Supprimer des pages', d_delete_pages: 'Retirer les pages inutiles.',
  t_rotate: 'Faire pivoter', d_rotate: 'Tourner toutes les pages, ou seulement certaines.',
  t_images_to_pdf: 'Images en PDF', d_images_to_pdf: 'Transformer des photos JPG ou PNG en un PDF.',
  t_page_numbers: 'Numéroter les pages', d_page_numbers: 'Ajouter « 1 / 12 » en bas ou en haut de chaque page.',
  t_watermark: 'Filigrane', d_watermark: 'Inscrire un texte en travers de chaque page (« CONFIDENTIEL »…).',
  t_office_to_pdf: 'Office en PDF', d_office_to_pdf: 'Word, Excel, PowerPoint en PDF fidèle, par le serveur Pagio.',
  t_assistant: 'Résumer avec l\'IA', d_assistant: 'Résumé ou réponse à une question sur un PDF, par l\'assistant IA.',
};
type Key = keyof typeof FR;
const EN: Record<Key, string> = {
  nav_tools: 'Tools', nav_privacy: 'Privacy', nav_ai: 'AI assistant', nav_online: 'Online tools', nav_cta: 'Download',
  tools: 'Tools', account: 'My account', signin: 'Sign in', signout: 'Sign out', signup: 'Create an account',
  hero: 'Your PDFs, right in the browser.', hero_sub: 'Basic tools run on your computer: your files are not uploaded. Conversion and AI go through the Pagio server, with the same account as the Android app.',
  local: 'On your device', server: 'Pagio server', needs_account: 'Account required', premium: 'Premium',
  apk: 'Scanning documents? Use the Android app.', get_apk: 'Download the app',
  choose: 'Choose files', drop: 'or drop them here', run: 'Run', working: 'Working…', download: 'Download the result', again: 'Start again',
  files: 'file(s)', remove: 'Remove', up: 'Up', down: 'Down', back: '← All tools',
  pages_label: 'Pages (e.g. 1-3, 5, 8-10)', angle: 'Rotation', text: 'Text', position: 'Position', bottom: 'Bottom', top: 'Top', start_at: 'Start at',
  question: 'Your question (leave empty for a summary)', answer: 'Answer', credits_left: 'AI credits left: %s', to_format: 'Convert to',
  email: 'E-mail', password: 'Password', name: 'Name (optional)', forgot: 'Forgot your password?', send_link: 'Send me a link',
  have_account: 'I already have an account', no_account: 'No account yet? Sign up', or: 'or', google: 'Continue with Google',
  signin_title: 'Sign in to Pagio', signup_title: 'Create your Pagio account', forgot_title: 'Forgotten password',
  same_account: 'Same account as the Android app: your plan and AI credits are shared.',
  plan: 'Plan', free: 'Free', premium_until: 'Premium until %s', ai_credits: 'AI credits', email_ok: 'Address confirmed', email_ko: 'Address not confirmed', resend: 'Resend the link',
  promo_title: 'Have a code?', promo_ph: 'Promo code', promo_btn: 'Apply', ref_title: 'Invite your friends', ref_text: 'Share your link: when someone who signed up with it goes Premium, you get %s days of Premium free.', ref_stats: '%s signed up with your link, %s went Premium.', copy: 'Copy link', copied: 'Link copied', share_wa: 'Share on WhatsApp', share_msg: 'All your PDFs in your pocket, for free:',
  delete_account: 'Delete my account', delete_confirm: 'Permanently delete your account and its data? This cannot be undone.',
  limit_reached: 'You have used this tool %s times today, the free plan limit. It will be available again tomorrow. With Premium, it is unlimited.',
  login_needed: 'Sign in to use this tool (it goes through the Pagio server).',
  premium_only: 'This tool is part of the Premium plan.', verify_sent: 'Confirmation e-mail sent.', link_sent: 'If an account exists for this address, an e-mail is on its way.',
  legal: 'Privacy', terms: 'Terms', del_page: 'Account deletion', notice: 'Legal notice',
  t_merge: 'Merge', d_merge: 'Combine several PDFs into one, in the order you choose.',
  t_extract_pages: 'Extract pages', d_extract_pages: 'Keep only some pages in a new PDF.',
  t_delete_pages: 'Delete pages', d_delete_pages: 'Remove the pages you do not need.',
  t_rotate: 'Rotate', d_rotate: 'Turn all pages, or only some of them.',
  t_images_to_pdf: 'Images to PDF', d_images_to_pdf: 'Turn JPG or PNG photos into a PDF.',
  t_page_numbers: 'Page numbers', d_page_numbers: 'Add "1 / 12" at the bottom or top of every page.',
  t_watermark: 'Watermark', d_watermark: 'Write a text across every page ("CONFIDENTIAL"…).',
  t_office_to_pdf: 'Office to PDF', d_office_to_pdf: 'Word, Excel, PowerPoint to an accurate PDF, by the Pagio server.',
  t_assistant: 'Summarise with AI', d_assistant: 'Summary of a PDF, or an answer to a question about it, by the AI assistant.',
};

export function t(k: Key, ...args: (string | number)[]): string {
  let s = (lang === 'fr' ? FR : EN)[k] ?? FR[k];
  for (const a of args) s = s.replace('%s', String(a));
  return s;
}
export type { Key };
