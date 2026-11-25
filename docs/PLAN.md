# Plan Pagio — refait le 23 novembre 2026

Ce qui est déjà en place est résumé tout en bas (« Fait »). Tout le reste est ici, dans l'ordre, avec qui le fait.

---

## A. À faire par vous (en attente)

| # | Action | Pourquoi | Durée |
|---|---|---|---|
| A1 | ~~Essayer la 2.1.0~~ **fait le 24/11** (scan, case PDF, flash, liens légaux ; 2.1.0 publiée) ; outils IA passés en Premium | — | — |
| A2 | ~~Pagio Admin + certificat du téléphone~~ **fait le 24/11** (téléphone inscrit aux notifications) | — | — |
| A3 | ~~UptimeRobot~~ **fait le 24/11** : `pagio.site` et `pagio.site/api/health` toutes les 5 min, alerte par e-mail (application mobile UptimeRobot : à installer si vous voulez les alertes sur le téléphone) | — | — |
| A4 | ~~Plafond OpenAI~~ **fait le 24/11** : projet OpenAI « PAGIO » séparé, plafond **bloquant de 10 $/mois**, nouvelle clé collée dans l'administration (ancienne clé « ILOVE » à désactiver) | — | — |
| A5 | ~~Identifiant Google~~ **fait le 24/11** : projet Google Cloud `pagio-515720` (compte kodybusiness), application « En production », ID client web enregistré ; bouton « Continuer avec Google » visible sur pagio.site/app | — | — |
| A6 | ~~Codes de secours~~ **fait le 24/11** (nouveaux codes créés et notés sur papier) | — | — |
| A7 | ~~Copie de sécurité hors du serveur~~ **fait le 24/11** (clés + base sur clé USB ; à refaire une fois par mois) | — | — |
| A8 | **Hostinger** : vérifier que le moyen de paiement est à jour — le VPS **expire le 20/12/2026** (renouvellement automatique activé) | Éviter l'arrêt du VPS | 2 min |
| A9 | Si disponibles : **RCCM** et **adresse du siège** de KODY BUSINESS | Mentions légales complètes | — |
| A10 | **Google Search Console** : créer la propriété `pagio.site` (je pose ensuite la ligne de vérification chez Hostinger) | Référencement | 5 min |
| A11 | **Google Analytics** : créer une propriété « Pagio », copier l'identifiant `G-XXXX` dans l'administration | Statistiques Google | 5 min |
| A12 | Plus tard : **compte Play Console** (25 $, D-U-N-S pour KODY BUSINESS), fiche, produits (`docs/GOOGLE.md`, partie B) | Publication Play Store | — |
| A13 | Plus tard : **compte chez un agrégateur de paiement** (CinetPay, PayDunya…) pour mobile money et carte | Paiement sur le site | — |

Décisions qui vous restent : fermer ou non la conversion en ligne aux visiteurs **sans compte** (recommandé : oui) ; me laisser ou non
renouveler les certificats expirés de vos **autres sites** (`numerik360.com`, `sms.numerik360.com`).

---

## B. Ce que je fais, dans l'ordre

### Étape 1 — Tarifs et administration des ventes
- [x] Prix réglables dans l'administration : **semaine 1 000 F, mois 3 000 F, année 30 000 F**, recharges IA (ex. 100 crédits).
- [x] Crédits IA **inclus** dans le Premium chaque mois (ex. 300) + **recharges** achetables à part.
- [x] **Offrir le Premium** (testeurs, promotions, avec motif) et **enregistrer un paiement manuel** (montant, moyen : espèces,
      Orange Money, Wave, MTN, virement… ; référence ; durée) → Premium activé, historique.
- [x] Écran **Revenus** : total du mois, par offre, par moyen de paiement.
- [x] **Coût estimé de l'IA** en FCFA (par jour, par utilisateur), à partir de la consommation mesurée.
- [x] Réglage **majoration Google Play** (15 % ou 17,6 % pour toucher le même montant net) : l'administration calcule les prix
      à saisir dans la console Google.
