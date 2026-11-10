# Pagio — studio PDF Android + serveur + tableau de bord admin

Pagio est une application Android native (Kotlin, Jetpack Compose) qui regroupe 40 outils PDF, un éditeur,
l'OCR, des analyses documentaires hors ligne et une IA générative au choix. Elle est accompagnée d'un serveur
(Node.js + SQLite) et d'un tableau de bord d'administration web (React) pour piloter l'application.

| Livrable | Emplacement |
|---|---|
| APK release signée | `android/apk/application.apk` |
| APK debug | `android/apk/application-debug.apk` |
| Bundle Google Play | `android/apk/application.aab` |
| Code source complet | ce dossier (dépôt Git local) |
| Clé de signature (à garder secrète, hors Git) | `android/apk/cle-de-signature/` |
| Rapport d'audit d'iLovePDF | `docs/AUDIT.md` |
| Fonctionnalités livrées / restantes | `docs/FONCTIONNALITES.md` |
| Rapport de tests | `docs/RAPPORT-DE-TESTS.md` |
| Bibliothèques et licences | `docs/BIBLIOTHEQUES-ET-LICENCES.md` |
| Serveur, base de données, déploiement | `docs/SERVEUR.md` |
| Modèle commercial (Premium, paiements) | `docs/COMMERCIAL.md` |
| Ce qu'il vous reste à faire | `docs/A-FAIRE.md` |

---

## 1. Technologies

- **Application Android** : Kotlin 2.2, Jetpack Compose (Material 3), Android 8.0 (API 26) à Android 16 (API 36).
- **Traitement PDF** : PdfBox-Android (Apache 2.0) pour la manipulation, `PdfRenderer` d'Android pour l'affichage.
- **OCR, langue, traduction, scanner** : Google ML Kit, exécuté sur l'appareil.
- **Signature numérique** : Bouncy Castle (CMS / PAdES de base).
- **Conversions Office** : moteur maison sur l'appareil (DOCX/XLSX/PPTX), LibreOffice sur le serveur pour la haute fidélité.
- **IA générative** : couche de fournisseurs interchangeables (compatible OpenAI, Anthropic, Gemini, serveur Pagio).
- **Serveur** : Node.js 22.13+ (24 recommandé), Express, SQLite intégré (`node:sqlite`), aucune autre base à installer.
- **Tableau de bord** : React 18 + TypeScript + Vite, servi par le serveur.

Pourquoi Kotlin + Compose : c'est la pile officielle d'Android, la plus performante et la mieux outillée ;
le traitement des fichiers locaux, l'appareil photo et le Keystore sont accessibles directement (pas de WebView).

## 2. Architecture

```
app/
├── android/                 Projet Android Studio (Gradle, Kotlin)
│   ├── app/                 Interface (écrans Compose, navigation, données locales)
│   ├── core/engine/         Moteur documentaire : PDF, Office, rendu, sécurité, éditeur (aucune dépendance à l'UI)
│   ├── core/ai/             OCR, langue, traduction, analyses hors ligne, fournisseurs d'IA
│   ├── core/cloud/          Client du serveur Pagio (configuration, comptes, statistiques, conversions)
│   ├── gradle/libs.versions.toml   Toutes les versions de dépendances, au même endroit
│   └── testdata/            PDF d'essai et utilitaire de test manuel
├── server/                  Serveur Pagio (API + base SQLite + LibreOffice)
├── src/                     Tableau de bord d'administration (React)
├── docs/                    Documentation, audit, tests, captures d'écran
└── deliverables/            APK, bundle, archive du code, clé de signature
```

Séparation des couches : l'interface (`app`) appelle le moteur (`core/engine`) et l'intelligence (`core/ai`) ;
ces modules ne connaissent pas l'interface et sont testés séparément sur l'appareil. Toute fonction marche
**hors ligne** ; le serveur n'apporte que les comptes, le Premium, les crédits IA, la configuration à distance,
les statistiques et les conversions haute fidélité.

Principaux fichiers :

