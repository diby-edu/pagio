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
- [ ] **APK admin** (demandée le 20/11/2026) : gérer l'application depuis le téléphone exactement comme sur PC (tous les modules du
  tableau de bord). Application à part, jamais publiée : affiche le tableau de bord de `admin.pagio.site` ; au premier lancement elle crée
  une clé dans la puce de sécurité du téléphone et affiche un code, approuvé depuis le PC (*Appareils autorisés*) ; retrait possible depuis le PC.
  Plus tard : notifications (serveur en panne, nouveau message de support).

- [x] Landing page animée FR/EN sur `pagio.site` (20/11/2026), sans aucun lien de connexion.
- [ ] **Pages légales** (demandées le 20/11/2026), liées en pied de page du site et depuis l'application :
  politique de confidentialité (RGPD : données collectées, finalités, durée de conservation, sous-traitants — fournisseur d'IA, Brevo,
  hébergeur —, droits d'accès / rectification / effacement, contact), conditions d'utilisation (offres, crédits IA, abonnements),
  suppression de compte (exigée par Google Play : page publique expliquant comment supprimer son compte et ses données), mentions légales.
  Informations à fournir : nom de l'éditeur (personne ou société), pays, adresse e-mail de contact publique.

- [x] Bouton « Fichier APK » (téléchargement direct, `pagio.site/telecharger/pagio.apk`) et badge Google Play noir habituel (21/11/2026).
- [ ] **Application web** (`app.pagio.site`, proposée le 21/11/2026) : même compte et même Premium que l'APK ; outils dans le navigateur
  (fusion, découpe, rotation, organisation, signature, formulaires, filigrane, numérotation, protection, OCR), conversions et IA par le
  serveur ; photo de document depuis le navigateur du téléphone. Réutilise React/TypeScript du tableau de bord. Après le lancement Play Store.
- [ ] Connexion « avec Google » dans l'application et sur le web (en plus de l'e-mail + mot de passe).
- [ ] Pages légales : éditeur **KODY BUSINESS**, Côte d'Ivoire, +225 0554585927 ; loi ivoirienne n° 2013-450 (ARTCI) + RGPD pour
  les utilisateurs européens. Adresse de contact publique : `contact@pagio.site` (créée le 22/11/2026 : réception par
  ImprovMX renvoyée vers la boîte de l'administrateur, réponses depuis Gmail par le SMTP de Brevo).
- [ ] **Module Système enrichi** (demandé le 22/11/2026, avec l'APK admin) : redémarrage automatique si Pagio ne répond plus,
  historique des pannes et disponibilité du mois, alerte avant l'expiration des certificats HTTPS ; alertes existantes envoyées
  aussi en notification sur l'APK admin, qui vérifie en plus le serveur toutes les 15 minutes (panne complète du VPS).
  UptimeRobot reste en secours.
- [x] Lenteurs de 20 à 50 s après quelques secondes d'inactivité corrigées (maintien TCP sur le port 443, 22/11/2026).
- [x] Clé Brevo gardée active par un contact hebdomadaire sans envoi ; clé refusée = alerte critique (22/11/2026).

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

## Étape 5 — Publication sur Google Play (À LA FIN, décision du 21/11/2026)

- [x] Numéro de version : 2.0.0 (code 20000), calculé automatiquement depuis `versionName` (21/11/2026).
- [x] Publication de l'APK sur le site : `android/publier-apk.sh` (le bouton « Fichier APK » donne toujours la dernière version).
- [ ] Fiche Play Store : titre, description avec les mots recherchés (PDF, scanner, fusionner, compresser), captures d'écran.
- [x] Domaine `pagio.site` authentifié dans Brevo (DKIM, DMARC) et e-mails automatiques actifs depuis `noreply@pagio.site` (22/11/2026).
- [ ] Vers la mi-décembre 2026 : durcir DMARC (`p=none` → `p=quarantine`) une fois les envois bien établis.
- [ ] Tester l'accessibilité avec TalkBack.

## Plus tard

- Passer le dépôt GitHub en privé.
- Renforcer scrypt (`N=65536`) après mesure de la mémoire du VPS.
- Play Integrity pour les outils Premium hors ligne.
- Test de charge sur le VPS à une heure creuse.
- Sentry (analyse des plantages) au lancement Play Store, s'il y a beaucoup d'utilisateurs ; à citer alors comme sous-traitant.

## Décisions

- Public visé : international (application déjà en français et en anglais).
- Distribution : Play Store **et** APK directe.
- Paiement : profil marchand Google existant ; un compte chez un agrégateur de paiement reste à ouvrir pour les ventes sur le site.
