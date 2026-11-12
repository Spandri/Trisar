#!/bin/bash
# KI-Assistent: Standby zusammen mit einer Fahrt (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/ki-standby-ausrollen.sh
#
# "... der Flug landet um 14:30, davor dort Standby ab 10 Uhr": Fahrt kommt als Karte, dazu ein Standby-Vorschlag
# (Abholort, ab 10:00 bis Abholzeit, Fahrer der Fahrt), "ja" legt ihn an (dispo-admin/standbyKi.ts, ki.ts).
# Kein App-Build, keine Migration. Mehrfach ausfuehren schadet nicht.

set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin

for d in ki.ts standbyKi.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "Fertig. Im KI-Assistenten z. B. „Buche Tim morgen vom Salzburg Flughafen zum Kongress, Flug landet 14:30, davor dort Standby ab 10 Uhr“."
