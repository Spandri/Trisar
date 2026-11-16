#!/bin/bash
# Dienstreise: Bus entlang der Strassen, U-Bahn/Tram entlang der Gleise, Strecke vor dem Start auf der Dispo-Karte
# (MacBook 2018). Vorher einmal werkzeuge/stadtbahn-bauen.sh (U-Bahn/Tram-Router). Vom eigenen Mac starten:
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/dienstreise6-ausrollen.sh
#
# 1. Edge Function abschnitt-linie, Auto-OSRM ins Netz der Edge Functions haengen, Neustart (ca. 10 s).
# 2. Migration 20261114040000_abschnitt_linie: Spalte linie, Trigger beim Anlegen, bestehende Reisen nachrechnen.
# 3. Web-Fahrer und Web-Dispo: gespeicherte Linie nutzen, Dispo-Karte zeigt die Strecke schon vor dem Start.
# iOS/Android brauchen einen neuen Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/3 Edge Function"
d=supabase/functions/dispo-admin/linie.ts
for ziel in "$R/fahrer-app-lokal/$d" "$R/trisar/fahrer/$d"; do
  ssh "$SERVER" "mkdir -p \"\$(dirname '$ziel')\""
  scp -q "$HIER/fahrer/$d" "$SERVER:$ziel"
done
ssh "$SERVER" "$DOCKER network connect supabase_network_fahrer-app-lokal fahrer-app-lokal-osm-osrm-1 2>/dev/null || true; \
  $DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "2/3 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261114040000_abschnitt_linie

kopieren() { # app container dateien...
  local app=$1 container=$2; shift 2
  for datei in "$@"; do
    for ziel in "$R/fahrer-app-lokal/.docker-sync/$app/$datei" "$R/trisar/$app/$datei"; do
      ssh "$SERVER" "mkdir -p \"\$(dirname '$ziel')\""
      scp -q "$HIER/$app/$datei" "$SERVER:$ziel"
    done
    ssh "$SERVER" "$DOCKER exec $container touch /app/$datei" 2>/dev/null || true
  done
}

echo "3/3 Web"
kopieren fahrer fahrer-app-lokal-fahrer-1 src/shared/reiseLage.js
kopieren admin fahrer-app-lokal-admin-1 src/shared/reiseLage.js src/components/ui/DienstreiseKartenSchicht.jsx \
  src/components/views/KartenView.jsx
sleep 5
ssh "$SERVER" "$DOCKER exec supabase_db_fahrer-app-lokal psql -U postgres -At -c \
  \"select art, nummer, coalesce(jsonb_array_length(linie), 0) as punkte from dienstreise_abschnitt where art in ('bus','ubahn','tram') order by dienstreise_id, reihenfolge\""
echo "Fertig. Dispo und Fahrer-App neu laden. Punkte 0 = Linie fehlt (Router aus?)."
