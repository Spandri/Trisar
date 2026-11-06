#!/bin/bash
# Tracker-Nummern ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/tracker-ausrollen.sh
#
# 1. Migration 20261106100000_obd_tracker_nummern (Tabelle obd_tracker, Nr. 1 bis 3)
# 2. Web-Dispo: Fahrer bearbeiten zeigt "Nr. X" im IMEI-Feld und in der Tracker-Liste
# Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/2 Migration"
for m in 20261106100000_obd_tracker_nummern; do
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

kopieren() { # app datei container
  local app="$1" datei="$2" container="$3"
  for ziel in "$R/fahrer-app-lokal/.docker-sync/$app/$datei" "$R/trisar/$app/$datei"; do
    scp -q "$HIER/$app/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec $container touch /app/$datei"
}

echo "2/2 Web-Dispo"
kopieren admin src/components/views/FahrerErstellenView.jsx fahrer-app-lokal-admin-1

ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 'Tracker: ' || string_agg('Nr. ' || nummer || ' ' || imei, ', ' order by nummer) from public.obd_tracker\""
echo "Fertig."
