# Rapport d'audit — iLovePDF Android 4.2.3 (référence fonctionnelle)

> Objectif : comprendre les fonctionnalités, écrans, parcours et limites de l'application de référence
> afin de concevoir **Pagio**, une application concurrente originale. Aucun code, logo, texte ou
> ressource graphique d'iLovePDF n'a été réutilisé.

## 0. Méthode et honnêteté

| Ce qui a été fait | Ce qui n'a PAS été fait |
|---|---|
| Lecture statique du paquet `.apks` (4 APK : base, arm64, fr, xxhdpi) | L'application d'origine n'a **pas** été lancée (pas de compte, pas d'abonnement) |
| Décodage du manifeste : 75 activités, 125 composants, 22 permissions | Les réponses réelles des serveurs iLovePDF (limites, prix) n'ont pas été observées |
| Lecture des 1 994 textes français (ressources `fr`) | Les écrans n'ont pas été photographiés : leur description provient des textes et des classes |
| Analyse du bytecode (18 fichiers DEX, 191 409 classes) : liste des outils, drapeaux « hors ligne » et « premium », adresses des serveurs | |

Identifiants de preuves (Craft Anything) : `ev_9123a38e…` (manifeste), `ev_12a98aba…` (activités),
`ev_4bb0ac69…` (textes FR), `ev_dd3c6028…` (constructeur des outils), `ev_75f0e0cb…` (limites).

## 1. Fiche technique de la référence

- Paquet `com.ilovepdf.www`, version 4.2.3, Android 12 (SDK 32) minimum, cible SDK 36.
- Interface hybride : vues XML + Jetpack Compose (classes `ui/screens`, `ui/components`).
- Moteurs tiers **commerciaux** : PSPDFKit (lecture/édition PDF), Genius Scan SDK (scanner), SignatureKit maison.
- Connexions : Google, Facebook, SSO, Microsoft (MSAL), Huawei HMS ; cloud Google Drive, Dropbox, OneDrive, SharePoint.
- Facturation : Google Play Billing (abonnements hebdo / mensuel / annuel, essai gratuit 7 jours).
- Serveurs : `api.ilovepdf.com/v1`, `service.ilovepdf.com/v1`, `mobile.iloveapi.com/v1`, `sso.ilovepdf.com`, `evt.ilovepdf.com` (statistiques), Freshdesk (support).
- Base locale Room : outils, outils récents, nombre d'utilisations, **limites par outil (fichiers, Mo, expiration)** téléchargées du serveur.

## 2. Cartographie des 27 outils

Lecture directe de la classe `Tools` (nom interne, support hors ligne, premium).

| Catégorie | Outil (nom interne) | Traitement | Premium |
|---|---|---|---|
| Organiser | Fusionner (`merge`) | **Local** | Non |
| Organiser | Diviser (`split`) : par intervalles personnalisés / fixes, extraire toutes les pages, par taille de fichier (avec compression) | **Local** | Non |
| Organiser | Organiser (`organize`) : réordonner, supprimer, ajouter des pages | Serveur | Non |
| Organiser | Faire pivoter (`rotate`) | **Local** | Non |
| Optimiser | Compresser (`compress`) : hyper / recommandée / faible | Serveur | Non |
| Optimiser | Réparer (`repair`) | **Local** | Non |
| Optimiser | OCR PDF (`ocrpdf`) : jusqu'à 3 langues | Serveur | **Oui** |
| Optimiser | Extraire TXT (`ocr`) | **Local** | Non |
| Convertir en PDF | Image→PDF (`imagePdf`) : orientation, marge, taille de page, ajuster, fusionner | **Local** | Non |
| Convertir en PDF | Word→PDF, Excel→PDF, PowerPoint→PDF (`wordPdf`, `excelPdf`, `powerpointPdf`) | Serveur | Non |
| Convertir depuis PDF | PDF→Word, PDF→Excel (une / plusieurs feuilles), PDF→PowerPoint, PDF→JPG (pages ou images extraites) | Serveur | Non |
| Modifier | Modifier PDF (`editPdf`) : texte, images, formes, annotations | Serveur / PSPDFKit | Éditeur de contenu + biffure : **Oui** |
| Modifier | Numéros de page (`pageNumber`) : position, premier numéro, plage, pages en vis-à-vis, format « Page {n} de {p} », police | Serveur | Non |
| Modifier | Filigrane (`watermark`) : texte ou image, position, mosaïque, transparence, rotation, couche, police | Serveur | Non |
| Modifier | Signer (`sign`) : signature dessinée, signatures enregistrées | Serveur | Non |
| Créer | Créer PDF (`createpdf`) : taille, orientation, couleur, motif, nombre de pages, modèles | Local | Modèles premium |
| Sécurité | Protéger (`protect`) | **Local** | Non |
| Sécurité | Déverrouiller (`unlock`) | Serveur | Non |
| Images (iLoveIMG) | Compresser, redimensionner, convertir en JPG, convertir depuis JPG (PNG/GIF) | Serveur | Non |

