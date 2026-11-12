#!/bin/bash
# KI-Assistent auf den Mac mini umstellen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/ki-mini-ausrollen.sh
#
# 1. Migration 20261111070000_ki_mac_mini: ollama_url = Mac mini, ollama_url_ersatz = M1-MacBook
# 2. dispo-admin: ki.ts (nimmt den ersten erreichbaren Rechner), kiKern.js (bessere Antworten),
#    dienst.ts, index.ts
# 3. Probe: beide Rechner vom Server aus erreichbar?
# Mehrfach ausfuehren schadet nicht.

set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin

echo "1/3 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261111070000_ki_mac_mini

echo "2/3 Funktion dispo-admin"
for d in ki.ts index.ts dienst.ts kiKern.js; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "3/3 Probe"
for ziel in "Mac mini|100.121.170.114" "MacBook (Ersatz)|100.91.160.11"; do
  name=${ziel%%|*}; ip=${ziel##*|}
  if ssh "$SERVER" "curl -s -m 5 -o /dev/null http://$ip:11434/api/version"; then
    echo "   $name erreichbar"
  else
    echo "   $name NICHT erreichbar"
  fi
done
echo "Fertig. Der Assistent nutzt den Mac mini, ist er aus, das MacBook."
