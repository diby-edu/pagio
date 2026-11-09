# Rapport de tests — Pagio 1.0.0

Campagne réalisée le 8 et 9 novembre 2026 sur un émulateur Android 16 (API 36.1, x86_64, Google Play,
1080 × 2400, 420 ppp) et sur l'ordinateur de développement (Windows 11, Node.js 24.11).

## 1. Tests automatisés

| Suite | Où | Tests | Résultat |
|---|---|---|---|
| `PageRangesTest` (intervalles de pages) | JVM | 9 | ✅ 9/9 |
| `OfflineAnalysisTest` (facture, IBAN, classement, résumé, questions) | JVM | 7 | ✅ 7/7 |
| `EngineInstrumentedTest` (moteur PDF complet) | Émulateur Android 16 | 17 | ✅ 17/17 |
| `OcrInstrumentedTest` (OCR, langue, assistant hors ligne) | Émulateur Android 16 | 3 | ✅ 3/3 |
| `api.test.js` (serveur : parcours complet) | Node.js 24 | 1 scénario, ~45 vérifications | ✅ |
| Tableau de bord (`tsc -b && vite build`) | Node.js 24 | vérification de types | ✅ |

**Total : 36 tests Android + le scénario serveur, tous réussis.**

Ce que couvrent les tests du moteur (chaque résultat est relu et contrôlé) : texte → PDF, fusion (ordre conservé),
division par intervalles / chaque page / taille, extraction, suppression, rotation, organisation (doublon, page blanche,
rotation par page), images → PDF (paysage automatique), compression (taille réellement réduite), protection AES-256
puis déverrouillage (mot de passe manquant / faux détectés), numéros de page, filigrane, en-tête/pied, métadonnées
(modification puis nettoyage), signature numérique (valide, puis **falsification détectée**), éditeur (11 types
d'éléments, champs de formulaire créés puis remplis puis figés), remplacement de texte, **biffure réelle** (le texte
disparaît du fichier), calque OCR invisible rendant un scan cherchable, PDF → PNG, extraction d'images, réparation
d'un PDF tronqué, aller-retour Word / Excel / PowerPoint, document vierge à motif, reconstitution de tableaux.

Commandes pour rejouer : voir README § 14.

## 2. Tests manuels sur émulateur (APK release signée, optimisée R8)

| Vérification | Résultat |
|---|---|
| Installation de l'APK signée | ✅ |
| Démarrage, écran d'accueil, accord sur les statistiques | ✅ (capture `screenshots/02-accueil.png`) |
| Interface en français (et en anglais quand le téléphone est en anglais) | ✅ |
| Sélection de plusieurs fichiers via le sélecteur Android | ✅ |
| Fusion de 2 PDF (3 + 2 pages → 5 pages) | ✅ (`screenshots/04-fusion-resultat.png`) |
| Ouverture du résultat dans le lecteur, compteur de pages | ✅ (`screenshots/05-lecteur.png`) |
| Enregistrement dans Téléchargements/Pagio | ✅ fichier présent sur l'appareil |
| Assistant : lecture du texte, détection de la langue, analyse hors ligne | ✅ (`screenshots/06-assistant.png`) |
| Absence de plantage (journal des plantages vide pour Pagio) | ✅ |
| Fonctionnement sans serveur (mode autonome) | ✅ toutes les vérifications ci-dessus ont été faites serveur arrêté |

## 3. Tableau de bord et serveur

| Vérification | Résultat |
|---|---|
| Écran de connexion (ordinateur et mobile) | ✅ `screenshots/dashboard/` |
| Connexion administrateur réelle → vue d'ensemble → outils | ✅ `screenshots/dashboard-outils/` |
| Rôles (support refusé sur les actions sensibles) | ✅ test automatisé |
| Quota quotidien, Premium, suspension, maintenance, version obligatoire, annonce | ✅ test automatisé |
| Clé d'IA jamais renvoyée en clair | ✅ test automatisé |

## 4. Défauts trouvés pendant les tests et corrigés

1. **Division par taille** : le dossier de sortie n'était pas créé → erreur. Corrigé.
2. **Remplacement de texte** : la zone recouverte englobait toute la ligne. Corrigé (seuls les mots concernés).
3. **Fichiers choisis effacés par Android** quand le téléphone manque de place (le système vide le cache) → « Fichier introuvable ».
   Corrigé : copies de travail dans l'espace privé permanent, nettoyées par Pagio.

## 5. Ce qui n'a pas pu être testé ici (limites honnêtes)

- **Vrai téléphone** et **plusieurs versions d'Android** : seuls Android 16 (émulateur) a été testé. L'application vise Android 8 à 16 ;
  testez au moins un téléphone Android 10–12 d'entrée de gamme avant publication.
- **Scanner ML Kit et appareil photo** : l'émulateur sans caméra ne permet pas de l'essayer ; le repli « photo simple » est en place.
- **Tablettes / petits écrans** : la mise en page est adaptative (grilles à colonnes automatiques) mais n'a été photographiée qu'en 1080 × 2400.
- **IA générative** : aucune clé d'API n'était disponible ; le code des fournisseurs est en place et les erreurs (clé refusée, quota,
  hors ligne) sont gérées, mais aucune réponse réelle n'a été obtenue. Le test se fait en un clic : *Réglages › IA › Tester*.
- **Traduction sur l'appareil** : nécessite le téléchargement du modèle de langue (~30 Mo) au premier usage ; non lancée ici.
- **Conversion LibreOffice** : LibreOffice n'est pas installé sur l'ordinateur de test ; le serveur le détecte et désactive proprement ce service.
- **Documents très volumineux** (centaines de Mo) : la lecture passe par un fichier temporaire pour limiter la mémoire, mais n'a pas été mesurée.
