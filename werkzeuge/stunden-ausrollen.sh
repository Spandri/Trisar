#!/bin/bash
# Stundenerfassung und neuen Import-Stand ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/stunden-ausrollen.sh
# Vorher bash werkzeuge/fahrzeugseite-ausrollen.sh (bringt die Fahrzeugkarte, die die Startseite braucht).
#
# 1. Migrationen 20261106050000_push_aenderungen_fix, 20261106060000_stundenerfassung (Pausen am Dienst, Stundenzettel, Status-Protokoll,
#    Vorschlag und Verlauf, Mitteilungen) 20261106070000_stunden_runden und 20261106080000_stunden_runden_fahrer (halbe Stunden zugunsten des Fahrers)
# 2. Funktion dispo-admin (Import neu, Stunden-Export)
# 3. Web-Dispo: Import im TRISAR-Stil, Stunden beim Fahrer
# 4. Web-Fahrer: Stundenkarte am Ende des Diensttages (Ablehnen, Bearbeiten, Annehmen), Verlauf
# Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN="fahrer/supabase/functions/dispo-admin"

if ! cmp -s "$HIER/$FN/importKern.js" "$HIER/admin/src/services/importKern.js"; then
  echo "importKern.js weicht ab: $FN/importKern.js nach admin/src/services/ kopieren und neu starten."
  exit 1
fi
if ! ssh "$SERVER" "test -f $R/fahrer-app-lokal/.docker-sync/fahrer/src/shared/FahrzeugKarte.jsx"; then
  echo "Zuerst bash werkzeuge/fahrzeugseite-ausrollen.sh starten (Fahrzeugkarte fehlt live)."
  exit 1
fi

echo "1/4 Migrationen"
# Zuerst die Korrektur des Push-Triggers (Fahrt speichern schlug fehl), dann die Stundenerfassung.
for m in 20261106050000_push_aenderungen_fix 20261106060000_stundenerfassung 20261106070000_stunden_runden 20261106080000_stunden_runden_fahrer; do
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

echo "2/4 Funktion dispo-admin"
for datei in index.ts import.ts importKern.js stunden.ts; do
  for ziel in "$R/fahrer-app-lokal/supabase/functions/dispo-admin" "$R/trisar/$FN"; do
    scp -q "$HIER/$FN/$datei" "$SERVER:$ziel/$datei"
  done
done

kopieren() { # app datei container
  local app="$1" datei="$2" container="$3"
  for ziel in "$R/fahrer-app-lokal/.docker-sync/$app/$datei" "$R/trisar/$app/$datei"; do
    scp -q "$HIER/$app/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec $container touch /app/$datei"
}

echo "3/4 Web-Dispo"
for d in src/services/importKern.js src/services/importDienst.js src/i18n/de.js src/i18n/en.js \
         src/components/views/ImportView.jsx src/components/views/FahrerStunden.jsx src/components/views/FahrerErstellenView.jsx; do
  kopieren admin "$d" fahrer-app-lokal-admin-1
done

echo "4/4 Web-Fahrer"
# CancelRideSheet und Stunden.jsx zuerst, die anderen Dateien importieren sie.
for d in src/features/fahrer/views/CancelRideSheet.jsx src/features/fahrer/views/Stunden.jsx src/features/fahrer/views/Verlauf.jsx \
         src/features/fahrer/views/FahrtenScreen01View.jsx src/components/KeineFahrtTrisar.jsx; do
  kopieren fahrer "$d" fahrer-app-lokal-fahrer-1
done

ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 'Tabellen: ' || count(*) from information_schema.tables where table_schema='public' and table_name in ('stundenzettel','dienst_pausen')\""
echo "Fertig."
