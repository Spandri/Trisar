#!/bin/bash
# Punkte bei Fahrt (sparsam / mittel / fein) ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/stufe-ausrollen.sh
#
# 1. Migration: obd_tracker.stufe + Quittung, Warteschlange obd_tracker_befehl
# 2. Gateway: arbeitet die Warteschlange aus der DB ab (ueberlebt Neustarts) und quittiert
# 3. Web-Dispo: Karten Filter zeigt die Auswahl und die Quittung je Tracker
# iOS und Android brauchen einen neuen Build (Karten Filter).
# Mehrfach ausfuehren schadet nicht. Achtung: Schritt 2 kopiert den ganzen Working-Copy-Stand
# des Gateways, also auch noch nicht ausgerollte Aenderungen anderer Sitzungen.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
GW=fahrer-app-lokal-teltonika-gateway-1
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/3 Migration"
for m in 20261107060000_tracker_stufe; do
  v=${m%%_*}; n=${m#*_}
  if ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 1 from supabase_migrations.schema_migrations where version='$v'\"" | grep -q 1; then
    echo "   $m schon eingespielt"
    continue
  fi
  {
    echo "begin;"
    cat "$HIER/fahrer/supabase/migrations/$m.sql"
    echo "insert into supabase_migrations.schema_migrations (version, name) values ('$v', '$n') on conflict do nothing;"
    echo "commit;"
  } | ssh "$SERVER" "$DOCKER exec -i $DB psql -U postgres -v ON_ERROR_STOP=1 -q" 2>&1 | grep -v '^NOTICE' || true
  echo "   $m eingespielt"
done
# PostgREST soll die neuen Spalten sofort kennen.
ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"notify pgrst, 'reload schema'\"" >/dev/null

echo "2/3 Gateway"
bash "$HIER/werkzeuge/gateway-ausrollen.sh"

kopieren() { # app datei container
  local app="$1" datei="$2" container="$3"
  for ziel in "$R/fahrer-app-lokal/.docker-sync/$app/$datei" "$R/trisar/$app/$datei"; do
    scp -q "$HIER/$app/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec $container touch /app/$datei"
}

echo "3/3 Web-Dispo"
for d in src/i18n/de.js src/i18n/en.js src/i18n/es.js src/i18n/fr.js src/i18n/it.js src/i18n/tr.js \
         src/components/views/KartenFilterView.jsx; do
  kopieren admin "$d" fahrer-app-lokal-admin-1
done

sleep 3
ssh "$SERVER" "$DOCKER logs --since 30s $GW 2>&1 | grep -E 'command_table_unavailable|db_command' | tail -n 3" || true
ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 'Nr. ' || nummer || ': ' || stufe || ' (' || coalesce(stufe_status, 'unbekannt') || ')' from public.obd_tracker order by nummer\""
echo "Fertig. Stufe im Karten Filter waehlen, der Tracker uebernimmt sie beim naechsten Verbinden."
