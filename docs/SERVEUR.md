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

## Base de données

- **SQLite** intégré à Node.js : un seul fichier, `DATA_DIR/pagio.db`, aucune installation. Il supporte confortablement
  des dizaines de milliers d'utilisateurs actifs.
- Tables : `admins`, `users`, `settings`, `tools`, `events`, `ai_usage`, `conversions`, `feedback`, `audit` (voir `server/src/db.js`).
- **Sauvegarde** : copiez régulièrement `pagio.db` (et `jwt-secret.key`) ; par exemple une tâche quotidienne
  `sqlite3 pagio.db ".backup /sauvegardes/pagio-$(date +%F).db"` ou la sauvegarde de volume de votre hébergeur.
- **Passer à PostgreSQL** (forte charge, plusieurs serveurs) : le schéma est standard ; remplacez `node:sqlite`
  par le paquet `pg` dans `db.js`/`app.js` (les requêtes SQL sont simples et portables).

## Variables d'environnement

Voir `server/.env.example` : `PORT`, `DATA_DIR`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SOFFICE_PATH`, `DIST_DIR`.

## Sécurité

- Mots de passe hachés (scrypt), sessions signées HMAC-SHA256 (12 h pour l'admin, 90 jours pour l'application).
- Limitation des tentatives de connexion (10 par quart d'heure et par adresse).
- La clé de l'IA n'est jamais renvoyée au navigateur (affichée masquée).
- Rôles : **Support** (lecture, notes, avis), **Administrateur** (tout sauf l'équipe), **Propriétaire** (tout, y compris les administrateurs et la purge).
- Toutes les actions d'administration sont journalisées (*Journal d'audit*).
- À ajouter si besoin : envoi d'e-mails (mot de passe oublié automatique) via un service SMTP/Brevo/Mailjet, double authentification des administrateurs.

## Ce que le tableau de bord permet

Vue d'ensemble (utilisateurs, Premium, appareils, traitements, erreurs, IA, graphiques), Utilisateurs (recherche, offre,
date de fin Premium, crédits, suspension, réinitialisation du mot de passe, suppression, activité, export CSV),
Outils et limites (activer, réserver au Premium, limites par outil), Offres et crédits (quotas, recharge générale),
Intelligence artificielle (fournisseur, modèle, clé, coût par requête, test), Pilotage de l'application (maintenance,
annonce, dernière version, version minimale obligatoire, lien de mise à jour, inscriptions, conversions),
Avis et support, Événements, Journal d'audit, Administrateurs, Système (état, taille de la base, purge), Mon compte.
