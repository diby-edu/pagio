#!/usr/bin/env bash
# Gardien de Pagio, lancé chaque minute par cron sur le VPS (/etc/cron.d/pagio-gardien), HORS du conteneur :
#   - vérifie que Pagio répond (directement et par l'adresse publique) ;
#   - après 3 échecs de suite, redémarre le conteneur (au plus une fois par 10 minutes) ;
#   - note chaque panne (début, fin, durée, redémarrage) dans data/gardien/incidents.jsonl, lu par le tableau de bord ;
#   - relève chaque heure la date d'expiration des certificats HTTPS de Pagio (data/gardien/certificats.json).
# Ne touche à aucun autre site du VPS. Installation : voir docs/SERVEUR.md, « Gardien ».
set -u
DIR=/var/www/pagio/data/gardien
ETAT=$DIR/etat
mkdir -p "$DIR"
now=$(date +%s)

# État précédent : nombre d'échecs de suite, début de la panne en cours, dernier redémarrage.
echecs=0; debut=0; redem=0; redem_fait=0
[ -f "$ETAT" ] && . "$ETAT"

ok_local=0; ok_public=0
curl -fsS -m 10 -o /dev/null http://127.0.0.1:8787/api/health && ok_local=1
curl -fsS -m 15 -o /dev/null https://pagio.site/api/health && ok_public=1

if [ $ok_local = 1 ] && [ $ok_public = 1 ]; then
  if [ "$debut" -gt 0 ]; then
    cause=$( [ "$redem_fait" = 1 ] && echo "redemarrage" || echo "retour seul" )
    printf '{"debut":%s,"fin":%s,"duree_s":%s,"redemarre":%s,"cause":"%s"}\n' \
      "$debut" "$now" "$((now - debut))" "$( [ "$redem_fait" = 1 ] && echo true || echo false )" "$cause" >> "$DIR/incidents.jsonl"
  fi
  echecs=0; debut=0; redem_fait=0
else
  echecs=$((echecs + 1))
  [ "$debut" = 0 ] && debut=$now
  if [ $ok_local = 0 ] && [ $echecs -ge 3 ] && [ $((now - redem)) -ge 600 ]; then
    # Pagio ne répond plus : redémarrage du seul conteneur pagio.
    docker restart pagio >/dev/null 2>&1 && { redem=$now; redem_fait=1; }
    logger -t pagio-gardien "Pagio ne répondait plus depuis $echecs minutes : conteneur redémarré"
  elif [ $ok_local = 1 ] && [ $ok_public = 0 ] && [ $echecs -ge 3 ] && ! systemctl is-active --quiet nginx; then
    # Pagio répond mais Nginx est arrêté : on le relance (sans le redémarrer s'il tourne, pour ne gêner aucun site).
    systemctl start nginx && logger -t pagio-gardien "Nginx était arrêté : relancé"
  fi
fi
printf 'echecs=%s\ndebut=%s\nredem=%s\nredem_fait=%s\n' "$echecs" "$debut" "$redem" "$redem_fait" > "$ETAT"
echo "$now" > "$DIR/derniere-verification"

# Garde les 500 dernières pannes.
if [ -f "$DIR/incidents.jsonl" ] && [ "$(wc -l < "$DIR/incidents.jsonl")" -gt 500 ]; then
  tail -500 "$DIR/incidents.jsonl" > "$DIR/incidents.tmp" && mv "$DIR/incidents.tmp" "$DIR/incidents.jsonl"
fi

# Certificats HTTPS, une fois par heure.
if [ ! -f "$DIR/certificats.json" ] || [ $((now - $(stat -c %Y "$DIR/certificats.json"))) -ge 3600 ]; then
  out="["; sep=""
  for d in pagio.site admin.pagio.site pagio.hebergementci.com; do
    f=/etc/letsencrypt/live/$d/cert.pem
    [ -f "$f" ] || continue
    fin=$(date -d "$(openssl x509 -enddate -noout -in "$f" | cut -d= -f2)" +%s)
    noms=$(openssl x509 -noout -ext subjectAltName -in "$f" 2>/dev/null | grep -o 'DNS:[^,]*' | cut -d: -f2 | tr '\n' ' ' | sed 's/ $//')
    out="$out$sep{\"domaine\":\"$d\",\"noms\":\"$noms\",\"expire\":$fin}"; sep=","
  done
  echo "$out]" > "$DIR/certificats.json"
fi