| Rôle | Fichier |
|---|---|
| Catalogue des 40 outils (catégorie, icône, entrées) | `android/app/src/main/java/com/pagio/app/tools/ToolCatalog.kt` |
| Exécution de chaque outil | `android/app/src/main/java/com/pagio/app/tools/ToolRunner.kt` |
| Options de chaque outil (écran) | `android/app/src/main/java/com/pagio/app/ui/tool/ToolOptionsUi.kt` |
| Pages PDF (fusion, division, organisation) | `android/core/engine/src/main/java/com/pagio/engine/PdfPages.kt` |
| Éditeur, formulaires, biffure | `android/core/engine/.../PdfEditor.kt` |
| Conversions Office | `android/core/engine/.../office/` |
| IA : fournisseurs | `android/core/ai/src/main/java/com/pagio/ai/Providers.kt` |
| Textes de l'interface | `android/app/src/main/res/values/strings.xml` (français), `values-en/` (anglais) |
| Routes du serveur | `server/src/app.js` |

## 3. Prérequis

- **Android Studio** Narwhal (2025.1) ou plus récent, avec le SDK Android 36 (installé par Android Studio).
- **JDK 17 ou plus** (fourni avec Android Studio).
- **Node.js 22.13 ou plus** (24 LTS conseillé) pour le serveur et le tableau de bord.
- Facultatif : **LibreOffice** sur la machine du serveur (conversions haute fidélité) ; **Docker** pour un déploiement en un bloc.

## 4. Ouvrir le projet dans Android Studio

1. Décompressez `application-source.zip`.
2. Android Studio → *File › Open* → choisissez le dossier **`android`** (celui qui contient `settings.gradle.kts`).
3. Acceptez « Trust project ». Android Studio télécharge Gradle et toutes les dépendances (connexion Internet nécessaire la première fois).
4. Si on vous le demande, laissez Android Studio créer `local.properties` (chemin du SDK).

## 5. Dépendances

Elles sont déclarées dans `android/gradle/libs.versions.toml` et téléchargées automatiquement par Gradle
depuis Google Maven et Maven Central. Pour mettre à jour une bibliothèque, changez sa version à cet endroit.
Le serveur et le tableau de bord installent les leurs avec `npm install` (dans `app/` et dans `app/server/`).

## 6. Compiler l'application

Depuis Android Studio : bouton ▶ *Run* (téléphone branché en mode développeur ou émulateur).
En ligne de commande, dans `android/` :

```
./gradlew assembleDebug        # Windows : gradlew.bat assembleDebug
```

## 7. Générer un APK debug

`./gradlew assembleDebug` → `android/app/build/outputs/apk/debug/app-debug.apk`
(identifiant `com.pagio.app.debug` : il s'installe à côté de la version release).

## 8. Générer un APK release

`./gradlew assembleRelease` → `android/app/build/outputs/apk/release/app-release.apk` (optimisé par R8, signé).
Pour Google Play, générez plutôt un bundle : `./gradlew bundleRelease` → `android/app/build/outputs/bundle/release/app-release.aab`
(Google Play ne livre ensuite à chaque téléphone que le code de son processeur : environ 35 Mo au lieu de 88).

## 9. Signature de l'APK

La clé vous appartient : `android/apk/cle-de-signature/pagio-release.jks` et son mot de passe dans `MOT-DE-PASSE.txt`.
Gradle lit `android/keystore.properties` (jamais versionné) :

```
storeFile=apk/cle-de-signature/pagio-release.jks
storePassword=...
keyAlias=pagio
keyPassword=...
```

Sur un autre ordinateur : copiez le `.jks`, recréez ce fichier avec vos mots de passe, puis `./gradlew assembleRelease`.
Sans `keystore.properties`, la version release est construite non signée (Gradle le signale).
**Perdre la clé empêche toute mise à jour** de l'application déjà installée : gardez deux copies. Avec Google Play,
activez « Signature d'application par Google Play » (votre clé devient alors une clé d'importation remplaçable).
Pour créer une nouvelle clé : `keytool -genkeypair -keystore ma-cle.jks -alias pagio -keyalg RSA -keysize 4096 -validity 10000`.

