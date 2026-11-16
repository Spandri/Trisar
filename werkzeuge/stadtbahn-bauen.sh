#!/bin/bash
# U-Bahn/Tram-Router fuer die Dienstreise (Linie auf der Karte). Vom eigenen Mac starten:
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/stadtbahn-bauen.sh
# Nimmt die D/A/CH-Karte aus schienennetz-bauen.sh (~/Library/Caches/trisar-schienennetz), laedt sie nur
# falls sie fehlt. Baut OSRM mit werkzeuge/schienennetz/stadtbahn.lua und startet ihn als Container
# trisar-osrm-stadtbahn (Port 5003, fuer die Edge Functions http://trisar-osrm-stadtbahn:5000).
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
ARBEIT="${ARBEIT:-$HOME/Library/Caches/trisar-schienennetz}"
ZIEL="$R/fahrer-app-lokal/.docker-osm/stadtbahn"
OSRM=ghcr.io/project-osrm/osrm-backend:v6.0.0
mkdir -p "$ARBEIT"

echo "1/4 Karte D/A/CH"
if [ ! -f "$ARBEIT/dach-latest.osm.pbf" ] || [ "${LADEN:-0}" = "1" ]; then
  curl -L --fail -o "$ARBEIT/dach-latest.osm.pbf" https://download.geofabrik.de/europe/dach-latest.osm.pbf
fi

echo "2/4 U-Bahn und Tram filtern"
osmium tags-filter --overwrite "$ARBEIT/dach-latest.osm.pbf" \
  w/railway=subway,tram,light_rail -o "$ARBEIT/stadtbahn.osm.pbf"
ls -lh "$ARBEIT/stadtbahn.osm.pbf"

echo "3/4 Auf den 2018 kopieren und bauen"
ssh "$SERVER" "mkdir -p $ZIEL"
scp -q "$ARBEIT/stadtbahn.osm.pbf" "$SERVER:$ZIEL/stadtbahn.osm.pbf"
scp -q "$HIER/werkzeuge/schienennetz/stadtbahn.lua" "$SERVER:$ZIEL/stadtbahn.lua"
ssh "$SERVER" "cd $ZIEL && \
  $DOCKER run --rm -v \"\$PWD:/data\" $OSRM osrm-extract -p /data/stadtbahn.lua /data/stadtbahn.osm.pbf && \
  $DOCKER run --rm -v \"\$PWD:/data\" $OSRM osrm-partition /data/stadtbahn.osrm && \
  $DOCKER run --rm -v \"\$PWD:/data\" $OSRM osrm-customize /data/stadtbahn.osrm"

echo "4/4 Router starten"
ssh "$SERVER" "$DOCKER rm -f trisar-osrm-stadtbahn >/dev/null 2>&1 || true; \
  $DOCKER run -d --name trisar-osrm-stadtbahn --restart unless-stopped -p 5003:5000 \
    -v \"\$HOME/$ZIEL:/data\" --network supabase_network_fahrer-app-lokal \
    $OSRM osrm-routed --algorithm mld /data/stadtbahn.osrm >/dev/null && sleep 4 && \
  curl -s 'http://127.0.0.1:5003/route/v1/train/11.6641,48.1232;11.5600,48.1402?overview=false' | head -c 160; echo"
echo "Fertig. U-Bahn/Tram-Router laeuft (Port 5003)."
