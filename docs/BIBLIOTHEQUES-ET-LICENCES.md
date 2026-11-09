# Bibliothèques utilisées, licences et contraintes commerciales

Aucune bibliothèque sous licence contaminante (GPL/AGPL) n'est intégrée à l'application : vous pouvez la vendre
et garder votre code fermé. Conservez simplement les mentions de licence (écran *À propos › Bibliothèques et licences*).

## Application Android

| Bibliothèque | Rôle | Licence | Contraintes commerciales |
|---|---|---|---|
| Kotlin, kotlinx.coroutines | Langage, tâches de fond | Apache 2.0 | Aucune (mention) |
| AndroidX Core, Activity, Lifecycle, Navigation, DataStore | Socle Android | Apache 2.0 | Aucune |
| Jetpack Compose, Material 3, Material Icons | Interface | Apache 2.0 | Aucune |
| PdfBox-Android 2.0.27 (portage d'Apache PDFBox) | Lecture/écriture PDF | Apache 2.0 | Aucune (mention + NOTICE) |
| Bouncy Castle (bcprov/bcpkix 1.78) | Signature numérique, certificats | MIT | Aucune |
| Google ML Kit : reconnaissance de texte, identification de langue, traduction | OCR, langue, traduction sur l'appareil | Conditions d'utilisation ML Kit (gratuit) | Gratuit, usage commercial permis ; respecter les conditions Google, mentionner l'usage dans la politique de confidentialité |
| Google Play services ML Kit Document Scanner | Scanner avec détection des bords | Conditions Google APIs | Nécessite les services Google Play sur le téléphone (repli automatique : appareil photo simple) |
| Reorderable (sh.calvin) | Glisser-déposer des pages | Apache 2.0 | Aucune |
| Android PdfRenderer, WebView, Keystore | Rendu, HTML→PDF, secrets | Intégré à Android | Aucune |

## Serveur et tableau de bord

| Bibliothèque | Rôle | Licence | Contraintes |
|---|---|---|---|
| Node.js (dont `node:sqlite`) | Exécution, base de données | MIT (+ SQLite domaine public) | Aucune |
| Express 4 | Serveur HTTP | MIT | Aucune |
| React 18, React DOM | Tableau de bord | MIT | Aucune |
| Vite, TypeScript, @vitejs/plugin-react | Construction | MIT / Apache 2.0 | Outils de développement uniquement |
| LibreOffice (programme externe, non intégré) | Conversions haute fidélité | MPL 2.0 | Utilisé comme programme séparé : aucune obligation sur votre code ; ne modifiez pas LibreOffice sans publier vos modifications |

## Services externes facultatifs (payants à l'usage)

| Service | Utilisation | Coût indicatif |
|---|---|---|
| OpenAI / Anthropic / Google Gemini / Mistral / Groq | IA générative (résumé, conversation, traduction, reformulation) | Facturation au volume de texte, chez le fournisseur |
| Ollama (auto-hébergé) | IA générative gratuite sur votre propre serveur | Coût du serveur (GPU conseillé) |
| Google Play Console | Publication | 25 $ une fois |

## Ce qui n'est PAS utilisé (et pourquoi)

- **MuPDF** : excellent mais AGPL (ou licence commerciale payante) → remplacé par PdfBox-Android + PdfRenderer.
- **PSPDFKit / Nutrient** (utilisé par iLovePDF) : licence commerciale coûteuse.
- **Tesseract** : Apache 2.0 mais plus lent et plus lourd sur mobile que ML Kit ; possible en complément pour des alphabets non latins.
- **Apache POI** : trop lourd pour Android ; les formats DOCX/XLSX/PPTX sont écrits et lus par un moteur maison.
