# Fonctionnalités : ce qui est livré, ce qui reste à faire

Légende : ✅ livré et testé automatiquement · ☑️ livré, vérifié à la main ou par compilation · ⚠️ livré avec une limite · ⏳ à faire

## A. Gestion et organisation des PDF

| Demande | État | Détail |
|---|---|---|
| Fusionner | ✅ | ordre au choix, PDF protégés acceptés (mot de passe demandé) |
| Diviser | ✅ | intervalles, groupes fixes, chaque page, par taille |
| Extraire / supprimer des pages | ✅ | |
| Réorganiser par glisser-déposer | ☑️ | écran *Organiser* : appui long + glisser, sélection multiple |
| Faire pivoter / dupliquer | ✅ | par page ou en lot |
| Compresser | ✅ | 3 niveaux ; ré-encodage des images ; jamais de fichier plus gros |
| Réparer | ✅ | reconstruction de la structure, pages illisibles signalées |
| Images → PDF (une ou plusieurs) | ✅ | taille de page, orientation auto, marges, rotation EXIF |
| Créer un PDF | ✅ | vierge, ligné, quadrillé, à points, couleurs |
| Scanner | ⚠️ | scanner ML Kit (bords, recadrage, filtres) ; repli photo simple ; non testé sans caméra |
| Numéros de page, filigranes, en-têtes et pieds | ✅ | positions, formats, opacité, mosaïque, couche, variables {n} {p} {date} |

## B. Conversions

| Demande | État | Détail |
|---|---|---|
| PDF → Word | ⚠️ | sur l'appareil : titres, paragraphes, gras/italique ; mises en page complexes simplifiées |
| Word / Excel / PowerPoint → PDF | ⚠️ | .docx/.xlsx/.pptx sur l'appareil (mise en page simplifiée) ; fidélité maximale et anciens formats (.doc, .xls, .ppt, .odt) via LibreOffice sur le serveur |
| PDF → Excel | ⚠️ | tableaux reconstitués par position du texte ; une feuille ou une par page |
| PDF → PowerPoint | ✅ | image fidèle de chaque page, ou texte modifiable |
| PDF → JPG / PNG | ✅ | 72 / 150 / 300 ppp |
| JPG / PNG → PDF | ✅ | |
| HTML → PDF | ☑️ | fichier local ou adresse web, rendu vectoriel A4 |
| TXT → PDF | ✅ | |

## C. Éditeur PDF

| Demande | État | Détail |
|---|---|---|
| Ajouter du texte, des images, des formes | ✅ | rectangle, ellipse, ligne, flèche |
| Surligner, souligner, barrer | ✅ | |
| Dessin à main levée | ✅ | |
| Commentaires | ✅ | vraies annotations PDF avec icône visible |
| Signatures | ✅ | dessinée, saisie, enregistrées pour réutilisation |
| Remplir des formulaires | ✅ | texte, cases, boutons radio, listes ; possibilité de figer |
| Cases à cocher, dates, champs personnalisés | ✅ | cases et champs **remplissables** créés dans le PDF |
| Modifier le texte existant | ⚠️ | « Remplacer du texte » : recouvrement + nouveau texte à la même place ; l'ancien reste caché dessous (utilisez *Biffer* pour le supprimer) |
| Biffure (caviardage) | ✅ | suppression réelle du texte (bonus) |

## D. Sécurité

| Demande | État |
|---|---|
| Protéger par mot de passe, chiffrer (AES-256, permissions) | ✅ |
| Déverrouiller (avec le mot de passe) | ✅ |
| Voir / modifier les propriétés | ✅ |
| Supprimer les métadonnées sensibles (auteur, logiciel, XMP, scripts, pièces jointes cachées) | ✅ |
| Signature électronique (visuelle) | ✅ |
| Signature numérique certifiée (certificat auto-signé ou .p12 importé) | ✅ |
| Vérifier les signatures numériques | ⚠️ intégrité et signataire vérifiés ; la chaîne de confiance vers une autorité n'est pas contrôlée |

## E. OCR et intelligence artificielle

