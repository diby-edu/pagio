# Plan Pagio — établi le 20 novembre 2026

État de départ : serveur en ligne sur `https://pagio.site` (HTTPS, corrections de l'audit déployées, contre-audit
48 contrôles sans faille), APK v9 signée dans `android/apk/pagio-v9.apk`.

## Étape 0 — À faire par vous, tout de suite (≈ 15 min)

- [ ] Activer la double authentification sur le compte propriétaire (*Mon compte et sécurité › Double authentification*) et noter les 8 codes de secours hors de l'ordinateur.
- [ ] Installer la v9 sur un vrai téléphone : connexion, conversion d'un Word, une requête IA.
- [ ] Copier hors du serveur `jwt-secret.key`, `secrets.key` et une sauvegarde téléchargée depuis le tableau de bord.
- [ ] Créer une surveillance gratuite (UptimeRobot ou équivalent) sur `https://pagio.site/api/health`, toutes les 5 minutes, alerte par e-mail ou SMS.

## Étape 1 — Petits travaux serveur

- [ ] Enregistrer dans Git la documentation et le script de test mis à jour.
- [ ] Régler « compte exigé pour la conversion en ligne » (LibreOffice fermé aux anonymes).
- [x] Faire tourner LibreOffice avec un utilisateur sans droits dans le conteneur (fait le 20/11/2026).
- [ ] (Hors Pagio, avec votre accord) certificats expirés ou presque : `numerik360.com`, `sms.numerik360.com`.

## Étape 2 — Limites de l'offre gratuite (nouvelle APK v10)

- [ ] **1 scan = 1 document enregistré**, quel que soit le nombre de pages ; compté à l'enregistrement, un scan abandonné ne compte pas.
- [ ] Nouvelle colonne **« Par jour (gratuit) »** pour chaque outil dans *Outils et limites* (0 = illimité), plus **« Pages max par scan »** pour le scanner.
- [ ] L'application vérifie la limite **au début** d'une opération (jamais en plein travail) et affiche un message clair avec le passage au Premium.
- [ ] Réglages de départ proposés : **10 scans / jour** (20 pages max par scan), **5 / jour** pour les autres outils ; Premium illimité.
- [ ] Ajuster ensuite selon les chiffres du tableau de bord (combien atteignent la limite, combien passent au Premium) — sans nouvelle APK.

## Étape 3 — Tableau de bord invisible et site public

- [ ] Page publique sur `pagio.site` : présentation, politique de confidentialité, suppression de compte (exigées par Google Play), en français et en anglais. **Validé.**
- [x] Le tableau de bord et `/api/admin` retirés de pagio.site, www et pagio.hebergementci.com (20/11/2026).
- [ ] Accès admin réservé à vos appareils par **certificat d'appareil** (choisi le 20/11/2026) :
  - `admin.pagio.site` (enregistrement DNS chez Hostinger + certificat HTTPS) ; Nginx exige un certificat client signé par une autorité Pagio privée, sinon la connexion est refusée ;
  - un certificat par appareil (PC, téléphone), installé une fois, révocable un par un ;
  - l'autorité privée et ses clés restent sur le VPS (hors du conteneur) avec une copie hors du serveur ;
  - ensuite, mot de passe + double authentification comme aujourd'hui.

## Étape 4 — Modèle économique et paiements

Principe : outils du téléphone gratuits et généreux (ils ne coûtent rien), usage du serveur payant (IA, conversions).

| Offre | Contenu | Prix à tester (FCFA) |
|---|---|---|
| Gratuit | outils du téléphone dans les limites de l'étape 2, quelques crédits IA par mois | 0 |
| Pass semaine | Premium complet 7 jours | 300 à 500 |
| Premium mensuel | IA incluse (plafond raisonnable), conversions et outils illimités | 1 000 à 2 000 |
| Premium annuel | environ 2 mois offerts | 10 000 à 15 000 |
| Recharges IA | sans abonnement | ex. 100 crédits pour 500 |

- [ ] Paiement Google Play dans la version Play Store (obligatoire pour les achats faits dans une application du Play Store) ; profil marchand Google déjà existant. Google adapte les prix à chaque pays.
- [ ] Version APK directe (hors Play Store) : pas de paiement Google Play possible → paiement sur `pagio.site` : carte (Stripe ou équivalent) pour l'international, mobile money (Orange Money, MTN, Wave, Moov via CinetPay, PayDunya…) pour l'Afrique.
- [ ] Le Premium acheté sur le site est reconnu dans l'application par le compte, quelle que soit la version installée.
- [ ] Prix par zone : grille FCFA ci-dessus pour l'Afrique ; grille en euros / dollars pour les autres pays (Play Store : prix réglés pays par pays).
- [ ] Vérifier les règles Play Store du moment sur les paiements extérieurs avant de lancer.
- [ ] À étudier : mention « Créé avec Pagio » sur les PDF en gratuit ; vidéo récompensée (+3 opérations) ; offre Pro / équipe pour secrétariats, cybercafés, écoles, PME.
- [ ] Vérifier le coût réel de l'IA sur les factures du fournisseur avant de fixer les prix.

## Étape 5 — Publication sur Google Play

- [ ] Augmenter `versionCode` (toujours à 1).
- [ ] Fiche Play Store : titre, description avec les mots recherchés (PDF, scanner, fusionner, compresser), captures d'écran.
- [ ] Authentifier le domaine `pagio.site` dans Brevo (SPF, DKIM, DMARC) avant d'activer les e-mails.
- [ ] Tester l'accessibilité avec TalkBack.

## Plus tard

- Passer le dépôt GitHub en privé.
- Renforcer scrypt (`N=65536`) après mesure de la mémoire du VPS.
- Play Integrity pour les outils Premium hors ligne.
- Test de charge sur le VPS à une heure creuse.

## Décisions

- Public visé : international (application déjà en français et en anglais).
- Distribution : Play Store **et** APK directe.
- Paiement : profil marchand Google existant ; un compte chez un agrégateur de paiement reste à ouvrir pour les ventes sur le site.
