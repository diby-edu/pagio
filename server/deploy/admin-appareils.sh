#!/bin/sh
# Appareils autorisés à afficher le tableau de bord (admin.pagio.site) : certificats clients signés par une autorité
# privée Pagio. Nginx refuse toute connexion sans certificat valide ET présent dans la liste des appareils.
# À lancer en root sur le VPS :
#   sh admin-appareils.sh nouveau pc-bureau     → crée /root/pagio-admin-ca/appareils/pc-bureau.p12 (+ .code)
#   sh admin-appareils.sh liste
#   sh admin-appareils.sh retirer pc-bureau     → l'appareil est refusé immédiatement
set -eu
CA=/root/pagio-admin-ca
LISTE=/etc/nginx/pagio-admin-appareils.conf
umask 077
mkdir -p "$CA/appareils"

if [ ! -f "$CA/ca.key" ]; then
  openssl ecparam -name prime256v1 -genkey -noout -out "$CA/ca.key"
  openssl req -x509 -new -key "$CA/ca.key" -sha256 -days 3650 -subj "/O=Pagio/CN=Pagio administration (autorite privee)" -out "$CA/ca.crt"
  install -m 644 "$CA/ca.crt" /etc/nginx/pagio-admin-ca.crt
  echo "Autorité créée : $CA (gardez une copie de ca.key et ca.crt hors du serveur)"
fi
[ -f "$LISTE" ] || { echo "# Appareils autorisés (numéro de série du certificat → 1). Géré par admin-appareils.sh." > "$LISTE"; chmod 644 "$LISTE"; }

recharger() { nginx -t >/dev/null 2>&1 && systemctl reload nginx || { echo "Configuration Nginx invalide, rien n'est rechargé" >&2; exit 1; }; }

case "${1:-}" in
  nouveau)
    NOM=$(printf '%s' "${2:?nom de l appareil}" | tr -cd 'a-zA-Z0-9-')
    [ ! -f "$CA/appareils/$NOM.crt" ] || { echo "L'appareil $NOM existe déjà" >&2; exit 1; }
    openssl ecparam -name prime256v1 -genkey -noout -out "$CA/appareils/$NOM.key"
    openssl req -new -key "$CA/appareils/$NOM.key" -subj "/O=Pagio/CN=$NOM" -out "$CA/appareils/$NOM.csr"
    printf 'extendedKeyUsage=clientAuth\nkeyUsage=digitalSignature\n' > "$CA/appareils/$NOM.ext"
    openssl x509 -req -in "$CA/appareils/$NOM.csr" -CA "$CA/ca.crt" -CAkey "$CA/ca.key" -CAcreateserial -days 825 -sha256 \
      -extfile "$CA/appareils/$NOM.ext" -out "$CA/appareils/$NOM.crt" 2>/dev/null
    CODE=$(openssl rand -base64 18 | tr -dc 'A-HJ-NP-Za-km-z2-9' | cut -c1-12)
    printf '%s\n' "$CODE" > "$CA/appareils/$NOM.code"
    # Chiffrement « ancien » (3DES) : seul format accepté par toutes les versions de Windows et d'Android.
    openssl pkcs12 -export -inkey "$CA/appareils/$NOM.key" -in "$CA/appareils/$NOM.crt" -certfile "$CA/ca.crt" \
      -name "Pagio admin - $NOM" -passout "pass:$CODE" -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1 \
      -out "$CA/appareils/$NOM.p12"
    rm -f "$CA/appareils/$NOM.csr" "$CA/appareils/$NOM.ext"
    # Nginx compare le numéro de série en hexadécimal MAJUSCULE (variable $ssl_client_serial).
    SERIE=$(openssl x509 -in "$CA/appareils/$NOM.crt" -noout -serial | cut -d= -f2 | tr 'a-f' 'A-F')
    echo "\"$SERIE\" 1; # $NOM $(date +%F)" >> "$LISTE"
    recharger
    echo "Appareil $NOM autorisé : $CA/appareils/$NOM.p12 (code dans $NOM.code)"
    ;;
  retirer)
    NOM=$(printf '%s' "${2:?nom de l appareil}" | tr -cd 'a-zA-Z0-9-')
    grep -q "# $NOM " "$LISTE" || { echo "Appareil $NOM inconnu" >&2; exit 1; }
    sed -i "/# $NOM /d" "$LISTE"
    recharger
    echo "Appareil $NOM retiré : il ne peut plus afficher le tableau de bord"
    ;;
  liste)
    grep -v '^#' "$LISTE" | sed 's/^"\([^"]*\)" 1; # /\1  /' || true
    ;;
  *) echo "Usage : $0 nouveau <nom> | retirer <nom> | liste" >&2; exit 1 ;;
esac
