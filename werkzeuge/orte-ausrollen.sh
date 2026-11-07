#!/bin/bash
# Eigene Orte mit Radien ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/orte-ausrollen.sh
#
# 1. Migration 20261107090000_orte_radien (Tabellen orte/orte_standard, jobs.*_ort_id, Statusregel)
# 2. Web-Dispo: Karten Filter "Orte", Karte mit Kreisen, Vorschlaege bei Fahrt erstellen
# 3. Web-Fahrer: Ortsname + Icon, Google Maps mit Adresse
# iOS und Android brauchen neue Builds. Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/3 Migration"
for m in 20261107090000_orte_radien; do
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
ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"notify pgrst, 'reload schema'\"" >/dev/null

kopieren() { # app datei container
  local app="$1" datei="$2" container="$3"
  for ziel in "$R/fahrer-app-lokal/.docker-sync/$app/$datei" "$R/trisar/$app/$datei"; do
    ssh "$SERVER" "mkdir -p \"\$(dirname '$ziel')\""
    scp -q "$HIER/$app/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec $container touch /app/$datei" 2>/dev/null || true
}

echo "2/3 Web-Dispo"
for d in src/App.jsx src/components/views/FahrtAdd.jsx src/components/views/FahrtBearbeitenView.jsx \
         src/components/views/KartenFilterView.jsx src/components/views/KartenView.jsx \
         src/components/views/OrtBearbeitenView.jsx src/components/ui/OrtVorschlag.jsx \
         src/shared/orte.js src/shared/karte/ortKreise.js \
         src/i18n/de.js src/i18n/en.js src/i18n/es.js src/i18n/fr.js src/i18n/it.js src/i18n/tr.js; do
  kopieren admin "$d" fahrer-app-lokal-admin-1
done

echo "3/3 Web-Fahrer"
for d in src/features/fahrer/FahrerApp.jsx src/features/fahrer/views/FahrtenScreen01View.jsx \
         src/features/fahrer/views/KoloneFlughafen.jsx src/features/fahrer/views/KoloneNormal.jsx \
         src/features/fahrer/views/SoloFlughafen.jsx src/features/fahrer/views/SoloNormal.jsx \
         src/shared/utils/navigation.js src/shared/orte.js; do
  kopieren fahrer "$d" fahrer-app-lokal-fahrer-1
done

ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 'Standard: rein ' || radius_rein_m || ' m, raus ' || radius_raus_m || ' m, Orte: ' || (select count(*) from public.orte) from public.orte_standard\""
echo "Fertig. Dispo neu laden, dann Karten Filter -> Orte."
