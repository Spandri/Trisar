#!/bin/bash
# Protokoll des KI-Assistenten ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/ki-protokoll-ausrollen.sh
#
# 1. Migration 20261111020000_ki_protokoll (Tabelle ki_protokoll, lesen nur Dispo)
# 2. dispo-admin mit ki.ts (schreibt jede Frage mit Art, Antwort, Dauer), index.ts, dienst.ts, kiKern.js
#    Eintraege aelter als 30 Tage loescht ki_frage selbst.
# Mehrfach ausfuehren schadet nicht.

set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin

echo "1/2 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261111020000_ki_protokoll

echo "2/2 Funktion dispo-admin"
for d in ki.ts index.ts dienst.ts kiKern.js; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "Fertig. Ab jetzt landet jede Frage an den Assistenten in ki_protokoll."
