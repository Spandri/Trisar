#!/bin/bash
# OBD-Tracker im Betrieb umstellen (laeuft vom eigenen Mac, Befehl geht ueber das Gateway auf dem 2018).
#
#   bash werkzeuge/tracker-befehl.sh <Nr> sparsam|mittel|fein   Punkte bei Fahrt einstellen
#   bash werkzeuge/tracker-befehl.sh <Nr> status                aktuelle Werte + GPS-Zustand
#   bash werkzeuge/tracker-befehl.sh <Nr> "getparam 1000"       beliebiger Teltonika-Befehl
#
# Stufen (Punkt bei Fahrt alle X s, bei Y Grad Richtungswechsel, nach Z m Strecke):
#   sparsam  60 s / 30 Grad / aus     ca. 4 MB/Monat bei 8 h Fahrt am Tag
#   mittel   30 s / 15 Grad / 200 m   ca. doppelt so viel
#   fein     10 s / 10 Grad / 100 m   wie das alte Nr. 1, ca. 6 MB/Monat und mehr
# Gilt fuer Heimnetz, Roaming und unbekanntes Netz (1NCE ist immer Roaming).
#
# Ist der Tracker gerade nicht verbunden (Zuendung aus), wartet der Befehl im Gateway,
# bis er sich meldet. Ein Neustart des Gateways loescht diese Warteschlange.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
GW=fahrer-app-lokal-teltonika-gateway-1

NR="${1:-}"; WAS="${2:-}"
if [[ ! "$NR" =~ ^[0-9]+$ || -z "$WAS" ]]; then
  sed -n 4,6p "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi

IMEI=$(ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select imei from public.obd_tracker where nummer=$NR\"")
[[ -n "$IMEI" ]] || { echo "Tracker Nr. $NR gibt es nicht in obd_tracker."; exit 1; }

stufe() { # periode winkel strecke
  local s=""
  for basis in 10050 10150 10250; do
    s+="$basis:$1;$((basis + 2)):$2;$((basis + 1)):$3;"
  done
  echo "setparam ${s%;}"
}

case "$WAS" in
  sparsam) BEFEHLE=("$(stufe 60 30 0)") ;;
  mittel)  BEFEHLE=("$(stufe 30 15 200)") ;;
  fein)    BEFEHLE=("$(stufe 10 10 100)") ;;
  status)  BEFEHLE=("getparam 10050;10052;10051;10055;1000;901;138;105" "getinfo") ;;
  *)       BEFEHLE=("$WAS") ;;
esac

START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
VERBUNDEN=true
for b in "${BEFEHLE[@]}"; do
  antwort=$(ssh "$SERVER" "curl -s -X POST http://127.0.0.1:8788/command -H 'content-type: application/json' -d '{\"imei\":\"$IMEI\",\"command\":\"$b\"}'")
  echo "$antwort" | grep -q '"connected":true' || VERBUNDEN=false
done

if ! $VERBUNDEN; then
  echo "Nr. $NR ist gerade nicht verbunden. Befehl wartet im Gateway, bis er sich meldet (Zuendung an)."
  exit 0
fi

for _ in $(seq 1 10); do
  sleep 3
  n=$(ssh "$SERVER" "$DOCKER logs --since $START $GW 2>&1 | grep '\"imei\":\"$IMEI\"' | grep -c codec12_response" || true)
  [[ "$n" -ge "${#BEFEHLE[@]}" ]] && break
done
ssh "$SERVER" "$DOCKER logs --since $START $GW 2>&1 | grep '\"imei\":\"$IMEI\"' | grep codec12_response" \
  | sed -E 's/.*"response":"([^"]*)".*/  \1/'
echo "Nr. $NR: fertig."
