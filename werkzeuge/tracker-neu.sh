#!/bin/bash
# Neuen OBD-Tracker (FMC003) pruefen, Abweichungen korrigieren und mit naechster Nummer anmelden.
# Vorher: Datei TRISAR-FMC003-Standard.cfg im Configurator laden, "Save to device", Reboot,
# Tracker an 12 V (Zuendung an), damit er sich beim Gateway meldet.
#
#   bash werkzeuge/tracker-neu.sh <IMEI> [SIM-Endung, z. B. 825300]
#
# Ist der Tracker schon angemeldet, wird nur geprueft und seine Nummer genannt.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
GW=fahrer-app-lokal-teltonika-gateway-1

IMEI="${1:-}"; SIM="${2:-}"
[[ "$IMEI" =~ ^[0-9]{15}$ ]] || { sed -n 6p "$0" | sed 's/^# //'; exit 1; }
[[ -z "$SIM" || "$SIM" =~ ^[0-9]{4,20}$ ]] || { echo "SIM-Endung nur Ziffern."; exit 1; }

# Sollwerte (siehe werkzeuge/tracker-nummern.md). 4000 muss leer sein.
SOLL="107:1 101:4 105:11000 138:1 50000:2 901:24 1000:300 4000: 2004:obd.trisar.de 2005:5027 2006:0
10000:0 10005:0 10100:0 10105:0 10200:0 10205:0
10050:30 10052:15 10051:200 10055:120 10150:30 10152:15 10151:200 10155:120 10250:30 10252:15 10251:200 10255:120"

sql() { ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -v ON_ERROR_STOP=1 -c \"$1\""; }

# Befehl schicken und auf die Antwort warten. Gibt die Antwort aus.
befehl() {
  local start antwort
  start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  antwort=$(ssh "$SERVER" "curl -s -X POST http://127.0.0.1:8788/command -H 'content-type: application/json' -d '{\"imei\":\"$IMEI\",\"command\":\"$1\"}'")
  if ! echo "$antwort" | grep -q '"connected":true'; then
    echo "NICHT_VERBUNDEN"; return
  fi
  local id; id=$(echo "$antwort" | sed -E 's/.*"commandId":"([^"]*)".*/\1/')
  for _ in $(seq 1 15); do
    sleep 2
    r=$(ssh "$SERVER" "$DOCKER logs --since $start $GW 2>&1 | grep '\"commandId\":\"$id\"' | grep codec12_response" || true)
    if [[ -n "$r" ]]; then echo "$r" | sed -E 's/.*"response":"([^"]*)".*/\1/'; return; fi
  done
  echo "KEINE_ANTWORT"
}

# Ist-Werte holen (in Paketen, Antwort "Param ID:107 Value:1;101:4;...").
pruefen() {
  FALSCH=()
  local ids=() paar
  for paar in $SOLL; do ids+=("${paar%%:*}"); done
  local ist=""
  for ((i = 0; i < ${#ids[@]}; i += 10)); do
    local teil; teil=$(IFS=';'; echo "${ids[*]:i:10}")
    local r; r=$(befehl "getparam $teil")
    if [[ "$r" == NICHT_VERBUNDEN || "$r" == KEINE_ANTWORT ]]; then
      echo "Tracker $IMEI ist nicht mit dem Gateway verbunden. An 12 V? Configurator geschlossen?"; exit 1
    fi
    ist+="$(echo "$r" | sed -E 's/^Param ID:([0-9]+) Value:/\1:/');"
  done
  for paar in $SOLL; do
    local id="${paar%%:*}" soll="${paar#*:}"
    local wert; wert=$(echo ";$ist" | grep -oE ";$id:[^;]*" | head -1 | cut -d: -f2-)
    [[ "$wert" == "$soll" ]] || FALSCH+=("$id:$soll")
  done
}

echo "Pruefe $IMEI ..."
pruefen
if ((${#FALSCH[@]} > 0)); then
  echo "Abweichend, wird korrigiert: ${FALSCH[*]}"
  for ((i = 0; i < ${#FALSCH[@]}; i += 8)); do
    teil=$(IFS=';'; echo "${FALSCH[*]:i:8}")
    befehl "setparam $teil" >/dev/null
  done
  pruefen
  if ((${#FALSCH[@]} > 0)); then
    echo "FEHLER: noch abweichend nach Korrektur: ${FALSCH[*]}"; exit 1
  fi
fi
echo "Einstellungen OK."

NR=$(sql "select nummer from public.obd_tracker where imei='$IMEI'")
if [[ -z "$NR" ]]; then
  NR=$(sql "insert into public.obd_tracker (imei, nummer, modell, sim)
            select '$IMEI', coalesce(max(nummer), 0) + 1, 'FMC003', nullif('$SIM', '')
            from public.obd_tracker returning nummer" | head -1)
  echo "Neu angemeldet."
fi
GPS=$(befehl "getinfo" | grep -oE 'GPS:[0-9]+ SAT:[0-9]+' || true)
echo
echo "  ==>  Nr. $NR  (auf den Tracker schreiben)   ${GPS}"
echo "Danach in der Dispo einem Fahrer zuordnen. Eintrag in werkzeuge/tracker-nummern.md macht Claude."
