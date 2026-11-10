# Serveur Pagio et tableau de bord d'administration

## À quoi sert le serveur

L'application fonctionne **sans serveur** (tous les outils PDF, l'OCR, la traduction sur l'appareil, les analyses hors ligne).
Le serveur ajoute :

| Fonction | Détail |
|---|---|
| Comptes utilisateurs | inscription, connexion, suppression du compte, mot de passe oublié |
| Offres | Gratuit / Premium (avec date de fin), quotas par jour, taille et nombre de fichiers |
| Crédits IA | décomptés à chaque requête ; la clé du fournisseur reste sur le serveur |
| Configuration à distance | outils activés/désactivés/Premium, annonce, maintenance, version minimale obligatoire |
| Statistiques | événements anonymes (outils, erreurs, versions), uniquement si l'utilisateur l'accepte |
| Conversions haute fidélité | Word/Excel/PowerPoint/OpenDocument → PDF et PDF → Word via LibreOffice ; fichier effacé juste après |
| Support | messages des utilisateurs, demandes de réinitialisation |
| Administration | tableau de bord web avec rôles Propriétaire / Administrateur / Support et journal d'audit |

## Démarrage local (sur votre ordinateur)

```
cd app
npm install && npm run build          # construit le tableau de bord (dossier dist/)
cd server
npm install
npm start                             # http://localhost:8787
```

Au premier démarrage, le compte **propriétaire** est créé et affiché dans la console (et écrit dans
`server/data/premier-admin.txt`). Ouvrez `http://localhost:8787`, connectez-vous, puis changez le mot de passe
(*Mon compte*). Pour choisir vous-même : `ADMIN_EMAIL=vous@domaine.com ADMIN_PASSWORD='...' npm start`.

