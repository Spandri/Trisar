#!/bin/bash
# Schadensbericht fuer die Dispo ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/schaden-ausrollen.sh
#
# 1. Migrationen: reported_by (wer hat gemeldet) und stelle (genauer Punkt auf dem Auto)
# 2. Web-Dispo: Schadensbericht auf "Fahrzeug bearbeiten" (FahrzeugErstellenView.jsx)
# 3. Web-Fahrer: Fotos und genaue Stelle speichern, Skizze im Schadensbericht
#    (SchadenMelden.jsx, VehicleView.jsx, FahrerApp.jsx, Uebersetzungen)
# Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONEN="20261106020000_schaden_fahrer 20261106030000_schaden_stelle"

echo "1/3 Migrationen"
for m in $MIGRATIONEN; do
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

echo "2/3 Web-Dispo"
kopieren admin src/components/views/FahrzeugErstellenView.jsx fahrer-app-lokal-admin-1
echo "3/3 Web-Fahrer"
for f in src/features/fahrer/views/SchadenMelden.jsx src/features/fahrer/views/VehicleView.jsx \
         src/features/fahrer/FahrerApp.jsx src/i18n/de.js src/i18n/en.js src/i18n/es.js \
         src/i18n/fr.js src/i18n/it.js src/i18n/tr.js; do
  kopieren fahrer "$f" fahrer-app-lokal-fahrer-1
done

ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select count(*) || ' Schaden/Schaeden, ' || count(reported_by) || ' mit Fahrer, ' || count(stelle) || ' mit Stelle' from public.vehicle_damages\""
echo "Fertig."
