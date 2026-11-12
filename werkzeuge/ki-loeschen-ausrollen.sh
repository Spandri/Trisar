#!/bin/bash
# KI-Assistent loescht Fahrer und Fahrzeuge (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/ki-loeschen-ausrollen.sh
#
# dispo-admin: loeschenKi.ts (Rueckfrage mit Folgen, erst "löschen" loescht, nie "alle"), konto.ts (kontoLoeschen,
# gemeinsam mit aktion konto_loeschen), index.ts, zuordnenKi.ts (Kennzeichen-Erkennung geteilt), ki.ts.
# Kein App-Build, keine Migration. Mehrfach ausfuehren schadet nicht.

set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin

for d in loeschenKi.ts konto.ts index.ts zuordnenKi.ts ki.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "Fertig. Im KI-Assistenten z. B. „Lösche den Fahrer Max Mustermann“, dann „löschen“."
