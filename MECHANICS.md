# Fiche des règles relevées dans iLovePDF 4.2.3 et choix de Pagio

Sources : bytecode de `base.apk` (classe `com.android.ilovepdf.presentation.tools.Tools` et ses 27 sous-classes,
`classes14.dex`, constructeurs `<init>` : `Tools(internalName, offlineSupport, isPremium)`), textes `split_config.fr.apk`,
manifeste. Aucune valeur n'a été copiée dans le code : Pagio applique ses propres règles, pilotables depuis le tableau de bord.

| Règle | Valeur dans iLovePDF | Source | Pagio |
|---|---|---|---|
| Nombre d'outils | 27 | sous-classes `Tools$*` | 40 |
| Outils traités sur l'appareil | 7 : merge, split, rotate, protect, repair, imagePdf, ocr (texte) | `Tools$Merge.<init>` etc. : `Boolean.valueOf(true)` | 40 (tous) ; serveur seulement en option haute fidélité |
| Outils premium codés en dur | ocrpdf | `Tools$OcrPdf.<init>` : `isPremium = 1` | aucun par défaut ; réglable par outil |
| Limites gratuites | fichiers, Mo, expiration par outil, reçues du serveur | `ToolLimitsDBModel(tool, files, mb, expiration)` | quotas par offre et par outil (tableau de bord) ; 0 = illimité |
| Tâches gratuites par jour | affichées « %1$d sur %2$d », valeur fournie par le serveur | chaîne `free_task_info_2` | réglable (`daily_tasks`), 0 par défaut — **valeur d'iLovePDF inconnue** |
| Niveaux de compression | 3 : hyper / recommandée / faible | chaînes `extreme_compression`, `recommended_compression`, `low_compression` | 3 : extrême (1000 px, JPEG 40 %), recommandée (1600 px, 65 %), légère (2400 px, 85 %) |
| Langues OCR simultanées | 3 maximum | chaîne `max_ocr_languages_alert` | détection automatique, sans choix manuel |
| Favoris | limite « %d » | chaîne `favorite_tool_selector_warning` | 8 favoris |
| Corbeille | purge après 30 jours | chaîne `bin_sub_header` | pas de corbeille ; historique + suppression explicite |
| Essai Premium | 7 jours | chaîne `first_7_days_free` | à définir dans Google Play (voir `docs/COMMERCIAL.md`) |
| Android minimum | API 32 (Android 12) | manifeste `minSdk` | API 26 (Android 8.0) |