- [x] **Assistant IA réservé au Premium** (case « Premium seulement » de l'outil).

### Étape 1 bis — Module Système plus complet (demandé le 24/11/2026)
- [x] **Graphiques sur 24 h / 7 j / 30 j** : processeur, mémoire, disque, réseau (entrant / sortant) du VPS.
- [x] **Temps de réponse** de pagio.site et nombre de requêtes par heure (journal Nginx), erreurs 4xx / 5xx.
- [x] **Disponibilité en %** (jour, semaine, mois) d'après le gardien, liste des pannes avec durée.
- [x] **Conteneur Pagio** : redémarrages, mémoire utilisée vs limite (1 200 Mo), taille de la base et des sauvegardes.
- [x] **Autres sites du VPS** : état de chacun (répond / ne répond pas), certificats et jours restants.
- [x] Prévision : « disque plein dans N jours » au rythme actuel ; seuils d'alerte réglables.

### Étape 1 ter — Tableau de bord « complet » (demandé le 24/11/2026)
Statistiques très détaillées (le plus de données possible, sans le contenu des documents) :
- [ ] **Utilisateurs** : actifs par jour / semaine / mois, nouveaux, **rétention** (combien reviennent après 1, 7, 30 jours),
      parcours *installation → compte → Premium* (taux de conversion), désinstallations estimées.
- [ ] **Appareils** : pays et villes, langue, marque et modèle, version d'Android, version de Pagio, taille d'écran.
- [ ] **Outils** : utilisations par outil, par jour et par heure, durée moyenne, taux d'erreur, limites gratuites atteintes,
      tailles et nombres de pages traités, ce qui pousse à passer Premium.
- [ ] **Site** : visites, pages vues, provenance (Google, Facebook, WhatsApp…), pays, mobile ou ordinateur, outils en ligne utilisés.
- [ ] **Argent** : revenus par jour / offre / moyen de paiement, abonnements actifs, renouvellements, résiliations, coût de l'IA,
      marge.
- [ ] Filtres partout (période, pays, version, offre), **export CSV / Excel**, **rapport hebdomadaire par e-mail**.
Gestion complète :
- [ ] **Codes promo** (remise, Premium offert N jours, nombre d'utilisations), **parrainage**.
- [ ] **Campagnes e-mail** aux utilisateurs (Brevo), avec désinscription.
- [ ] **Support** : répondre aux messages depuis le tableau de bord (réponse envoyée par e-mail), statuts, modèles de réponse.
- [ ] **Contenus** sans toucher au code : textes et FAQ du site, tarifs affichés, modèles de documents, écrans de présentation.
- [ ] **Versions** : envoyer une nouvelle APK depuis le tableau de bord, notes de version, mise à jour obligatoire.
- [ ] **Sécurité** : historique des connexions, activités suspectes, blocage d'adresses IP, demandes RGPD (export / suppression).
- [ ] **Recherche globale** (utilisateur, paiement, message), **droits fins** par rôle.

### Notifications de l'APK admin par Firebase (demandé le 24/11/2026)
Décision : **pas de notifications pour les utilisateurs** ; Firebase sert seulement à **Pagio Admin**.
- [ ] Aujourd'hui, Pagio Admin vérifie toutes les 15 minutes (et Android peut retarder). Avec Firebase, l'alerte arrive
      **en quelques secondes** : panne, nouveau message d'utilisateur, nouveau paiement, nouvel abonné Premium, plafond IA proche.
- [ ] Vous : **console.firebase.google.com** → ajouter Firebase au projet `pagio-515720` (compte kodybusiness), application
      Android `com.pagio.admin` → je récupère `google-services.json`.
- [ ] Moi : réception dans Pagio Admin, envoi par le serveur (Firebase Cloud Messaging, gratuit), choix des alertes dans le
      tableau de bord ; la vérification toutes les 15 minutes reste en secours.

### Étape 2 — Page d'accueil, référencement, statistiques
- [ ] Section **Tarifs** sur pagio.site : 3 offres en cartes, avantages Gratuit / Premium, prix lus dans l'administration.
- [x] **Liste des outils mise à jour** : l'application en compte **40** aujourd'hui (le site en annonce 36), plus les nouveaux
      (carte d'identité, dossier de candidature, modèles) ; **nombre calculé automatiquement** à partir de la liste du serveur.
- [x] **Une page par outil** (FR/EN), ex. `pagio.site/pdf-en-word/` : présentation **explicite mais brève** (à quoi il sert,
      3 étapes, gratuit ou Premium, sur téléphone et/ou en ligne), bouton « Utiliser maintenant » ou « Avec l'application ».
- [x] **Référencement de chaque page** : mots-clés recherchés (ex. « convertir PDF en Word gratuit », « fusionner PDF en ligne »,
      « compresser PDF moins de 1 Mo »), titre et description uniques, adresse lisible, petite FAQ (questions réellement posées
      sur Google), données structurées, liens entre outils proches, version anglaise, images légères avec texte alternatif.
- [x] **Menu simplifié** : « Outils » et « Outils en ligne » fusionnés en un seul **« Outils »** ; sur la page d'accueil, **chaque
      outil est cliquable** et ouvre directement l'outil dans le navigateur (ou sa page « avec l'application » s'il n'est pas
      encore en ligne, et le scanner).
- [x] SEO technique : `sitemap.xml`, `robots.txt`, données structurées (application), versions FR/EN déclarées, titres et descriptions.
- [ ] **Google Search Console** (après A10) et **Google Analytics** (identifiant réglable, après A11), en mode « sans cookies tant
      que la personne n'a pas accepté », petit bandeau discret.
- [ ] **Statistiques intégrées** au tableau de bord, sans cookies : visites, pages, pays, provenance, outils les plus utilisés.

### Étape 3 — Version 2.1.0 de l'application
- [ ] **Animation du logo** à chaque ouverture (moins d'une seconde) + **3 à 4 écrans de présentation** au premier lancement
      (avec « Passer »).
- [x] Après votre essai (A1) : **publication** de la 2.1.0 (`publier-apk.sh`, bouton du site).

### Étape 4 — Tous les outils en ligne (sauf le scanner, réservé au téléphone)
- [x] **Vague 1, dans le navigateur** (fait le 25/11) : diviser, organiser (miniatures), extraire le texte, PDF en images,
      texte en PDF, créer un PDF, signer, remplir un formulaire, en-tête et pied de page, propriétés, nettoyer les métadonnées.
      - [ ] Reste : **extraire les images**, **modifier** (écrire n'importe où sur la page).
- [x] **Vague 2, par le serveur** (fait le 25/11, qpdf + Ghostscript) : compresser (3 niveaux), réparer, protéger, déverrouiller,
      HTML en PDF (liens externes retirés par sécurité).
      - [ ] Reste : **remplacer du texte**, **masquer une information** (caviardage), **signature numérique et vérification**.
- [x] **Vague 3** (fait le 25/11) : **OCR** (français et anglais, OCRmyPDF), **PDF en Word**, **PDF en PowerPoint**.
      Correction au passage : LibreOffice refusait d'ouvrir les PDF sous le compte sans droits (mauvais groupe) ; PDF en Word
      remarche aussi pour l'application Android.
      - [ ] Reste : **PDF en Excel** (LibreOffice ne sait pas : passera par l'extraction de tableaux, étape 6).
- [x] **File d'attente** des traitements lourds : 2 à la fois, **Premium passe devant**, 30 en attente au plus, 2 min d'attente
      maximum ; visible dans *Système* (en attente, servis, refusés). Passer au VPS **KVM 2** quand l'usage augmente.
- [x] Chaque outil serveur respecte *Outils et limites* (désactivé, Premium seulement, taille maximale) ; compte obligatoire.
      **28 outils sur 40 sont maintenant utilisables en ligne.**

### Étape 5 — Nouveaux outils retenus
- [x] **Carte d'identité recto verso sur une page** (fait le 25/11 : en ligne, gratuit, illimité ; taille réelle ou agrandie,
      2 exemplaires possibles, noir et blanc ; page « carte-identite-recto-verso » pour Google). À ajouter dans l'application Android.
- [ ] **Dossier de candidature** : CV + diplômes + lettre en un seul PDF, **sous la taille maximale** demandée (1 Mo, 2 Mo…).
- [ ] **Modèles de documents administratifs** : attestations, demandes, procurations, lettres de démission… (formulaire → PDF) ;
      quelques modèles gratuits, tous en Premium ; une page par modèle pour le référencement.

### Étape 6 — Assistant IA (Premium)
- [ ] **Discussion avec un PDF**, réponses avec **la page citée** (clic → la page s'ouvre).
- [ ] **Extraction vers Excel** : factures, reçus, relevés bancaires, CV → tableau Excel (plusieurs documents d'un coup).
- [ ] **Traduction** en gardant la mise en page : Word et PowerPoint d'abord, PDF ensuite (mise en page proche).
- [ ] Mention **« Créé avec Pagio »** en gratuit, avec « Retirez cette mention avec Premium ».
      → **Reportée** (décision du 25/11) : pas de mention sur les documents gratuits pour l'instant.

### Étape 7 — Paiement sur le site (version APK)
- [ ] Mobile money (Orange Money, MTN, Wave, Moov) et carte, via l'agrégateur choisi (après A13) ; Premium reconnu partout par le compte.

### Étape 8 — Google Play (à la fin)
- [ ] Fiche : titre, description, captures d'écran (je prépare textes et captures), sécurité des données.
- [ ] **Paiement Google Play** dans l'application (après A12 et la première publication), prix majorés, vérification des achats par le serveur.
- [ ] Connexion « avec Google » dans l'application Android.
- [ ] Test d'accessibilité avec TalkBack.

### En continu / plus tard
- [ ] Vers le **15/12/2026** : durcir DMARC (`p=none` → `p=quarantine`).
- [ ] Passer le dépôt GitHub en privé ; renforcer scrypt ; Play Integrity ; test de charge ; Sentry au lancement Play Store.

---

## Tarifs décidés (23/11/2026)

| | Gratuit | Premium |
|---|---|---|
| Prix | 0 | **1 000 F / semaine — 3 000 F / mois — 30 000 F / an** (réglables) ; Google Play : + majoration |
| Outils sur l'appareil / dans le navigateur | 5 par jour et par outil | Illimité |
| Scanner | 10 par jour, 20 pages, en images | Illimité, 100 pages, en PDF |
| Carte d'identité recto verso | Illimité | Illimité |
| Dossier de candidature | 1 par jour | Illimité |
| Modèles de documents | quelques modèles | Tous, avec logo |
| Outils lourds (OCR, compression, PDF en Word…) | 2 par jour, 10 Mo, 20 pages | Illimité, 100 Mo, prioritaire |
| Assistant IA | — | Inclus (crédits mensuels) + recharges |
| Mention « Créé avec Pagio » | Oui, discrète | Non |

## Décisions
- Public : international (français et anglais). Distribution : Play Store **et** APK directe.
- Outils en ligne et connexion **sur pagio.site** (boutons du menu), pas d'adresse à part.
- Statistiques : rattachées au compte quand l'utilisateur est connecté (le mot « anonymes » est retiré).
- Google Analytics **et** statistiques intégrées.

---

## Fait (jusqu'au 23/11/2026)
- Serveur en ligne sur `https://pagio.site` (HTTPS, audit de sécurité corrigé, contre-audit 48 contrôles sans faille) ; lenteurs réseau corrigées.
- Administration réservée aux appareils autorisés (`admin.pagio.site`, certificat d'appareil + mot de passe + double authentification).
- **Pagio Admin** (APK du tableau de bord) avec notifications ; **gardien** du VPS (redémarrage automatique, pannes, certificats).
- Page d'accueil animée FR/EN, bouton « Fichier APK » toujours à jour, badge Google Play, menu toujours visible.
- **Pages légales** (confidentialité, conditions, suppression de compte, mentions légales) ; suppression complète des comptes ;
  durées de conservation appliquées automatiquement.
- E-mails : `contact@pagio.site` (réception et réponses), e-mails automatiques par Brevo, clé gardée active.
- **Outils en ligne et connexion** sur `pagio.site/app` (9 outils) ; connexion avec Google prête (attend A5).
- **Version 2.1.0** prête (limites gratuites par outil, scan en images + PDF Premium, flash, liens légaux) — attend A1.
- Version 2.0.0 publiée ; publication par `android/publier-apk.sh`.
- **Version 2.2.0 publiée le 24/11** : statistiques d'usage prévues par les conditions (description de l'appareil, gardées hors
  connexion) ; conditions et politique de confidentialité mises à jour le même jour.
