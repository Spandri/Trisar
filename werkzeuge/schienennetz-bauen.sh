#!/bin/bash
# Schienen-Router fuer die Dienstreise (Gleislinie auf der Karte). Vom eigenen Mac starten:
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/schienennetz-bauen.sh
#
# 1. Hier: OpenStreetMap D/A/CH von Geofabrik laden (6,3 GB, nur falls nicht da) und nur die Gleise
#    herausfiltern (osmium, brew install osmium-tool). Ergebnis ca. 100-200 MB.
# 2. Auf dem MacBook 2018: OSRM mit werkzeuge/schienennetz/schiene.lua bauen und als Container
#    trisar-osrm-schiene starten (Port 5002, im Netz der Edge Functions erreichbar als
#    http://trisar-osrm-schiene:5000). train-validate fragt dort die Gleislinie ab.
# Auffrischen: alle paar Monate erneut ausfuehren (vorher LADEN=1 setzen, dann wird neu geladen).
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
ARBEIT="${ARBEIT:-$HOME/Library/Caches/trisar-schienennetz}"
ZIEL="$R/fahrer-app-lokal/.docker-osm/schiene"
OSRM=ghcr.io/project-osrm/osrm-backend:v6.0.0
mkdir -p "$ARBEIT"

echo "1/4 Karte D/A/CH"
if [ ! -f "$ARBEIT/dach-latest.osm.pbf" ] || [ "${LADEN:-0}" = "1" ]; then
  curl -L --fail -o "$ARBEIT/dach-latest.osm.pbf" https://download.geofabrik.de/europe/dach-latest.osm.pbf
fi

echo "2/4 Gleise filtern"
osmium tags-filter --overwrite "$ARBEIT/dach-latest.osm.pbf" \
  w/railway=rail,light_rail,narrow_gauge -o "$ARBEIT/schiene.osm.pbf"
ls -lh "$ARBEIT/schiene.osm.pbf"

echo "3/4 Auf den 2018 kopieren und bauen"
ssh "$SERVER" "mkdir -p $ZIEL"
scp -q "$ARBEIT/schiene.osm.pbf" "$SERVER:$ZIEL/schiene.osm.pbf"
scp -q "$HIER/werkzeuge/schienennetz/schiene.lua" "$SERVER:$ZIEL/schiene.lua"
ssh "$SERVER" "cd $ZIEL && \
  $DOCKER run --rm -v \"\$PWD:/data\" $OSRM osrm-extract -p /data/schiene.lua /data/schiene.osm.pbf && \
  $DOCKER run --rm -v \"\$PWD:/data\" $OSRM osrm-partition /data/schiene.osrm && \
  $DOCKER run --rm -v \"\$PWD:/data\" $OSRM osrm-customize /data/schiene.osrm"

echo "4/4 Router starten"
ssh "$SERVER" "$DOCKER rm -f trisar-osrm-schiene >/dev/null 2>&1 || true; \
  $DOCKER run -d --name trisar-osrm-schiene --restart unless-stopped -p 5002:5000 \
    -v \"\$HOME/$ZIEL:/data\" --network supabase_network_fahrer-app-lokal \
    $OSRM osrm-routed --algorithm mld /data/schiene.osrm >/dev/null && sleep 4 && \
  curl -s 'http://127.0.0.1:5002/route/v1/train/11.4619,48.1499;10.8856,48.3654?overview=false' | head -c 160; echo"
echo "Fertig. Schienen-Router laeuft (Port 5002)."
