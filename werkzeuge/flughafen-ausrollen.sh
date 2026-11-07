#!/bin/bash
# Flughafen-Vorschlaege und Suche nur in DACH (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/flughafen-ausrollen.sh
# 1. Edge Functions places-proxy (Flughaefen zuerst in den Vorschlaegen) und _shared/tomtom-routing.ts
#    ("Muc T2" ist der Flughafen), danach Neustart der Edge Functions (ca. 10 s)
# 2. Web-Dispo und Web-Fahrer: Kartensuche nur Deutschland/Oesterreich/Schweiz
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/2 Edge Functions"
for d in supabase/functions/places-proxy/index.ts supabase/functions/_shared/tomtom-routing.ts; do
  scp -q "$HIER/fahrer/$d" "$SERVER:$R/fahrer-app-lokal/$d"
  scp -q "$HIER/fahrer/$d" "$SERVER:$R/trisar/fahrer/$d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

kopieren() { # app datei container
  local app="$1" datei="$2" container="$3"
  for ziel in "$R/fahrer-app-lokal/.docker-sync/$app/$datei" "$R/trisar/$app/$datei"; do
    scp -q "$HIER/$app/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec $container touch /app/$datei" 2>/dev/null || true
}
echo "2/2 Web"
kopieren admin src/App.jsx fahrer-app-lokal-admin-1
kopieren admin src/shared/karte/maplibreKarte.js fahrer-app-lokal-admin-1
kopieren fahrer src/shared/karte/maplibreKarte.js fahrer-app-lokal-fahrer-1
echo "Fertig. Dispo neu laden."
