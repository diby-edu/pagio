#!/usr/bin/env bash
# Publie une nouvelle version de l'application sur https://pagio.site (bouton « Fichier APK »).
# À lancer depuis Git Bash, dans le dossier android/, après avoir augmenté versionName dans app/build.gradle.kts :
#   ./publier-apk.sh
# Étapes : construction signée (clé existante) → copie dans apk/ → envoi sur le VPS → le bouton du site pointe
# aussitôt sur cette version (pagio.apk) et affiche son numéro (version.json). Les anciennes versions restent sur le serveur.
set -euo pipefail
cd "$(dirname "$0")"
VPS=root@72.62.148.170
DOSSIER=/var/www/pagio/site/telecharger
SERVEUR=https://pagio.site

VERSION=$(sed -n 's/.*versionName = "\([0-9]*\.[0-9]*\.[0-9]*\)".*/\1/p' app/build.gradle.kts | head -1)
[ -n "$VERSION" ] || { echo "versionName introuvable dans app/build.gradle.kts" >&2; exit 1; }
IFS=. read -r MAJ MIN COR <<< "$VERSION"
CODE=$((MAJ * 10000 + MIN * 100 + COR))
APK="apk/pagio-$VERSION.apk"
[ -f keystore.properties ] || { echo "keystore.properties absent : impossible de signer" >&2; exit 1; }

echo "== Construction de Pagio $VERSION (code $CODE) pour $SERVEUR"
./gradlew.bat assembleRelease bundleRelease -Ppagio.serverUrl="$SERVEUR" --console=plain > "build-$VERSION.log" 2>&1 \
  || { tail -30 "build-$VERSION.log"; echo "Échec de la construction (journal : build-$VERSION.log)" >&2; exit 1; }
cp app/build/outputs/apk/release/app-release.apk "$APK"
cp app/build/outputs/bundle/release/app-release.aab "apk/pagio-$VERSION.aab"

SHA=$(sha256sum "$APK" | cut -d' ' -f1)
OCTETS=$(stat -c %s "$APK")
MO=$(( (OCTETS + 524288) / 1048576 ))
echo "== Envoi de $APK ($MO Mo) vers le serveur"
scp -o ServerAliveInterval=10 "$APK" "$VPS:$DOSSIER/pagio-$VERSION.apk.part"
ssh -o ServerAliveInterval=10 "$VPS" "set -e; cd $DOSSIER
  mv pagio-$VERSION.apk.part pagio-$VERSION.apk
  [ \"\$(sha256sum pagio-$VERSION.apk | cut -d' ' -f1)\" = $SHA ] || { echo 'Fichier abîmé pendant l envoi' >&2; exit 1; }
  ln -sfn pagio-$VERSION.apk pagio.apk.new && mv -T pagio.apk.new pagio.apk
  printf '{\"version\":\"%s\",\"code\":%s,\"taille_mo\":%s,\"sha256\":\"%s\",\"date\":\"%s\"}\n' $VERSION $CODE $MO $SHA \$(date +%F) > version.json.new
  mv version.json.new version.json
  ls -la"
echo "== Vérification"
curl -s "$SERVEUR/telecharger/version.json"; echo
echo
echo "Publié : $SERVEUR/telecharger/pagio.apk → Pagio $VERSION"
echo "Dans le tableau de bord (Pilotage de l'application › Versions) : dernière version = $VERSION,"
echo "lien de mise à jour = $SERVEUR/telecharger/pagio.apk (une seule fois). Version minimale obligatoire = $CODE seulement si"
echo "les anciennes versions doivent être bloquées."
