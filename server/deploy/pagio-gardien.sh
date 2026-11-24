#!/usr/bin/env bash
# Gardien de Pagio, lancé chaque minute par cron sur le VPS (/etc/cron.d/pagio-gardien), HORS du conteneur :
#   - vérifie que Pagio répond (directement et par l'adresse publique) ;
#   - après 3 échecs de suite, redémarre le conteneur (au plus une fois par 10 minutes) ;
#   - note chaque panne (début, fin, durée, redémarrage) dans data/gardien/incidents.jsonl, lu par le tableau de bord ;
#   - relève chaque heure la date d'expiration des certificats HTTPS (data/gardien/certificats.json) ;
#   - relève chaque minute les mesures de la machine et de Pagio (data/gardien/mesures.jsonl, 30 jours gardés) ;
#   - vérifie toutes les 5 minutes que les autres sites du VPS répondent (data/gardien/sites.json), sans rien y modifier.
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

# Certificats HTTPS, une fois par heure : tous les certificats du VPS (lecture seule).
if [ ! -f "$DIR/certificats.json" ] || [ $((now - $(stat -c %Y "$DIR/certificats.json"))) -ge 3600 ]; then
  out="["; sep=""
  for f in /etc/letsencrypt/live/*/cert.pem; do
    [ -f "$f" ] || continue
    d=$(basename "$(dirname "$f")")
    fin=$(date -d "$(openssl x509 -enddate -noout -in "$f" | cut -d= -f2)" +%s)
    noms=$(openssl x509 -noout -ext subjectAltName -in "$f" 2>/dev/null | grep -o 'DNS:[^,]*' | cut -d: -f2 | tr '\n' ' ' | sed 's/ $//')
    out="$out$sep{\"domaine\":\"$d\",\"noms\":\"$noms\",\"expire\":$fin}"; sep=","
  done
  echo "$out]" > "$DIR/certificats.json"
fi

# ---------------------------------------------------------------- Mesures de la minute
# Processeur : part du temps occupé depuis la mesure précédente (/proc/stat).
read -r _ u n s i w q sq st _ < /proc/stat
tot=$((u + n + s + i + w + q + sq + st)); idle=$((i + w))
cpu=0
if [ -f "$DIR/cpu.prec" ]; then
  read -r ptot pidle < "$DIR/cpu.prec"
  dt=$((tot - ptot)); di=$((idle - pidle))
  [ "$dt" -gt 0 ] && cpu=$(( (100 * (dt - di)) / dt ))
fi
echo "$tot $idle" > "$DIR/cpu.prec"
charge=$(cut -d' ' -f1 /proc/loadavg)
# Mémoire et échange (Mo).
mem_total=$(awk '/^MemTotal:/{print int($2/1024)}' /proc/meminfo)
mem_dispo=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo)
swap_total=$(awk '/^SwapTotal:/{print int($2/1024)}' /proc/meminfo)
swap_libre=$(awk '/^SwapFree:/{print int($2/1024)}' /proc/meminfo)
# Disque racine (Mo).
read -r disque_total disque_utilise < <(df -Pm / | awk 'NR==2{print $2, $3}')
# Réseau : octets reçus et envoyés sur la carte principale depuis la mesure précédente.
carte=$(ip route show default 2>/dev/null | awk '{print $5; exit}'); carte=${carte:-eth0}
read -r rx tx < <(awk -v c="$carte:" '$1==c{print $2, $10}' /proc/net/dev)
rx=${rx:-0}; tx=${tx:-0}; drx=0; dtx=0
if [ -f "$DIR/reseau.prec" ]; then
  read -r prx ptx < "$DIR/reseau.prec"
  [ "$rx" -ge "$prx" ] && drx=$((rx - prx)); [ "$tx" -ge "$ptx" ] && dtx=$((tx - ptx))
fi
echo "$rx $tx" > "$DIR/reseau.prec"
# Conteneur Pagio : mémoire utilisée et limite (Mo), redémarrages.
read -r pagio_mem pagio_limite < <(docker stats --no-stream --format '{{.MemUsage}}' pagio 2>/dev/null | awk -F' / ' '
  function mo(v) { n = v + 0; if (v ~ /GiB/) return int(n * 1024); if (v ~ /KiB/) return int(n / 1024); if (v ~ /MiB/) return int(n); return int(n / 1048576) }
  { print mo($1), mo($2) }')
pagio_mem=${pagio_mem:-0}; pagio_limite=${pagio_limite:-0}
redemarrages=$(docker inspect pagio --format '{{.RestartCount}}' 2>/dev/null || echo 0)
# Base de données et sauvegardes (Mo).
base=$(du -cm /var/www/pagio/data/pagio.db* 2>/dev/null | awk 'END{print $1+0}')
sauvegardes=$(du -sm /var/www/pagio/data/backups 2>/dev/null | awk '{print $1+0}')
# Requêtes de la minute écoulée sur pagio.site (journal Nginx, sans les vérifications /api/health) :
# nombre, erreurs 4xx et 5xx, temps de réponse moyen et 95e centile (ms).
minute=$(date -u -d '1 minute ago' +%Y-%m-%dT%H:%M)
read -r req r4 r5 tmoy t95 < <(tail -n 20000 /var/log/nginx/pagio-chrono.log 2>/dev/null | grep "^$minute" | grep -v '/api/health' | awk '
  { st = $6 + 0; n++; if (st >= 400 && st < 500) e4++; if (st >= 500) e5++
    for (k = 1; k <= NF; k++) if ($k ~ /^total=/) { v = substr($k, 7) * 1000; t[n] = v; s += v } }
  END { if (!n) { print 0, 0, 0, 0, 0; exit }
    m = n; for (a = 1; a <= m; a++) for (b = a + 1; b <= m; b++) if (t[b] < t[a]) { x = t[a]; t[a] = t[b]; t[b] = x }
    p = int(0.95 * m); if (p < 1) p = 1
    printf "%d %d %d %d %d\n", n, e4, e5, s / n, t[p] }')
printf '{"t":%s,"cpu":%s,"charge":%s,"mem_total":%s,"mem_dispo":%s,"swap_total":%s,"swap_libre":%s,"disque_total":%s,"disque_utilise":%s,"rx":%s,"tx":%s,"pagio_mem":%s,"pagio_limite":%s,"redemarrages":%s,"base":%s,"sauvegardes":%s,"req":%s,"r4xx":%s,"r5xx":%s,"tmoy":%s,"t95":%s,"ok":%s}\n' \
  "$now" "$cpu" "$charge" "$mem_total" "$mem_dispo" "$swap_total" "$swap_libre" "${disque_total:-0}" "${disque_utilise:-0}" "$drx" "$dtx" \
  "$pagio_mem" "$pagio_limite" "${redemarrages:-0}" "${base:-0}" "${sauvegardes:-0}" "${req:-0}" "${r4:-0}" "${r5:-0}" "${tmoy:-0}" "${t95:-0}" \
  "$( [ $ok_local = 1 ] && [ $ok_public = 1 ] && echo 1 || echo 0 )" >> "$DIR/mesures.jsonl"
# 30 jours gardés (une mesure par minute) : nettoyage une fois par heure.
if [ "$(date +%M)" = "07" ] && [ "$(wc -l < "$DIR/mesures.jsonl")" -gt 43500 ]; then
  tail -43200 "$DIR/mesures.jsonl" > "$DIR/mesures.tmp" && mv "$DIR/mesures.tmp" "$DIR/mesures.jsonl"
fi

# ---------------------------------------------------------------- Autres sites du VPS, toutes les 5 minutes
# Liste des adresses servies par Nginx (relue une fois par jour), puis une visite de la page d'accueil de chacune,
# en parallèle (8 secondes au plus). Lecture seule : aucun site n'est modifié. admin.pagio.site est exclu : il exige le
# certificat d'appareil (Pagio est déjà vérifié plus haut).
if [ $(( $(date +%M) % 5 )) = 0 ]; then
  if [ ! -f "$DIR/sites.liste" ] || [ $((now - $(stat -c %Y "$DIR/sites.liste"))) -ge 86400 ]; then
    nginx -T 2>/dev/null | grep -oE '^\s*server_name[^;]+' | sed 's/^\s*server_name\s*//' | tr ' ' '\n' \
      | grep -E '^[a-z0-9.-]+\.[a-z]+$' | grep -v '^www\.' | grep -v '^admin\.pagio\.site$' | sort -u > "$DIR/sites.liste"
  fi
  tmp=$(mktemp -d)
  while read -r d; do
    [ -n "$d" ] || continue
    ( curl -s -o /dev/null -m 8 -w '%{http_code} %{time_total}' "https://$d/" > "$tmp/$d" 2>/dev/null || echo "000 0" > "$tmp/$d" ) &
  done < "$DIR/sites.liste"
  wait
  out="["; sep=""
  while read -r d; do
    [ -f "$tmp/$d" ] || continue
    read -r code temps < "$tmp/$d"
    code=$((10#${code:-0}))  # « 000 » (site injoignable) → 0
    out="$out$sep{\"domaine\":\"$d\",\"code\":${code:-0},\"ms\":$(awk -v t="${temps:-0}" 'BEGIN{print int(t * 1000)}'),\"verifie\":$now}"; sep=","
  done < "$DIR/sites.liste"
  echo "$out]" > "$DIR/sites.json"
  rm -rf "$tmp"
fi
