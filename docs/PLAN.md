# Plan Pagio — refait le 23 novembre 2026

Ce qui est déjà en place est résumé tout en bas (« Fait »). Tout le reste est ici, dans l'ordre, avec qui le fait.

---

## A. À faire par vous (en attente)

| # | Action | Pourquoi | Durée |
|---|---|---|---|
| A1 | ~~Essayer la 2.1.0~~ **fait le 24/11** (scan, case PDF, flash, liens légaux ; 2.1.0 publiée) ; outils IA passés en Premium | — | — |
| A2 | ~~Pagio Admin + certificat du téléphone~~ **fait le 24/11** (téléphone inscrit aux notifications) | — | — |
| A3 | ~~UptimeRobot~~ **fait le 24/11** : `pagio.site` et `pagio.site/api/health` toutes les 5 min, alerte par e-mail (application mobile UptimeRobot : à installer si vous voulez les alertes sur le téléphone) | — | — |
| A4 | **OpenAI** : sur platform.openai.com › *Billing › Limits*, fixer un **plafond de dépense mensuel** (ex. 10 $) | Jamais de facture surprise | 5 min |
| A5 | **Identifiant client Google** pour « Continuer avec Google » (`docs/GOOGLE.md`, partie A ; origines `https://pagio.site` et `https://www.pagio.site`) | Connexion avec Google sur le site | 10 min |
| A6 | **Codes de secours** de la double authentification notés **hors de l'ordinateur** | Accès de secours à l'administration | 2 min |
| A7 | **Copie de sécurité hors du serveur** : `jwt-secret.key`, `secrets.key` + une sauvegarde (je peux les télécharger dans `Documents\Pagio-admin`, vous les copiez ensuite sur la clé USB) | Reprise si le VPS est perdu | 5 min |
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
- [ ] Prix réglables dans l'administration : **semaine 1 000 F, mois 3 000 F, année 30 000 F**, recharges IA (ex. 100 crédits).
- [ ] Crédits IA **inclus** dans le Premium chaque mois (ex. 300) + **recharges** achetables à part.
- [ ] **Offrir le Premium** (testeurs, promotions, avec motif) et **enregistrer un paiement manuel** (montant, moyen : espèces,
      Orange Money, Wave, MTN, virement… ; référence ; durée) → Premium activé, historique.
- [ ] Écran **Revenus** : total du mois, par offre, par moyen de paiement.
- [ ] **Coût estimé de l'IA** en FCFA (par jour, par utilisateur), à partir de la consommation mesurée.
- [ ] Réglage **majoration Google Play** (15 % ou 17,6 % pour toucher le même montant net) : l'administration calcule les prix
      à saisir dans la console Google.
- [ ] **Assistant IA réservé au Premium** (case « Premium seulement » de l'outil).

### Étape 1 bis — Module Système plus complet (demandé le 24/11/2026)
- [ ] **Graphiques sur 24 h / 7 j / 30 j** : processeur, mémoire, disque, réseau (entrant / sortant) du VPS.
- [ ] **Temps de réponse** de pagio.site et nombre de requêtes par heure (journal Nginx), erreurs 4xx / 5xx.
- [ ] **Disponibilité en %** (jour, semaine, mois) d'après le gardien, liste des pannes avec durée.
- [ ] **Conteneur Pagio** : redémarrages, mémoire utilisée vs limite (1 200 Mo), taille de la base et des sauvegardes.
- [ ] **Autres sites du VPS** : état de chacun (répond / ne répond pas), certificats et jours restants.
- [ ] Prévision : « disque plein dans N jours » au rythme actuel ; seuils d'alerte réglables.

### Étape 2 — Page d'accueil, référencement, statistiques
- [ ] Section **Tarifs** sur pagio.site : 3 offres en cartes, avantages Gratuit / Premium, prix lus dans l'administration.
- [ ] **Nombre d'outils calculé automatiquement** (on dépasse 36).
- [ ] **Une page par outil** (FR/EN), ex. `pagio.site/pdf-en-word/` : explication + « Faire en ligne » ou « Avec l'application ».
- [ ] SEO technique : `sitemap.xml`, `robots.txt`, données structurées (application), versions FR/EN déclarées, titres et descriptions.
- [ ] **Google Search Console** (après A10) et **Google Analytics** (identifiant réglable, après A11), en mode « sans cookies tant
      que la personne n'a pas accepté », petit bandeau discret.
- [ ] **Statistiques intégrées** au tableau de bord, sans cookies : visites, pages, pays, provenance, outils les plus utilisés.

### Étape 3 — Version 2.1.0 de l'application
- [ ] **Animation du logo** à chaque ouverture (moins d'une seconde) + **3 à 4 écrans de présentation** au premier lancement
      (avec « Passer »).
- [ ] Après votre essai (A1) : **publication** de la 2.1.0 (`publier-apk.sh`, bouton du site).

### Étape 4 — Tous les outils en ligne (sauf le scanner, réservé au téléphone)
- [ ] **Vague 1, dans le navigateur** : diviser, réorganiser (miniatures), extraire le texte, PDF en images, extraire les images,
      texte en PDF, créer un PDF, modifier, signer, remplir un formulaire, en-tête et pied de page, propriétés, effacer les métadonnées.
- [ ] **Vague 2, par le serveur** : compresser, réparer, protéger, déverrouiller, remplacer du texte, masquer une information,
      signature numérique et vérification, HTML en PDF.
- [ ] **Vague 3** : OCR, PDF en Word / Excel / PowerPoint.
- [ ] **File d'attente** des traitements lourds (un à la fois sur le VPS à 1 cœur), **Premium prioritaire** ; limites gratuites
      (ex. 2 par jour, 10 Mo, 20 pages). Passer au VPS **KVM 2** quand l'usage augmente.
- [ ] Chaque outil réglable dans *Outils et limites* (activé, **Premium seulement**, limites) : les nouveaux y apparaissent seuls.

### Étape 5 — Nouveaux outils retenus
- [ ] **Carte d'identité recto verso sur une page** (gratuit, illimité : attire du monde).
- [ ] **Dossier de candidature** : CV + diplômes + lettre en un seul PDF, **sous la taille maximale** demandée (1 Mo, 2 Mo…).
- [ ] **Modèles de documents administratifs** : attestations, demandes, procurations, lettres de démission… (formulaire → PDF) ;
      quelques modèles gratuits, tous en Premium ; une page par modèle pour le référencement.

### Étape 6 — Assistant IA (Premium)
- [ ] **Discussion avec un PDF**, réponses avec **la page citée** (clic → la page s'ouvre).
- [ ] **Extraction vers Excel** : factures, reçus, relevés bancaires, CV → tableau Excel (plusieurs documents d'un coup).
- [ ] **Traduction** en gardant la mise en page : Word et PowerPoint d'abord, PDF ensuite (mise en page proche).
- [ ] Mention **« Créé avec Pagio »** en gratuit, avec « Retirez cette mention avec Premium ».

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
