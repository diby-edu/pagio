# Audit technique, sécurité et qualité — 20 novembre 2026

Périmètre : serveur (Node/Express/SQLite), tableau de bord d'administration (React), application Android (v7 → v8).
Le serveur en ligne étant arrêté (VPS expiré), **tous les tests d'attaque et de charge ont été faits sur un serveur d'essai
jetable** (`server/test/audit/serveur-essai.mjs` : base en mémoire, port 8899, effacé à l'arrêt), avec le même code.

Légende : ✅ conforme · 🔧 faille trouvée **et corrigée** pendant l'audit · ⚠️ point à traiter · ⏳ non vérifié.

## 1. Synthèse

| Domaine | Résultat |
|---|---|
| Tests d'intrusion (41 contrôles automatisés) | 4 failles trouvées → **0 après correction** |
| Failles trouvées en lisant le code | 5 → toutes corrigées |
| Tests automatiques du serveur | 25/25 (dont 5 nouveaux qui verrouillent les corrections) |
| Secrets dans GitHub (dépôt public, tout l'historique) | ✅ aucun (clés, mots de passe, base, clé de signature) |
| Tableau de bord sur téléphone / tablette / ordinateur | 6 pages débordaient de 2 px sur téléphone → 🔧 corrigé |
| Accessibilité du tableau de bord | 3 défauts mineurs → 🔧 corrigés |
| Plantages de l'application | aucun suivi → 🔧 remontée des plantages ajoutée |

## 2. Failles corrigées

| # | Gravité | Faille | Démonstration | Correction |
|---|---|---|---|---|
| 1 | **Haute** | **Lien « mot de passe oublié » détournable** : sans adresse publique réglée, le lien était construit avec l'en-tête `Host` envoyé par le client. Un pirate pouvait faire envoyer à sa victime un lien vers son propre site et voler le jeton, donc le compte. | lecture du code (`publicUrl`) | Les liens n'utilisent plus que l'adresse publique configurée ; sans elle, aucun lien ne part et une alerte s'affiche (page *E-mails*). Test : `audit-failles.test.js` |
| 2 | Moyenne | **Remise à zéro des blocages** : le compteur anti-force brute était vidé au-delà de 10 000 entrées. En envoyant 10 100 adresses bidon, on débloquait un compte. | 429 avant saturation → 401 après | Seules les entrées expirées sont retirées ; sous attaque massive, les nouvelles entrées sont refusées |
| 3 | Moyenne | **Pulvérisation de mots de passe** : aucun plafond par adresse IP, on pouvait essayer un mot de passe courant sur des milliers de comptes. | 60 comptes essayés sans blocage | Plafond de 40 essais / 15 min par IP (20 pour l'administration) |
| 4 | Moyenne | **Énumération des comptes par chronométrage** : connexion en 220 ms si le compte existe, 3 ms sinon. | mesure 220 ms / 3 ms | Calcul factice quand le compte n'existe pas : 107 ms / 113 ms |
| 5 | Moyenne | **Injection de formule dans l'export CSV** : un client nommé `=HYPERLINK(...)` piégeait l'administrateur ouvrant l'export dans Excel. | formule présente dans l'export | Cellules commençant par `= + - @` préfixées d'une apostrophe |
| 6 | Moyenne | **Fuite possible d'un morceau de clé d'IA** : le message d'erreur du fournisseur était renvoyé tel quel à l'utilisateur (certains incluent une partie de la clé). | lecture du code | Message générique côté utilisateur ; le détail reste dans le journal du serveur |
| 7 | Moyenne | **Serveur figé par les connexions** : le calcul du mot de passe (scrypt) bloquait tout le serveur ~0,2 s par connexion. | test de charge | Calcul déplacé hors du fil principal (connexion, inscription, connexion admin) |
| 8 | Moyenne | **Android – lien `file://` vers les fichiers privés** : une autre application pouvait demander à Pagio d'ouvrir un de ses propres fichiers privés. | lecture du code (`Workspace.import`) | Fichiers du dossier privé refusés par cette voie |
| 9 | Basse | **Android – plantage sur fichier illisible** reçu d'une autre application. | lecture du code | Fichier ignoré avec un message |
| 10 | Haute (données) | **Android – rotation de l'écran** : toutes les modifications en cours de l'éditeur étaient perdues. | constaté sur le Xiaomi 12T | L'écran n'est plus recréé lors d'une rotation (v7) |

## 3. Ce qui a été vérifié et est conforme

**Serveur**
- Mots de passe : scrypt salé (jamais stockés en clair), comparaison en temps constant ✅
- Jetons signés HMAC-SHA256 : jeton sans signature, modifié, prolongé ou aléatoire → tous refusés ✅
- Droits : jeton client refusé sur l'administration ; le rôle *support* est bloqué sur les 7 actions réservées ✅
- Injection SQL (connexion, recherche, identifiants dans l'adresse) : aucune, requêtes paramétrées partout ✅
- XSS : paramètres des pages « nouveau mot de passe » et « confirmation » échappés ; tableau de bord en React + CSP stricte ✅
- Fichiers : impossible de sortir du dossier des sauvegardes (`../`) ; nom de fichier de conversion nettoyé ✅
- Champs interdits à l'inscription (offre, crédits) ignorés ✅
- Requêtes de plus de 2 Mo refusées ; mot de passe de 1,9 Mo traité en 113 ms ✅
- En-têtes : CSP, anti-iframe, `nosniff`, version masquée, `noindex` sur le tableau de bord ✅
- Erreurs : aucune trace technique renvoyée au client ✅
- Clés d'IA et d'e-mail chiffrées (AES-256-GCM), double authentification et sessions révocables pour les administrateurs ✅
- Nouveau mot de passe → tous les téléphones déconnectés aussitôt ✅

**Android**
- HTTPS obligatoire (sauf ordinateur de développement) ✅ · jeton et clés chiffrés par le Keystore matériel ✅
- Secrets exclus des sauvegardes Google ✅ · partage de fichiers limité à 3 dossiers ✅ · code réduit et obscurci (R8) ✅
- 43/43 boutons-icônes ont un nom pour le lecteur d'écran ✅ · tailles de texte adaptées au réglage du téléphone ✅

## 4. Test de charge (serveur d'essai, sur l'ordinateur de développement)

Le programme qui envoie les requêtes tourne sur le même ordinateur que le serveur : les chiffres sont donc **pessimistes**.

| Scénario | Clients simultanés | Débit | 95 % des réponses sous |
|---|---|---|---|
| Configuration de l'application | 50 | 203 req/s | 489 ms |
| Profil connecté | 50 | 309 req/s | 350 ms |
| Statistiques d'usage | 20 | 218 req/s | 176 ms (limite anti-abus déclenchée comme prévu) |
| Tableau de bord (fichiers) | 50 | 873 req/s | 79 ms |

Aucune erreur serveur. Un téléphone envoie quelques requêtes par session : cela correspond à plusieurs milliers
d'utilisateurs actifs par jour. Les conversions LibreOffice (2 simultanées au plus) restent le goulot d'étranglement.

## 5. Tableau de bord : affichage et accessibilité

17 pages contrôlées en 375 px (téléphone), 768 px (tablette), 1440 px (ordinateur).
- 🔧 6 pages dépassaient de 2 px sur téléphone (grille de formulaires à 340 px minimum).
- 🔧 Cases à cocher de 13 px → 20 px (+ marge = cible de 24 px, norme WCAG 2.2).
- 🔧 Rouge des boutons « danger » : contraste 3,9:1 → 5,3:1 (norme 4,5:1).
- 🔧 Deux champs de recherche identifiés seulement par leur exemple → étiquette pour lecteur d'écran.
- 🔧 Contour visible sur l'élément actif au clavier.
- ✅ Langue déclarée, un titre par page, tous les boutons ont un nom, aucun ordre de tabulation forcé.

## 6. Suivi des erreurs (monitoring)

| Source | Avant | Après |
|---|---|---|
| Serveur | journal des erreurs, alertes dans le tableau de bord et par e-mail | inchangé ✅ |
| Application | **rien** | 🔧 plantages enregistrés, envoyés au lancement suivant comme événement `app_crash` (page *Événements*), uniquement si l'utilisateur a accepté les statistiques ; aucune donnée personnelle |
| Disponibilité du serveur | **rien** : l'arrêt du VPS est passé inaperçu | ⚠️ à ajouter : un service gratuit de surveillance (UptimeRobot, Better Stack…) qui appelle `https://pagio.hebergementci.com/api/health` toutes les 5 minutes et prévient par e-mail ou SMS |

## 7. Points restants (non corrigés, à décider)

| Gravité | Point | Recommandation |
|---|---|---|
| ⚠️ Moyenne | Coût de scrypt `N=16384` : en dessous de la recommandation OWASP actuelle (`N=131072`) | Augmenter à `N=65536` avec ré-empreinte à la connexion suivante ; mesurer la mémoire du VPS avant |
| ⚠️ Moyenne | Conversion LibreOffice ouverte aux visiteurs sans compte (selon le réglage) : un document piégé vise LibreOffice | Activer « compte exigé pour la conversion » en production ; garder LibreOffice dans son conteneur Docker et à jour |
| ⚠️ Moyenne | Outils Premium **hors ligne** vérifiés par l'application seule : une version modifiée de l'APK peut les débloquer | Accepté au lancement ; plus tard, API Play Integrity. L'IA et les conversions, elles, sont contrôlées par le serveur |
| ⚠️ Moyenne | E-mails : sans authentification du domaine d'envoi (SPF, DKIM, DMARC), les messages de Pagio peuvent finir en indésirables ou être imités (hameçonnage) | Authentifier le domaine dans Brevo avant d'activer les e-mails |
| ⚠️ Basse | L'inscription indique si une adresse a déjà un compte | Compromis courant ; le plafond par IP limite l'exploitation |
| ⚠️ Basse | Dépôt GitHub public | Le passer en privé (aucun secret dedans, mais le code commercial est visible de tous) |
| ⏳ | Configuration HTTPS et Nginx du VPS non retestée (serveur arrêté) | Relancer `intrusion.mjs` contre le serveur en ligne une fois le VPS renouvelé |
| ⏳ | Conversion LibreOffice non testée sous attaque (LibreOffice absent de l'ordinateur de test) | Idem, sur le VPS |
| ⏳ | Accessibilité Android avec TalkBack, et v8 sur un vrai téléphone | À tester |

## 8. Référencement (SEO / ASO)

Une application mobile n'a pas de référencement web : ce qui compte est la **fiche Play Store** (ASO) — titre, description
courte avec les mots que les gens cherchent (« PDF », « scanner », « fusionner », « compresser »), captures d'écran, note.
Le tableau de bord est volontairement exclu des moteurs de recherche (`noindex`) ✅. Il manque une **petite page web
publique** pour la politique de confidentialité et la suppression de compte, exigées par Google Play.

## 9. Rejouer l'audit

```bash
node server/test/audit/serveur-essai.mjs 8899 <fichier-identifiants-hors-dépôt>
node server/test/audit/intrusion.mjs http://127.0.0.1:8899 <fichier-identifiants> resultats.json
node server/test/audit/charge.mjs http://127.0.0.1:8899
```