## 10. Ajouter une fonctionnalité (un nouvel outil)

1. Moteur : écrivez la fonction dans `core/engine` (ex. `PdfPages.kt`), avec un test dans `core/engine/src/androidTest/`.
2. Catalogue : ajoutez une entrée à l'énumération `Tool` dans `ToolCatalog.kt` (identifiant, catégorie, icône, entrées acceptées).
3. Exécution : ajoutez le cas correspondant dans `ToolRunner.run()` et, si besoin, ses options dans `ToolOptions` + `ToolOptionsUi.kt`.
4. Textes : ajoutez `t_<id>` et `d_<id>` dans `values/strings.xml` (et `values-en/strings.xml`).
5. Serveur : ajoutez l'identifiant à `TOOL_IDS` dans `server/src/db.js` pour pouvoir le piloter depuis le tableau de bord.
Un écran entièrement personnalisé se branche dans `MainActivity.kt` (route `tool/{id}`, champ `screen` du catalogue).

## 11. Modifier l'identité visuelle

- Couleurs, typographie, arrondis : `android/app/src/main/java/com/pagio/app/ui/theme/Theme.kt` (objet `Brand`).
- Icône : `android/app/src/main/res/drawable/ic_launcher_foreground.xml` et `ic_launcher_background.xml`
  (ou *File › New › Image Asset* dans Android Studio).
- Nom : `app_name` dans `strings.xml` ; identifiant Play : `applicationId` dans `android/app/build.gradle.kts`
  (à choisir définitivement **avant** la première publication).
- Tableau de bord : variables CSS en tête de `src/styles.css` et `public/favicon.svg`.

## 12. API externes et serveur

- Adresse du serveur par défaut : propriété `pagio.serverUrl` (ex. `./gradlew assembleRelease -Ppagio.serverUrl=https://api.votre-domaine.com`),
  sinon `http://10.0.2.2:8787` (l'ordinateur vu depuis l'émulateur). L'utilisateur peut la changer dans *Réglages › Serveur*.
- En production le serveur doit être en **HTTPS** (`res/xml/network_security_config.xml` refuse le HTTP sauf en local).
- Démarrage du serveur, base de données, sauvegardes, Docker, LibreOffice : voir `docs/SERVEUR.md`.

**Lanceur de bureau** : `python main.py` (dans `app/`) installe ce qu'il faut, démarre le serveur et ouvre le tableau de bord
dans votre navigateur ; fermez la fenêtre pour l'arrêter. `python main.py --screenshot capture.png` photographie l'écran
de connexion avec un serveur temporaire (contrôle automatique).

## 13. Changer de fournisseur d'IA

Deux façons, sans recompiler :
- **Pour tous les utilisateurs** : tableau de bord › *Intelligence artificielle* : type d'API, adresse, modèle, clé.
  La clé reste sur le serveur ; chaque requête décompte des crédits IA. Préréglages : OpenAI, Claude, Gemini, Mistral, Groq, Ollama (gratuit, auto-hébergé).
- **Par utilisateur** : application › *Réglages › Intelligence artificielle* : sa propre clé (chiffrée par le Keystore Android).

Ajouter un nouveau type d'API : une classe qui implémente `AiProvider` dans `core/ai/.../Providers.kt` + une entrée dans
`ProviderType`, et un cas dans `aiComplete()` de `server/src/services.js`. Les invites (résumé, facture, etc.) sont dans
`core/ai/.../DocumentAssistant.kt`.

## 14. Lancer les tests

- Unitaires : `./gradlew :core:engine:testDebugUnitTest :core:ai:testDebugUnitTest`
- Sur appareil/émulateur : `./gradlew :core:engine:connectedDebugAndroidTest :core:ai:connectedDebugAndroidTest`
- Serveur : `cd server && npm test`
- Tableau de bord : `npm run build` (vérification TypeScript incluse)

Résultats de la dernière campagne : `docs/RAPPORT-DE-TESTS.md`.