Absents de la référence : HTML→PDF, TXT→PDF, PDF→PNG, en-têtes/pieds de page, métadonnées,
signature numérique certifiée, vérification de signatures, résumé, traduction, conversation avec le document,
extraction de factures, reconnaissance de documents administratifs.

## 3. Écrans et navigation (d'après activités et textes)

- **Barre de navigation** : Accueil · Outils · Numériser · Fichiers · Paramètres.
- **Accueil** : favoris (nombre limité), outils récents, fichiers récents, nouveautés, bannière Premium.
- **Outils** : grille par catégories, réorganisation par glisser-déposer, outils premium marqués.
- **Exécution d'un outil** : sélection des fichiers (appareil, cloud) → options (écran « choix unique ») → téléversement → traitement → résultat (ouvrir, partager, télécharger). Les tâches longues continuent en arrière-plan (service au premier plan + notification).
- **Scanner** : capture auto/manuelle, détection des contours, filtres (aucun, document, photo, monochrome, noir et blanc), ajout depuis galerie, renommage, export PDF / image / PDF+OCR. Mode « scanner compagnon » relié au navigateur de l'ordinateur via QR code.
- **Fichiers** : filtres (tout, PDF, documents, images, dossiers), tri, recherche, dossiers, ZIP, corbeille (purge après 30 jours), espace de stockage, cloud.
- **Lecteurs** : PDF (PSPDFKit), images (rotation, dessin, texte), TXT.
- **Compte** : connexion / inscription (e-mail, Google, Facebook, SSO), mot de passe oublié, profil, suppression du compte (avec explications d'annulation d'abonnement).
- **Premium** : écran de vente (catégories : accès illimité, OCR, éditeur de contenu, cloud, modèles, scanner), restauration des achats, liaison d'un abonnement à un compte.
- **Paramètres** : mode sombre, langue, préférences, contact (formulaire : contact, bug, suggestion, suppression), à propos, conditions, confidentialité, crédits, noter l'application, partager.
- **Divers** : sondage NPS, actualités, vitrine de nouveautés, widgets d'écran d'accueil (scanner, outils les plus utilisés), interstitiels promotionnels.

## 4. Limites de la version gratuite (observées dans le code)

- Nombre de **tâches gratuites par jour** affiché (« %1$d sur %2$d tâches gratuites restantes ») ; au-delà, blocage et incitation Premium.
- Limites par outil en **nombre de fichiers** et **Mo**, envoyées par le serveur (valeurs non présentes dans l'APK → **inconnues**).
- Erreur « tâche trop lourde » côté serveur.
- Premium : OCR PDF, éditeur de contenu et biffure, cloud, modèles, accès illimité.

## 5. Points faibles identifiés

1. **Dépendance au réseau** : 20 des 27 outils envoient vos documents sur un serveur (confidentialité, lenteur, pas de mode avion).
2. **Quota quotidien** très visible et frustrant ; incitations Premium fréquentes (interstitiels, promos).
3. **Pas d'IA documentaire** (résumé, questions, traduction, extraction de factures).
4. Pas de HTML/TXT→PDF, pas de PDF→PNG, pas d'en-tête/pied de page, pas de nettoyage des métadonnées.
5. OCR complet réservé au Premium ; langues limitées à 3 et à choisir manuellement.
6. Application lourde : **298 Mo** de paquets (dont 218 Mo pour la base), dépendance à des SDK commerciaux coûteux.
7. Pas d'historique d'opérations détaillé ni d'annulation d'un traitement en cours.

## 6. Ce que Pagio fait mieux (plan produit)

| Axe | Pagio |
|---|---|
| Confidentialité | Tous les outils PDF essentiels traités **sur l'appareil**, hors ligne |
| IA | OCR et détection de langue sur l'appareil, PDF consultable, résumé / extraction de facture / reconnaissance de documents **hors ligne**, puis IA générative (résumé, conversation, traduction, reformulation, questions) via fournisseur au choix |
| Outils | +HTML→PDF, TXT→PDF, PDF→PNG, en-têtes/pieds, métadonnées, nettoyage, duplication de pages, signature numérique certifiée et vérification |
| Expérience | Material 3, thème clair/sombre, progression + annulation, historique, récents, partage, enregistrement où l'on veut |
| Pilotage | Serveur + tableau de bord admin : utilisateurs, offres, crédits IA, activation des outils, limites gratuites, annonces, maintenance, mise à jour forcée, statistiques, journal d'audit |

Le détail de ce qui est réellement livré et testé se trouve dans `FONCTIONNALITES.md` et `RAPPORT-DE-TESTS.md`.
