#!/bin/bash
# Zugdaten fuer die Dienstreise (MacBook 2018). Vom eigenen Mac starten:
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/zug-abfahrt-ausrollen.sh
#
# Edge Function train-validate: neu optional start_station (Abfahrt, Gleis, folgende Halte) und
# strecke (Halte mit Koordinaten fuer die Karte). Ohne start_station bleibt die Antwort wie bisher,
# nur das Ankunftsgleis kommt dazu. Danach Neustart der Edge Functions (ca. 10 s).
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

d=supabase/functions/train-validate/index.ts
scp -q "$HIER/fahrer/$d" "$SERVER:$R/fahrer-app-lokal/$d"
scp -q "$HIER/fahrer/$d" "$SERVER:$R/trisar/fahrer/$d"
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "Fertig. train-validate neu geladen."
