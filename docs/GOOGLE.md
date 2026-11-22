# Google : connexion avec Google et paiements Google Play

Ce que **vous** devez faire dans les consoles de Google (je ne crée pas de compte et ne saisis aucun paiement à votre place),
et ce que **je** construirai ensuite dans Pagio. Mis à jour le 23/11/2026.

Empreintes de la clé de signature de Pagio (servent à Google pour reconnaître l'application) :

| | Valeur |
|---|---|
| Nom du paquet | `com.pagio.app` |
| SHA-1 | `FC:06:1A:B3:D8:78:E0:6D:5B:71:AD:B4:20:94:D1:7D:00:C2:2A:4D` |
| SHA-256 | `66:A0:3C:CD:EA:9D:80:5C:B6:12:4F:BF:C7:83:22:67:89:FB:10:DD:7E:87:E9:2D:05:99:13:21:2A:F5:E9:4D` |

---

## A. Connexion avec Google (site app.pagio.site) — 10 minutes

1. Ouvrir **console.cloud.google.com** avec votre compte Google, créer un projet **Pagio** (le même servira pour Google Play).
2. **API et services › Écran de consentement OAuth** (ou « Google Auth Platform ») :
   - type d'utilisateurs **Externe** ; nom de l'application **Pagio** ; e-mail d'assistance : votre adresse ;
   - logo : `server/deploy/site/favicon.svg` exporté en PNG 120×120 ;
   - domaine autorisé : `pagio.site` ; page d'accueil `https://pagio.site` ; règles de confidentialité
     `https://pagio.site/confidentialite/` ; conditions `https://pagio.site/conditions/` ;
   - accès demandés : seulement `openid`, `email`, `profile` (aucune validation de Google nécessaire) ;
   - **Publier l'application** (statut « En production »), sinon seuls les comptes de test peuvent se connecter.
3. **API et services › Identifiants › Créer des identifiants › ID client OAuth** :
   - type **Application Web**, nom « Pagio web » ;
   - **Origines JavaScript autorisées** : `https://app.pagio.site` (aucune URI de redirection n'est nécessaire).
4. Copier l'**ID client** (il se termine par `.apps.googleusercontent.com`) et le coller dans le tableau de bord :
   *Pilotage de l'application › Services › Connexion avec Google : identifiant client*, puis **Enregistrer**.
   Le bouton « Continuer avec Google » apparaît aussitôt sur app.pagio.site.

Plus tard, pour le même bouton **dans l'application Android** : créer un second ID client de type **Android**, nom du paquet
`com.pagio.app`, empreinte **SHA-1** ci-dessus (et une seconde avec l'empreinte de Google Play, voir B.4).

---

## B. Paiements Google Play dans l'application — à faire avant la publication sur le Play Store

Règle de Google : dans la version **téléchargée depuis le Play Store**, le Premium et les crédits IA doivent être vendus par
**Google Play Billing** (Google prélève 15 % sur les abonnements, et 15 % sur le premier million de dollars par an des autres achats).
La version **APK du site** peut garder un paiement sur pagio.site (mobile money, carte) ; un achat fait d'un côté est reconnu de
l'autre grâce au compte Pagio.

### B.1 Compte développeur (une fois)
1. **play.google.com/console** : créer le compte développeur (frais unique de 25 $).
   Pour un compte **organisation** au nom de KODY BUSINESS, Google demande un numéro **D-U-N-S** (gratuit, quelques jours à obtenir
   sur dnb.com) et vérifie l'identité et l'adresse.
2. **Paramètres › Profil de paiement** : associer votre **profil marchand Google** existant (compte bancaire pour recevoir les ventes).

### B.2 Fiche de l'application
1. **Créer une application** : nom « Pagio », langue par défaut français, application gratuite (avec achats).
2. **Contenu de l'application** :
   - Règles de confidentialité : `https://pagio.site/confidentialite/`
   - Suppression de compte : `https://pagio.site/suppression-compte/`
   - Sécurité des données : je vous fournirai les réponses exactes (données collectées : e-mail, nom, statistiques facultatives,
     rapports de plantage facultatifs ; chiffrement en transit ; suppression possible).
   - Publicités : **non** ; public cible : 15 ans et plus ; catégorie : Productivité.
3. Je vous fournirai l'**AAB** (`android/apk/pagio-x.y.z.aab`) **avec la bibliothèque de paiement** intégrée : à envoyer dans
   **Tests › Test interne** (Google exige un AAB contenant la permission de paiement avant de créer les produits).

### B.3 Produits (Monétiser › Produits)
À créer une fois le premier AAB envoyé. **Gardez exactement ces identifiants** : l'application et le serveur les utiliseront.

| Type | ID produit | Forfait de base | Contenu | Prix de départ suggéré |
|---|---|---|---|---|
| Abonnement | `premium` | `mensuel` (renouvellement automatique, 1 mois) | Premium complet | 1 500 FCFA |
| | | `annuel` (renouvellement automatique, 1 an) | Premium complet | 12 000 FCFA |
| | | `semaine` (**prépayé**, 1 semaine, sans renouvellement) | Pass semaine | 400 FCFA |
| Produit intégré (consommable) | `credits_ia_100` | — | 100 crédits IA | 500 FCFA |

- Saisir le prix en **XOF (Côte d'Ivoire)**, puis « Mettre à jour les taux de change » : Google calcule le prix de chaque pays.
  Ajustez ensuite à la main les pays importants (France, Sénégal, Cameroun…).
- Facultatif : une **offre d'essai gratuit de 7 jours** sur `mensuel`.

### B.4 Vérification des achats par le serveur Pagio
Le serveur doit confirmer chaque achat auprès de Google (sinon un faux achat débloquerait le Premium).
1. Dans **Google Cloud** (projet Pagio) : activer l'**API Google Play Android Developer**.
2. **IAM › Comptes de service** : créer `pagio-paiements`, puis **Clés › Ajouter une clé › JSON** (fichier à garder secret).
3. Dans **Play Console › Utilisateurs et autorisations** : inviter l'adresse du compte de service avec les droits
   « Afficher les données financières » et « Gérer les commandes et les abonnements ».
4. **Notifications en temps réel** (renouvellements, annulations, remboursements) : dans Google Cloud, **Pub/Sub › Créer un sujet**
   `play-paiements` ; donner le rôle *Éditeur Pub/Sub* à `google-play-developer-notifications@system.gserviceaccount.com` ;
   créer un **abonnement de type push** vers `https://pagio.site/api/billing/google/rtdn` ; puis dans Play Console
   *Monétiser › Configuration de la monétisation*, indiquer le sujet et cliquer « Envoyer une notification de test ».
5. **Signature d'application par Google Play** : à la première publication, Google re-signe l'application ; recopiez l'empreinte
   SHA-1 qu'il affiche (*Configuration › Intégrité de l'application*) pour l'ID client Android de la partie A.
6. Le fichier JSON du compte de service : **ne pas l'envoyer dans une conversation**. Je préparerai une case dans le tableau de bord
   (chiffrée comme la clé IA) où vous le collerez vous-même.

### B.5 Essais sans payer
**Paramètres › Test de licence** : ajoutez vos adresses Gmail de test. Ces comptes achètent en mode test (aucun prélèvement ;
les abonnements se renouvellent toutes les quelques minutes pour vérifier les renouvellements).

### Ce que je construis ensuite (quand B.1 à B.3 sont faits)
- Application : bibliothèque **Google Play Billing**, écran « Passer à Premium » (prix affichés par Google dans la devise de
  l'utilisateur), achat, restauration des achats, gestion de l'abonnement ; dans la version APK du site, renvoi vers le paiement de pagio.site.
- Serveur : vérification de chaque achat auprès de Google, notifications en temps réel (renouvellement, annulation, remboursement),
  Premium et crédits attribués au compte, historique visible dans le tableau de bord (*Offres*).
