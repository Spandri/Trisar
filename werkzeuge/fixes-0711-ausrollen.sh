#!/bin/bash
# Korrekturen vom 07.11. ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/fixes-0711-ausrollen.sh
#
# 1. Migrationen
#    - 20261107100000_dispo_status_bleibt   Status aus der Dispo bleibt (keine alten Routen-Distanzen)
#    - 20261107110000_push_kolonne_nur_bei_kolonne   "Kolonnenfahrt" nur bei mehr als einem Fahrer
#    - 20261107120000_verlauf_fahrten   Fahrer-Verlauf mit erledigten Fahrten
# 2. Web-Dispo: Status beim Bearbeiten, anonyme Gaeste, ETA
# 3. Web-Fahrer: anonyme Gaeste, ETA, Verlauf
# Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/3 Migrationen"
for m in 20261107100000_dispo_status_bleibt 20261107110000_push_kolonne_nur_bei_kolonne 20261107120000_verlauf_fahrten; do
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
for d in src/App.jsx src/components/views/AbfahrtenView.jsx src/components/views/AnkuenfteView.jsx src/components/views/KiAssistentView.jsx src/i18n/de.js src/i18n/en.js src/services/kiAssistant.js src/shared/etaBerechnung.js src/shared/gaesteAnzeige.js ; do
  kopieren admin "$d" fahrer-app-lokal-admin-1
done

echo "3/3 Web-Fahrer"
for d in src/features/fahrer/FahrerApp.jsx src/features/fahrer/views/KoloneFlughafen.jsx src/features/fahrer/views/KoloneNormal.jsx src/features/fahrer/views/SoloFlughafen.jsx src/features/fahrer/views/SoloNormal.jsx src/features/fahrer/views/Stunden.jsx src/features/fahrer/views/Verlauf.jsx src/i18n/de.js src/i18n/en.js src/shared/etaBerechnung.js src/shared/gaesteAnzeige.js ; do
  kopieren fahrer "$d" fahrer-app-lokal-fahrer-1
done
echo "Fertig. Dispo und Fahrer-App neu laden."
