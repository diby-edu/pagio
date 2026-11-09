# Ce que vous devez faire pour que tout fonctionne en conditions réelles

## Indispensable (environ une demi-journée)

1. **Mettre la clé de signature en sécurité** : `deliverables/cle-de-signature/` (fichier `.jks` + `MOT-DE-PASSE.txt`).
   Deux copies hors de cet ordinateur. Sans elle, plus aucune mise à jour possible.
2. **Choisir un nom définitif et l'identifiant** de l'application (`com.pagio.app` aujourd'hui) avant toute publication ;
   vérifier que le nom « Pagio » est libre (INPI / EUIPO) dans vos pays de vente.
3. **Héberger le serveur** (voir `SERVEUR.md`) : un VPS ou Railway/Render avec Docker, un nom de domaine et HTTPS
   (ex. `https://api.votre-domaine.com`). Coût : 5 à 15 € par mois pour démarrer.
4. **Recompiler l'APK avec l'adresse de votre serveur** :
   `./gradlew assembleRelease bundleRelease -Ppagio.serverUrl=https://api.votre-domaine.com`
   (sinon l'application cherche le serveur sur l'ordinateur local et fonctionne en mode autonome).
5. **Vous connecter au tableau de bord** (`https://api.votre-domaine.com`) avec le compte propriétaire, changer le mot de passe,
   créer les comptes de votre équipe.
6. **Rédiger et publier une politique de confidentialité** et des conditions d'utilisation (obligatoires sur Google Play) :
   mentionner les statistiques anonymes facultatives, les comptes, l'IA (texte envoyé au fournisseur choisi), ML Kit.

## Pour publier sur Google Play

7. Compte **Google Play Console** (25 $ une fois), fiche de l'application, captures d'écran (dans `docs/screenshots/`),
   questionnaire « sécurité des données », classification du contenu.
8. Envoyer `deliverables/application.aab` (bundle) — Google livrera ~35 Mo par téléphone au lieu des 88 Mo de l'APK universelle.
9. Tests fermés avec au moins 12 testeurs pendant 14 jours (règle actuelle de Google pour les nouveaux comptes personnels).

## Pour activer les fonctions en ligne

10. **IA générative** : créer un compte chez un fournisseur (OpenAI, Anthropic, Google, Mistral…) ou installer Ollama sur votre serveur,
    puis saisir la clé dans *Tableau de bord › Intelligence artificielle* et activer. Fixer le coût en crédits et les crédits par offre.
11. **Conversions haute fidélité** : rien à faire avec l'image Docker (LibreOffice inclus) ; sinon installer LibreOffice sur le serveur.
12. **Paiements** (si vous vendez Premium) : suivre `COMMERCIAL.md` (Google Play Billing + vérification serveur).
13. **E-mails** (mot de passe oublié automatique) : choisir un service (Brevo, Mailjet, Amazon SES…) et le brancher sur la route
    `/api/auth/forgot` (`server/src/app.js`). En attendant, les demandes apparaissent dans *Avis et support*.

## Base de données : rien à installer

SQLite est intégré au serveur (fichier `pagio.db`). Pensez seulement aux **sauvegardes quotidiennes** de ce fichier.
PostgreSQL ne deviendra utile qu'au-delà de plusieurs dizaines de milliers d'utilisateurs actifs (voir `SERVEUR.md`).

## Avant le lancement

14. Tester sur 2 ou 3 vrais téléphones (dont un Android 10–12 d'entrée de gamme) : scanner avec l'appareil photo,
    gros PDF (50–100 pages), traduction, partage depuis WhatsApp / Gmail.
15. Fixer vos règles dans le tableau de bord : quotas gratuits, outils Premium, annonce de lancement.
