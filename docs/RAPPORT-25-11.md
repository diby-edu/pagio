# Rapport de la nuit du 25/11/2026

## Ce qui est en ligne ce matin (pagio.site)

**29 outils sur 41 s'utilisent maintenant directement sur le site**, sans installer l'application. Avant cette nuit, il y en avait 9.

### Outils qui marchent dans le navigateur (les fichiers ne quittent pas l'appareil)
Diviser, Organiser les pages (avec miniatures), Extraire le texte, PDF en images, Texte en PDF, Créer un PDF (vierge, ligné,
quadrillé, à points), En-tête et pied de page, Signer (signature dessinée au doigt ou à la souris), Remplir un formulaire,
Propriétés du PDF, Nettoyer les métadonnées.

**Nouveau : Carte d'identité recto verso sur une page A4** (étape 5). Gratuit et illimité. Taille réelle (comme une photocopie)
ou agrandie, 1 ou 2 exemplaires sur la page, noir et blanc possible. Il a sa propre page pour Google :
https://pagio.site/carte-identite-recto-verso/

### Outils qui passent par le serveur (compte Pagio obligatoire)
Compresser (3 niveaux), Réparer, Protéger par mot de passe, Déverrouiller, HTML en PDF, **OCR** (rend le texte des
documents scannés lisible et copiable), **PDF en Word**, **PDF en PowerPoint**.

- **File d'attente** : 2 traitements à la fois au maximum ; les comptes **Premium passent devant** les comptes gratuits.
- Chaque outil se règle dans *Outils et limites* du tableau de bord : activé ou non, Premium seulement, taille maximale.

## Problème trouvé et corrigé au passage
**PDF en Word ne marchait plus sur le serveur**, y compris depuis l'application Android : LibreOffice refusait d'ouvrir les
PDF. C'est corrigé et vérifié.

## Vérifications faites
- Les 11 outils du navigateur ont été essayés un par un. Un défaut a été corrigé : en passant d'un outil à l'autre, le
  fichier de l'outil précédent restait affiché.
- Les outils du serveur ont été essayés directement sur le serveur :
  - un mauvais mot de passe est bien refusé ;
  - un PDF abîmé est reconstruit ;
  - un document scanné ressort avec un texte lisible.
- Les tests automatiques du serveur passent tous (47 sur 47).

## Ce qui reste à faire dans le plan
- **Étape 4** :
  - extraire les images ;
  - modifier (écrire n'importe où sur la page) ;
  - remplacer du texte ;
  - masquer une information ;
  - signature numérique et vérification ;
  - PDF en Excel.
- **Étape 5** :
  - dossier de candidature sous une taille maximale ;
  - modèles de documents administratifs ;
  - carte recto verso à ajouter dans l'application Android.
- **Étape 6 (IA)** : tout reste à faire.

## Une décision à prendre
L'étape 6 prévoit d'ajouter la mention **« Créé avec Pagio »** sur les documents des comptes gratuits. Je ne l'ai pas
activée sans votre accord, parce qu'elle s'imprime sur les documents de vos utilisateurs. Dites-moi si je la mets en place.

## Ce que vous seul pouvez faire
1. **Google Analytics** :
   - accepter les conditions (choisir Côte d'Ivoire) ;
   - créer un flux de données Web pour pagio.site ;
   - coller l'identifiant `G-…` dans le tableau de bord, *Pilotage*, champ Google Analytics.
2. **Firebase** : accepter les conditions. La suite servira aux notifications de l'application Admin (`com.pagio.admin`).
3. **Essayer l'APK 2.3.0 sur votre téléphone** (animation du logo, écrans de présentation, code promo, parrainage) :
   https://pagio.site/telecharger/pagio-2.3.0-essai.apk. Si tout va bien, je la publie.
4. **Search Console** : le plan du site affichait « Impossible de récupérer ». Le fichier est valide : revérifiez dans
   la journée.
5. **Hostinger (A8)** : paiement à faire avant le 20/12.
6. Le premier **rapport hebdomadaire** par e-mail partira tout seul lundi matin.

## Mise à jour du matin (configuration Google, compte kodybusinessci)
- **Google Analytics** : propriété « Pagio » (Côte d'Ivoire, franc CFA), flux Web pagio.site, ID **G-87ZZEEXYD5**,
  enregistré dans les réglages de Pagio : le bandeau de consentement s'affiche sur le site.
  Un compte Analytics « KODY BUSINESS » inutile a aussi été créé sur le compte koffi : il peut être supprimé.
- **Firebase** : ajouté au projet Google Cloud « Pagio » (`pagio-515720`, formule gratuite Spark) ; application Android
  `com.pagio.admin` (« Pagio Admin ») enregistrée. Le fichier google-services.json sera récupéré au moment de coder
  les notifications.
- **Search Console** : le plan du site est lu correctement (« Opération effectuée », 87 pages) ; renvoyé ce matin.