| Demande | État | Détail |
|---|---|---|
| OCR des documents scannés | ✅ | sur l'appareil, alphabet latin |
| Reconnaissance automatique de la langue | ✅ | sur l'appareil, 100+ langues |
| Recherche dans les scans | ✅ | PDF consultable (calque invisible) + recherche dans le lecteur |
| Extraction de tableaux | ⚠️ | Excel + CSV, à partir des positions du texte |
| Résumé | ✅ / ⚠️ | hors ligne : résumé extractif (phrases clés) ; rédigé avec une IA générative |
| Conversation avec un document | ⚠️ | nécessite un fournisseur d'IA (clé personnelle ou crédits serveur) |
| Informations importantes | ✅ | hors ligne : dates, montants, IBAN vérifiés, e-mails, téléphones, TVA, références |
| Traduction | ⚠️ | sur l'appareil (modèle téléchargé une fois) ou par l'IA générative |
| Reformulation | ⚠️ | nécessite un fournisseur d'IA |
| Questions à partir d'un document | ✅ / ⚠️ | hors ligne : questions à trous ; QCM et questions ouvertes avec l'IA |
| Données d'une facture | ✅ | hors ligne + version IA plus précise |
| Reconnaissance des documents administratifs | ✅ | 13 types (facture, devis, paie, impôts, banque, contrat, attestation…) |
| Plusieurs fournisseurs d'IA | ✅ | compatible OpenAI (OpenAI, Mistral, Groq, Ollama…), Claude, Gemini, serveur Pagio |

## Expérience, performance, technique

| Demande | État |
|---|---|
| Kotlin + Jetpack Compose, modules séparés (interface / moteur / IA / serveur) | ✅ |
| Interface française + architecture multilingue (anglais fourni) | ✅ |
| Thème clair / sombre / système, couleurs dynamiques Android 12+ | ☑️ |
| Progression et annulation de chaque traitement | ☑️ |
| Messages d'erreur compréhensibles | ☑️ |
| Aperçu, lecteur avec zoom et recherche | ☑️ |
| Historique des opérations, documents récents, favoris | ☑️ |
| Partage, enregistrement, « Continuer avec un autre outil » | ☑️ |
| Ouvrir/partager vers Pagio depuis d'autres applications | ☑️ |
| Hors ligne pour tout ce qui ne nécessite pas de serveur | ✅ |
| Fichiers temporaires privés et nettoyés | ✅ |
| Secrets chiffrés (Keystore Android), HTTPS obligatoire en production | ☑️ |

## Tableau de bord admin et serveur

| Demande | État |
|---|---|
| Connexion administrateur, rôles, journal d'audit | ✅ |
| Utilisateurs : recherche, Premium, crédits, suspension, mot de passe, suppression, export | ✅ |
| Outils : activer, Premium, limites | ✅ |
| Offres, quotas, recharge des crédits IA | ✅ |
| IA : fournisseur, modèle, clé, coût, test | ✅ |
| IA du serveur avec un vrai fournisseur (OpenAI, `gpt-4.1-mini`) : résumé, conversation, reformulation, décompte des crédits | ✅ essayé en local le 10/11/2026 par l'API ; pas encore depuis l'application sur un téléphone |
| Maintenance, annonce, version minimale obligatoire, mise à jour | ✅ |
| Statistiques, événements, avis des utilisateurs | ✅ |
| Double authentification des administrateurs, codes de secours | ✅ (QR code non essayé avec un vrai téléphone) |
| Sessions d'administration visibles et révocables | ✅ |
| Clé d'IA et secrets chiffrés dans la base | ✅ |
| Limites anti-abus (conversions, inscriptions) | ✅ |
| Sauvegarde quotidienne, restauration, import / téléchargement | ✅ |
| Erreurs du serveur, suivi des conversions, consommation IA | ✅ |
| État de la machine et alertes dans le tableau de bord | ✅ (alertes par e-mail : ⏳) |
| Fiche utilisateur détaillée, historique des offres, actions groupées | ✅ |
| Conversion serveur LibreOffice : Office → PDF, PDF → Word, PDF → PowerPoint | ✅ fichiers valides produits ; fidélité sur documents complexes non évaluée |
| Conversion serveur PDF → Excel | ✘ impossible avec LibreOffice (l'application garde sa conversion interne) |

## ⏳ Reste à faire (choix ou comptes de votre part nécessaires)

1. **Paiements Google Play Billing** (abonnements, achats de crédits) — guide : `COMMERCIAL.md`.
2. **Envoi d'e-mails** (mot de passe oublié automatique, confirmation d'inscription) — un service SMTP à brancher.
3. **Espace cloud facultatif** et connexion Google Drive / Dropbox / OneDrive.
4. **Connexion Google / Facebook / SSO** (aujourd'hui : e-mail + mot de passe).
5. **Widgets d'écran d'accueil**, scanner « compagnon » vers l'ordinateur (présents chez iLovePDF).
6. **OCR des alphabets non latins** (arabe, chinois…) : modèles ML Kit supplémentaires à ajouter.
7. **Édition directe du texte d'origine** (au-delà du remplacement par recouvrement) : nécessiterait un moteur commercial.
8. Tests sur vrais téléphones et versions d'Android anciennes, puis publication.
