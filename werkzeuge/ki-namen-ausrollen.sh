#!/bin/bash
# KI-Assistent (13.11. abends). Vom eigenen Mac:
#   bash werkzeuge/ki-namen-ausrollen.sh
#
# - Falsch gehoerte oder vertippte Namen werden an die echten angeglichen („Stefano Baldri“ -> Stefano Spandri,
#   „Tim Schnieder“ -> Tim Schneider). Neu: namenAngleichen.ts, eingebunden in ki.ts.
# - „Stefano soll vom Flughafen München zum Flughafen Salzburg fahren um 20:30“ ist eine neue Fahrt
#   (vorher „Ich finde keine anstehende Fahrt“). Geaendert: kiKern.js (isBookingPrompt), absicht.ts.
# Kein App-Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin
for d in namenAngleichen.ts ki.ts kiKern.js absicht.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "Fertig. Im KI-Assistenten z. B. „Hat Stefano Baldri heute Dienst?“"
