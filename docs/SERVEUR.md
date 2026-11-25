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
`./gradlew assembleRelease -Ppagio.serverUrl=https://pagio.site`

## Installation en service (depuis le 10/11/2026)

| Élément | Valeur |
|---|---|
| Adresses | `https://pagio.site` (et `www`, et l'ancienne `pagio.hebergementci.com`) : site public, API de l'application, pages des liens e-mail. **Le tableau de bord et `/api/admin` n'y existent pas** (404, y compris en majuscules) |
| Tableau de bord | `https://admin.pagio.site`, **seulement pour les appareils autorisés** (certificat client) : sans certificat, la connexion est coupée sans rien afficher |
| Domaine | `pagio.site`, acheté chez Hostinger : `A @ → 72.62.148.170`, `A admin → 72.62.148.170`, `CNAME www → pagio.site` (aucun MX/TXT pour l'instant) |
| Machine | VPS Ubuntu 22.04, partagé avec d'autres sites : ne toucher ni à leur Nginx, ni à PM2, ni au Node.js du système |
| Conteneur Docker | `pagio` (image `pagio-server:latest`), redémarrage automatique, mémoire limitée à 1,2 Go |
| Port | `127.0.0.1:8787` uniquement (jamais ouvert au public ; le pare-feu n'a pas été modifié) |
| Code | `/var/www/pagio/app` (copie des fichiers suivis par Git) |
| Données | `/var/www/pagio/data` : `pagio.db`, `jwt-secret.key`, `secrets.key`, `backups/` |
| Nginx | `/etc/nginx/sites-available/pagio` (un bloc par domaine) + `/etc/nginx/snippets/pagio-public.conf` et `pagio-proxy.conf` (modèles dans `server/deploy/`) ; site public statique dans `/var/www/pagio/site` (`server/deploy/site/`) |
| HTTPS | certificats Let's Encrypt `pagio.site` (pagio.site + www) et `pagio.hebergementci.com`, gérés par Certbot, renouvelés automatiquement |
| Réglages | `TRUST_PROXY=1`, `PUBLIC_URL=https://pagio.site` (adresse des liens envoyés par e-mail) |

### Appareils autorisés (admin.pagio.site)

Autorité privée dans `/root/pagio-admin-ca` (copie hors du serveur : clé USB), liste dans `/etc/nginx/pagio-admin-appareils.conf`.
Outil : `/root/admin-appareils.sh` (source : `server/deploy/admin-appareils.sh`).

```
ssh root@72.62.148.170 "sh /root/admin-appareils.sh liste"
ssh root@72.62.148.170 "sh /root/admin-appareils.sh nouveau telephone"    # crée /root/pagio-admin-ca/appareils/telephone.p12 + .code
ssh root@72.62.148.170 "sh /root/admin-appareils.sh retirer telephone"    # refusé immédiatement
```

Installer sur Windows : double-clic sur le `.p12` → Utilisateur actuel → code → « Placer tous les certificats dans le magasin suivant » → **Personnel**
(ne pas installer d'autorité racine). Fermer complètement Chrome, puis ouvrir `https://admin.pagio.site` et choisir le certificat.
Appareil `pc-bureau` autorisé le 20/11/2026.

### IPv6 (depuis le 23/11/2026)

Le VPS a aussi une adresse **IPv6 : `2a02:4780:41:acdb::1`**. Enquête du 23/11/2026 : chez Orange Côte d'Ivoire, l'IPv4 passe par un
partage d'adresses (DS-Lite / CGNAT, adresse de box en 10.x, saut 192.0.0.1) qui perdait jusqu'à 10 connexions sur 12 vers l'Europe
(pagio.site, GitHub, hostinger.com…), alors que l'IPv6 passait sans perte. Enregistrements **AAAA** ajoutés : `pagio.site` (et `www`),
`admin.pagio.site`, `wazzapai.com` (et `www`), `miditloungegarden.com` (et `www`) chez Hostinger ; `whatsai.duckdns.org` et
`photopilot.duckdns.org` chez DuckDNS (`/root/duckdns.sh` envoie aussi l'IPv6 de whatsai). Nginx écoute `[::]:80` et `[::]:443`
pour ces sites (sauvegardes des fichiers modifiés : `/root/nginx-*.bak-ipv6`). Renouvellement des certificats testé en IPv6.
Reste : `gestionscolaire` et `pagio` `.hebergementci.com` (DNS chez **LWS**, serveur déjà prêt). `numerik360.com` ne répond plus
dans le DNS (domaine probablement expiré). Pour l'administration depuis un PC chez Orange, se connecter en IPv6 :
`ssh -o HostKeyAlias=72.62.148.170 root@2a02:4780:41:acdb::1`.

### Connexions qui restent bloquées 20 à 50 secondes (corrigé le 22/11/2026)

Symptôme : après quelques secondes sans rien faire, la requête suivante (connexion, code, ouverture d'un module) attendait
20 à 50 secondes, puis tout redevenait normal. Le serveur répondait pourtant en quelques millisecondes.
Cause (mesurée côté Chrome et par capture réseau sur le VPS) : sur le trajet entre l'utilisateur et le VPS, les connexions
inactives sont coupées en silence ; Chrome réutilise la connexion morte, Windows réessaie pendant environ 20 secondes, puis
Chrome en ouvre une nouvelle. Tous les sites du VPS étaient touchés (wazzapai.com aussi), pas Google.
Correction : signaux de maintien TCP envoyés par le serveur toutes les 5 secondes sur les connexions inactives, réglés une
seule fois sur le port 443 (IPv4) et donc valables pour tous les sites du VPS, dans le bloc `admin.pagio.site` :
`listen 443 ssl so_keepalive=5s:5s:4;` (sauvegarde avant modification : `/root/nginx-pagio.bak-keepalive`).
Journal de chronométrage des requêtes Pagio : `/var/log/nginx/pagio-chrono.log` (format `pagio_chrono` dans
`/etc/nginx/conf.d/pagio-chrono.conf`).

Mettre à jour le serveur après une modification du code (à lancer depuis l'ordinateur, dossier du projet) :

```
git archive HEAD package.json package-lock.json index.html vite.config.ts tsconfig.json src public server | ssh root@72.62.148.170 "tar -x -C /var/www/pagio/app"
ssh root@72.62.148.170 "cd /var/www/pagio/app && docker build -f server/Dockerfile -t pagio-server:latest . && docker rm -f pagio && docker run -d --name pagio --restart unless-stopped --memory 1200m -p 127.0.0.1:8787:8787 -v /var/www/pagio/data:/data -v /var/www/pagio/site/telecharger:/telecharger -e RELEASES_DIR=/telecharger -e TRUST_PROXY=1 -e PUBLIC_URL=https://pagio.site pagio-server:latest"
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
`SECRETS_KEY`, `AI_API_KEY`, `MAIL_API_KEY`, `PUBLIC_URL`, `TRUST_PROXY`.

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

## E-mails automatiques

Page *E-mails* du tableau de bord. L'envoi passe par l'API de Brevo (offre gratuite : 300 e-mails par jour).

| Message | Quand | Détail |
|---|---|---|
| Nouveau mot de passe | l'utilisateur touche « Mot de passe oublié » dans l'application | lien valable 1 heure, utilisable une fois, vers une page du serveur (`/reinitialiser`) où il choisit son mot de passe |
| Confirmation d'adresse | à l'inscription (option) | lien valable 7 jours (`/verifier`) ; l'inscription n'est pas bloquée, la fiche de l'utilisateur indique si l'adresse est confirmée |
| Alertes du serveur | toutes les 10 minutes si une alerte urgente ou à surveiller existe (option) | une même alerte n'est renvoyée qu'une fois par 24 heures tant qu'elle dure |

Mise en route : dans Brevo, validez une adresse d'expéditeur et créez une clé API (*SMTP et API › Clés API*) ; dans la page *E-mails*,
collez la clé, l'adresse d'expéditeur et l'adresse publique du serveur, activez, enregistrez, puis envoyez un e-mail d'essai.

- La clé Brevo est chiffrée en base comme la clé d'IA et n'est jamais renvoyée au navigateur. `MAIL_API_KEY`, si elle est définie, la remplace.
- Les liens contiennent un jeton aléatoire dont seule l'empreinte est stockée en base.
- Sans e-mails activés, rien ne change : les demandes de mot de passe oublié apparaissent dans *Avis et support* et se traitent à la main.
- Un envoi refusé par Brevo est inscrit dans *Erreurs du serveur* (source « email ») et signalé dans les alertes.
- Aucune modification de l'application Android n'a été nécessaire : elle affiche le message renvoyé par le serveur.
- Brevo désactive une clé d'API restée 90 jours sans servir : le serveur la garde active par un contact sans envoi une fois par
  semaine (lecture des statistiques d'envoi, droit « E-mails transactionnels » suffisant). Une clé refusée devient une alerte
  critique « clé Brevo refusée » ; coller une nouvelle clé relance la vérification.
- L'adresse publique doit être celle du site ouvert aux utilisateurs (`https://pagio.site`) : `admin.…` est refusée, car les liens des
  e-mails ne s'ouvriraient pas chez les utilisateurs.

Mise en place du 22/11/2026 : domaine `pagio.site` authentifié dans Brevo (code Brevo, DKIM `brevo1`/`brevo2._domainkey`, DMARC
`p=none`), expéditeurs `noreply@pagio.site` et `contact@pagio.site`. Réception : ImprovMX (MX `mx1`/`mx2.improvmx.com`, SPF
`include:spf.improvmx.com`) renvoie toutes les adresses `@pagio.site` vers la boîte de l'administrateur. Réponses en tant que
`contact@pagio.site` depuis Gmail par le SMTP de Brevo (`smtp-relay.brevo.com:587`, clé SMTP distincte de la clé d'API).
- Un nouveau mot de passe (lien « mot de passe oublié » ou changement par un administrateur) déconnecte aussitôt tous les
  téléphones connectés au compte : les badges émis avant le changement sont refusés (colonne `users.tokens_valid_after`).
  L'application efface alors son badge et demande de se reconnecter.

## Surveillance

- **Système** : jauges disque et mémoire, état du serveur, et liste des points à surveiller (disque presque plein, sauvegarde en retard,
  erreurs récentes, taux d'échec des conversions ou de l'IA, clé d'IA manquante, administrateurs sans double authentification).
  Les alertes urgentes s'affichent aussi en tête de la *Vue d'ensemble*.
- **Erreurs du serveur** : pannes internes, conversions LibreOffice en échec, refus du fournisseur d'IA, sauvegardes ratées, avec le détail
  technique. (Les erreurs des outils sur les téléphones restent dans *Événements*.)
- **Conversions** : nombre, échecs, durée moyenne, volume, répartition par type, causes d'échec, 100 dernières conversions.
- **Consommation IA** : requêtes, crédits, échecs, plus gros consommateurs, refus du fournisseur, crédits restant en circulation.
  Le montant facturé se lit chez le fournisseur : fixez-y un plafond de dépense mensuel.
- Les alertes peuvent être envoyées par e-mail (page *E-mails*).

### Gardien (depuis le 22/11/2026)

`/root/pagio-gardien.sh` (source : `server/deploy/pagio-gardien.sh`), lancé chaque minute par `/etc/cron.d/pagio-gardien`, hors du conteneur :
vérifie `http://127.0.0.1:8787/api/health` et `https://pagio.site/api/health` ; après 3 échecs de suite, redémarre le conteneur `pagio`
(au plus une fois par 10 minutes) ; si seul Nginx est arrêté, le relance sans toucher aux autres sites. Chaque panne (début, fin,
durée, redémarrage) est notée dans `/var/www/pagio/data/gardien/incidents.jsonl` ; l'expiration des certificats HTTPS de Pagio,
dans `certificats.json` (chaque heure). Le tableau de bord (*Système › Disponibilité*) affiche la disponibilité sur 30 jours, les pannes
et les certificats ; alertes : certificat à moins de 14 jours (urgent à 5), panne dans les 24 h, gardien silencieux depuis 10 minutes.
Mise à jour : `scp server/deploy/pagio-gardien.sh root@72.62.148.170:/root/` puis `sed -i 's/\r$//' /root/pagio-gardien.sh`.

### Versions de l'application (depuis le 25/11/2026)

Tableau de bord › *Versions de l'appli* (propriétaire) : choisir l'APK signée, saisir son numéro (vérifié dans le fichier, ainsi
que le paquet `com.pagio.app`), des notes de version, et si besoin « mise à jour obligatoire » (règle `min_version_code`).
Le serveur l'enregistre dans `/var/www/pagio/site/telecharger` (monté dans le conteneur : `-v …/telecharger:/telecharger
-e RELEASES_DIR=/telecharger`), fait pointer `pagio.apk` dessus, réécrit `version.json` et annonce le numéro et les notes
aux applications (bandeau « Nouvelle version », notes affichées au toucher). « Version d'essai » = fichier `-essai` en lien
direct, non annoncé. « Proposer à tous » sur une ancienne version = retour en arrière. `android/publier-apk.sh` reste utilisable.

### APK admin et notifications

`android/admin` (application `com.pagio.admin`, « Pagio Admin », jamais publiée) : le tableau de bord d'admin.pagio.site sur le téléphone,
avec les mêmes modules que sur PC. Construction : `./gradlew.bat :admin:assembleRelease` dans `android/` (signée avec la même clé).
1. Sur le VPS : `/root/admin-appareils.sh nouveau telephone` crée `telephone.p12` (+ `telephone.code`) ; copiez-les sur le téléphone.
2. Téléphone : *Paramètres › Sécurité › Chiffrement et identifiants › Installer un certificat › Certificat utilisateur VPN et appli*
   (chemin variable selon la marque), choisir `telephone.p12`, saisir le code.
3. Installer Pagio Admin, l'ouvrir, choisir ce certificat quand Android le propose, puis se connecter (mot de passe + double authentification).
4. À la connexion, le téléphone reçoit une **clé de notification** (lecture du flux seulement, empreinte seule en base) : il apparaît dans
   *Système › Téléphones notifiés*, où l'on peut le retirer. Toutes les 15 minutes, l'application lit `/api/admin/notify/feed` et notifie :
   alertes nouvelles, messages des utilisateurs, pannes réparées par le gardien, et « Pagio ne répond pas » après 30 minutes sans réponse.
5. **Depuis la 1.1.0 (25/11/2026)** : *Système › Notifications sur téléphone* montre des **cases à cocher par téléphone** (alertes
   urgentes, à surveiller, pannes réparées, messages, paiements, nouveaux Premium, inscriptions, silence la nuit 22 h – 7 h) et un
   bouton **Envoyer un essai**. Le serveur transforme chaque fait en événement (`notify_events`, gardés 30 jours, alertes et pannes
   relevées chaque minute) ; le flux (`?since=`) ne donne à chaque téléphone que ce qui est coché.
   **Firebase (instantané)** : *Système › Firebase*, coller `google-services.json` puis la clé de compte de service (chiffrée en base) ;
   le téléphone récupère la configuration à sa vérification suivante et envoie son jeton. Projet Firebase : `pagio-515720`.
Retirer le téléphone : `/root/admin-appareils.sh retirer telephone` (plus d'accès) et *Système › Téléphones notifiés › Retirer*.

## Outils en ligne et connexion sur pagio.site (depuis le 23/11/2026)

Boutons **« Outils en ligne »** et **« Se connecter »** dans le menu de pagio.site → `https://pagio.site/app/` (pas d'adresse à part ;
`app.pagio.site`, créé puis retiré le 23/11/2026, n'existe plus). Source : `web/` (React + TypeScript + Vite, `pdf-lib` et `pdf.js`).
Mêmes comptes que l'application Android (inscription libre, « Mot de passe oublié », connexion avec Google). Outils dans le navigateur,
sans envoi de fichier : fusionner, extraire ou supprimer des pages, pivoter, images en PDF, numéroter, filigrane. Par le serveur
(compte requis) : Office en PDF, résumé ou question par l'IA (seul le texte du PDF est envoyé). Limites gratuites par outil comptées
dans le navigateur, comme sur le téléphone. Pas de statistiques d'usage.
Nginx : `location /app/` dans `server/deploy/nginx-pagio-public.conf` (en-têtes de sécurité, CSP limitée au bouton Google, module
`.mjs` de pdf.js servi comme JavaScript). Mise à jour :
```
npm --prefix web run build
tar -cf - -C web/dist . | ssh root@72.62.148.170 "cd /var/www/pagio/site/app && rm -rf ./* && tar --no-same-owner -xf - && chmod -R a+rX ."
```
**Connexion avec Google** : créer un « ID client OAuth » de type *Application Web* (origines `https://pagio.site` et
`https://www.pagio.site`, voir `docs/GOOGLE.md`) et le coller dans *Pilotage de l'application › Services › Connexion avec Google*.
Sans identifiant, le bouton est masqué. Le serveur vérifie la signature du jeton de Google (clés publiques de Google), l'émetteur,
le destinataire, l'expiration et l'adresse vérifiée (`server/src/google.js`).

## Ce que le tableau de bord permet

Vue d'ensemble (utilisateurs, Premium, appareils, traitements, erreurs, IA, graphiques, alertes), Utilisateurs (recherche, offre,
date de fin Premium, crédits, suspension, réinitialisation du mot de passe, suppression, export CSV, fiche détaillée avec historique
des offres, usage, conversions et messages, actions groupées sur une sélection),
Outils et limites (activer, réserver au Premium, limites par outil), Offres et crédits (quotas, recharge générale),
Intelligence artificielle (fournisseur, modèle, clé, coût par requête, test), Pilotage de l'application (maintenance,
annonce, dernière version, version minimale obligatoire, lien de mise à jour, inscriptions, conversions),
Consommation IA, Conversions, E-mails (Brevo, confirmation d'adresse, alertes), Avis et support, Événements, Erreurs du serveur, Journal d'audit, Administrateurs, Sauvegardes,
Système (état de la machine, alertes, purge), Mon compte et sécurité (mot de passe, double authentification, sessions).

## Tests

`cd server && npm test` lance 25 tests (base en mémoire, aucun réseau) : parcours complet de l'API, sessions, double authentification,
chiffrement de la clé d'IA, limites, sauvegardes et restauration, surveillance, fiche utilisateur et actions groupées, e-mails
(réglages, mot de passe oublié, confirmation d'adresse, alertes).

## Catalogue des outils et pages d'outils (depuis le 24/11/2026)

Source unique : `server/deploy/site-src/outils.mjs` (40 outils : nom, description, mots-clés, FAQ, en français et en anglais).
`node server/deploy/site-src/generer.mjs` produit une page par outil (`/<adresse>/` en français, `/en/<address>/` en anglais),
les listes `/outils/` et `/en/tools/`, `sitemap.xml`, `robots.txt`, et met à jour le catalogue et le nombre d'outils de
`index.html` (entre `/*CATALOGUE*/` et `/*FIN CATALOGUE*/`). Sur la page d'accueil, un outil disponible dans le navigateur
mène à `/app/#/outil/<id>`, les autres à leur page. Mise en ligne du site :
```
node server/deploy/site-src/generer.mjs
tar -cf - -C server/deploy/site . | ssh root@72.62.148.170 "cd /var/www/pagio/site && tar --no-same-owner -xf - && chmod -R a+rX ."
```

## Mesures du serveur (module Système, depuis le 24/11/2026)

Le gardien (`/root/pagio-gardien.sh`, chaque minute) écrit aussi dans `/var/www/pagio/data/gardien/` :
`mesures.jsonl` (une ligne par minute, 30 jours : processeur, mémoire, échange, disque, réseau, mémoire et redémarrages du
conteneur, taille de la base et des sauvegardes, requêtes de pagio.site avec erreurs 4xx/5xx et temps de réponse lus dans
`/var/log/nginx/pagio-chrono.log`), `sites.json` (toutes les 5 minutes : réponse de chaque site servi par Nginx, en lecture
seule, admin.pagio.site exclu) et `certificats.json` (tous les certificats de `/etc/letsencrypt/live`, chaque heure).
Le tableau de bord (*Système*) en tire graphiques 24 h / 7 j / 30 j, disponibilité, prévision « disque plein », état des sites
et seuils d'alerte réglables (réglage `monitor`). Sauvegarde de l'ancien gardien : `/root/pagio-gardien.sh.bak-mesures`.
