# Architecture commerciale : gratuit, Premium, crédits IA, abonnements

## Ce qui est déjà en place

- **Offres** Gratuit / Premium avec date de fin, stockées sur le serveur (`users.plan`, `users.premium_until`).
  Premium expiré → retour automatique à l'offre gratuite.
- **Quotas configurables** depuis le tableau de bord : tâches par jour, fichiers par traitement, taille maximale, par offre
  et par outil ; un outil peut être réservé au Premium. L'application applique ces règles (et les garde hors ligne).
- **Crédits IA** : attribués à l'inscription selon l'offre, décomptés à chaque requête, rechargeables (individuellement ou pour tous).
- **Historique synchronisé** des usages côté serveur (événements, IA, conversions) — le contenu des documents n'est jamais envoyé.

Par défaut, toutes les limites sont à 0 (illimité) : l'application est entièrement gratuite tant que vous ne décidez pas autrement.

## Brancher la vente d'abonnements (Google Play Billing) — à faire

Google Play impose son système de paiement pour les abonnements numériques. Étapes :

1. **Play Console** : créez l'application, puis *Monétiser › Abonnements* : par exemple `pagio_premium_mensuel` et `pagio_premium_annuel`
   (avec essai gratuit si vous le souhaitez).
2. **Application** : ajoutez `com.android.billingclient:billing-ktx` dans `gradle/libs.versions.toml`, puis un écran « Passer à Premium »
   qui lance l'achat (`BillingClient.launchBillingFlow`) et envoie le jeton d'achat au serveur.
3. **Serveur** : ajoutez une route `POST /api/me/purchase` qui vérifie le jeton auprès de l'API *Google Play Developer*
   (`purchases.subscriptionsv2.get`, compte de service Google Cloud) puis met `plan = 'premium'` et `premium_until` à la date d'échéance.
4. **Renouvellements / annulations** : abonnez le serveur aux *Real-time developer notifications* (Pub/Sub) pour mettre à jour `premium_until`.
5. **Crédits IA en achat unique** : produits « intégrés » (ex. 500 crédits) avec le même circuit ; le serveur ajoute les crédits (`add_credits`).

En attendant, vous pouvez vendre Premium hors Play (virement, Mobile Money, etc. dans le respect des règles de Google)
et l'attribuer depuis le tableau de bord (*Utilisateurs › Offre › Premium jusqu'au…*).

## Espace cloud facultatif — à faire

Le stockage des fichiers des utilisateurs n'est pas activé (choix de confidentialité). Pour l'ajouter : stockage objet
compatible S3 (Scaleway, OVHcloud, Backblaze, AWS) + routes d'envoi/réception chiffrées côté serveur, et un écran « Mes documents en ligne ».