L'émulateur Android joint votre ordinateur à l'adresse `http://10.0.2.2:8787` (réglage par défaut de l'application).
Un vrai téléphone sur le même Wi-Fi : `http://<IP-de-l-ordinateur>:8787` — à autoriser dans `network_security_config.xml`
uniquement pour les tests ; en production, utilisez HTTPS.

## Mise en production (recommandé : Docker)

```
cd app
docker build -f server/Dockerfile -t pagio-server .
docker run -d --name pagio -p 8787:8787 -v pagio-data:/data \
  -e ADMIN_EMAIL=vous@domaine.com -e ADMIN_PASSWORD='un-mot-de-passe-long' pagio-server
```

L'image contient Node.js, LibreOffice et le tableau de bord. Placez-la derrière un proxy HTTPS
(Caddy, Nginx, Traefik ou l'offre de votre hébergeur) avec un nom de domaine, par exemple `https://api.pagio.app`.
Hébergeurs adaptés : un petit VPS (2 Go de RAM suffisent pour démarrer : OVHcloud, Scaleway, Hetzner, DigitalOcean),
Railway, Render ou Fly.io (avec un volume persistant pour `/data`).

Puis compilez l'application avec cette adresse :
`./gradlew assembleRelease -Ppagio.serverUrl=https://api.pagio.app`

## Installation en service (depuis le 10/11/2026)

| Élément | Valeur |
|---|---|
| Adresse | `https://pagio.hebergementci.com` (tableau de bord et API) |
| Machine | VPS Ubuntu 22.04, partagé avec d'autres sites : ne toucher ni à leur Nginx, ni à PM2, ni au Node.js du système |
| Conteneur Docker | `pagio` (image `pagio-server:latest`), redémarrage automatique, mémoire limitée à 1,2 Go |
| Port | `127.0.0.1:8787` uniquement (jamais ouvert au public ; le pare-feu n'a pas été modifié) |
| Code | `/var/www/pagio/app` (copie des fichiers suivis par Git) |
| Données | `/var/www/pagio/data` : `pagio.db`, `jwt-secret.key`, `secrets.key`, `backups/` |
| Nginx | un seul fichier, `/etc/nginx/sites-available/pagio` (modèle : `server/deploy/nginx-pagio.conf`) |
| HTTPS | certificat Let's Encrypt géré par Certbot, renouvelé automatiquement |
| Réglage | `TRUST_PROXY=1` |

Mettre à jour le serveur après une modification du code (à lancer depuis l'ordinateur, dossier du projet) :

```
git archive HEAD package.json package-lock.json index.html vite.config.ts tsconfig.json src public server | ssh root@72.62.148.170 "tar -x -C /var/www/pagio/app"
ssh root@72.62.148.170 "cd /var/www/pagio/app && docker build -f server/Dockerfile -t pagio-server:latest . && docker rm -f pagio && docker run -d --name pagio --restart unless-stopped --memory 1200m -p 127.0.0.1:8787:8787 -v /var/www/pagio/data:/data -e TRUST_PROXY=1 pagio-server:latest"
```

Créez d'abord une sauvegarde manuelle dans le tableau de bord. Les données ne sont pas dans le conteneur : elles survivent à son remplacement.
La base du VPS est désormais la base de référence ; celle de l'ordinateur ne sert plus qu'aux essais.

## Base de données

- **SQLite** intégré à Node.js : un seul fichier, `DATA_DIR/pagio.db`, aucune installation. Il supporte confortablement
  des dizaines de milliers d'utilisateurs actifs.
- Tables : `admins`, `users`, `settings`, `tools`, `events`, `ai_usage`, `conversions`, `feedback`, `audit`, `admin_sessions`,
  `plan_history`, `server_errors` (voir `server/src/db.js`). Les colonnes ajoutées par une nouvelle version sont créées au démarrage.
- **Sauvegarde** : automatique et quotidienne, voir la section *Sauvegardes*. Conservez aussi `jwt-secret.key` et `secrets.key`.
- **Passer à PostgreSQL** (forte charge, plusieurs serveurs) : le schéma est standard ; remplacez `node:sqlite`
  par le paquet `pg` dans `db.js`/`app.js` (les requêtes SQL sont simples et portables).

## Variables d'environnement

Voir `server/.env.example` : `PORT`, `DATA_DIR`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SOFFICE_PATH`, `DIST_DIR`,
`SECRETS_KEY`, `AI_API_KEY`, `TRUST_PROXY`.

Le serveur lit automatiquement le fichier `server/.env` s'il existe (les variables déjà définies par l'hébergeur restent prioritaires).
Ce fichier n'est jamais versionné.

## Sécurité

- Mots de passe hachés (scrypt), sessions signées HMAC-SHA256 (12 h pour l'admin, 90 jours pour l'application).
- Limitation des tentatives de connexion (10 par quart d'heure et par adresse).
- Rôles : **Support** (lecture, notes, avis), **Administrateur** (tout sauf l'équipe), **Propriétaire** (tout, y compris les administrateurs,
  la purge et la restauration des sauvegardes).
- Toutes les actions d'administration sont journalisées (*Journal d'audit*).

### Double authentification des administrateurs

*Mon compte et sécurité › Double authentification* : scannez le QR code avec Google Authenticator, Microsoft Authenticator ou Authy,
saisissez le code à 6 chiffres, puis notez les 8 codes de secours (affichés une seule fois, chacun utilisable une fois).
À la connexion, le code est demandé après le mot de passe. Un code ne peut pas être rejoué.
Le propriétaire peut retirer la double authentification d'un collègue (*Administrateurs › Retirer la 2FA*).
La page *Système* signale les administrateurs qui ne l'ont pas activée.

### Sessions

Chaque connexion crée une session en base (appareil, adresse IP, dernière activité), visible dans *Mon compte et sécurité*.
Fermer une session déconnecte l'appareil immédiatement. Changer son mot de passe ferme ses autres sessions ; réinitialiser le mot de
passe d'un collègue, le désactiver ou changer son rôle ferme les siennes. Le propriétaire voit les sessions de toute l'équipe.

### Secrets chiffrés

La clé du fournisseur d'IA et les secrets de double authentification sont chiffrés en base (AES-256-GCM). La clé de chiffrement vient de
`SECRETS_KEY`, sinon du fichier `DATA_DIR/secrets.key` généré au premier démarrage. Elle n'est **ni dans la base ni dans les sauvegardes** :
conservez-en une copie hors du serveur, avec `jwt-secret.key`. Si elle est perdue ou différente, il suffit de ressaisir la clé d'IA
(le tableau de bord le signale) et de retirer la double authentification avec la commande de secours ci-dessous.
`AI_API_KEY`, si elle est définie, remplace la clé saisie dans le tableau de bord. La clé n'est jamais renvoyée au navigateur.

### Protection contre les abus

*Pilotage de l'application › Protection contre les abus* : conversions par heure (sans compte, par adresse IP ; avec compte, par compte),
taille maximale d'un fichier à convertir, inscriptions par heure et par adresse, option « conversion réservée aux utilisateurs connectés ».
Deux conversions LibreOffice au plus tournent en même temps. Derrière un proxy HTTPS, définissez `TRUST_PROXY=1`, sinon toutes les
requêtes semblent venir de la même adresse.

### Accès de secours

À lancer sur le serveur, dans `server/`, si un administrateur a perdu son mot de passe, son téléphone et ses codes de secours :

```
npm run secours -- --liste
npm run secours -- vous@domaine.com --2fa             # retire la double authentification
npm run secours -- vous@domaine.com --mot-de-passe    # génère et affiche un nouveau mot de passe
```

Les sessions du compte sont fermées et l'opération est inscrite au journal d'audit.

## Sauvegardes

- **Automatique** : une sauvegarde par jour à partir de 3 h (heure du serveur), conservée 30 jours. Heure et durée se règlent dans la page
  *Sauvegardes*. Le serveur doit être allumé à ce moment-là ; sinon elle part au démarrage suivant.
- **Manuelle** : bouton *Créer une sauvegarde* (conseillé avant toute mise à jour). Les sauvegardes manuelles ne sont jamais supprimées seules.
- **Fichiers** : `DATA_DIR/backups/pagio-AAAAMMJJ-HHMMSS-type.db.gz` (copie cohérente de la base, compressée). Le service n'est pas interrompu.
- **Vérifier** contrôle l'intégrité d'une sauvegarde sans rien modifier.
- **Restaurer** (propriétaire, mot de passe redemandé) remplace toutes les données par celles de la sauvegarde, en une seule opération :
  si elle échoue, rien n'est modifié. L'état précédent est d'abord enregistré dans une sauvegarde « avant-restauration ».
- **Télécharger / Importer** (propriétaire) : pour garder une copie hors du serveur, ou transférer les données vers un autre serveur.
  Un fichier importé est vérifié avant d'être accepté.
- Une sauvegarde contient les comptes et les empreintes des mots de passe : traitez le fichier comme confidentiel.
- **Copie hors du serveur** : les sauvegardes sont sur le même disque que la base. Téléchargez-en une régulièrement, ou synchronisez le
  dossier `backups/` vers un autre stockage ; sans cela, la perte du disque emporte aussi les sauvegardes.

## Surveillance

- **Système** : jauges disque et mémoire, état du serveur, et liste des points à surveiller (disque presque plein, sauvegarde en retard,
  erreurs récentes, taux d'échec des conversions ou de l'IA, clé d'IA manquante, administrateurs sans double authentification).
  Les alertes urgentes s'affichent aussi en tête de la *Vue d'ensemble*.
- **Erreurs du serveur** : pannes internes, conversions LibreOffice en échec, refus du fournisseur d'IA, sauvegardes ratées, avec le détail
  technique. (Les erreurs des outils sur les téléphones restent dans *Événements*.)
- **Conversions** : nombre, échecs, durée moyenne, volume, répartition par type, causes d'échec, 100 dernières conversions.
- **Consommation IA** : requêtes, crédits, échecs, plus gros consommateurs, refus du fournisseur, crédits restant en circulation.
  Le montant facturé se lit chez le fournisseur : fixez-y un plafond de dépense mensuel.
- Les alertes ne sont pas encore envoyées par e-mail : il faut ouvrir le tableau de bord pour les voir.

## Ce que le tableau de bord permet

Vue d'ensemble (utilisateurs, Premium, appareils, traitements, erreurs, IA, graphiques, alertes), Utilisateurs (recherche, offre,
date de fin Premium, crédits, suspension, réinitialisation du mot de passe, suppression, export CSV, fiche détaillée avec historique
des offres, usage, conversions et messages, actions groupées sur une sélection),
Outils et limites (activer, réserver au Premium, limites par outil), Offres et crédits (quotas, recharge générale),
Intelligence artificielle (fournisseur, modèle, clé, coût par requête, test), Pilotage de l'application (maintenance,
annonce, dernière version, version minimale obligatoire, lien de mise à jour, inscriptions, conversions),
Consommation IA, Conversions, Avis et support, Événements, Erreurs du serveur, Journal d'audit, Administrateurs, Sauvegardes,
Système (état de la machine, alertes, purge), Mon compte et sécurité (mot de passe, double authentification, sessions).

## Tests

`cd server && npm test` lance 11 tests (base en mémoire, aucun réseau) : parcours complet de l'API, sessions, double authentification,
chiffrement de la clé d'IA, limites, sauvegardes et restauration, surveillance, fiche utilisateur et actions groupées.
