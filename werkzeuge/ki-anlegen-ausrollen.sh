#!/bin/bash
# KI-Assistent legt Fahrer und Fahrzeuge an (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/ki-anlegen-ausrollen.sh
#
# dispo-admin mit anlegen.ts (Regel ohne Modell, Rueckfrage, "ja" legt an), konto.ts (Fahrerkonto anlegen,
# gemeinsam mit aktion konto_anlegen), ki.ts (ruft anlegen.ts, Passwoerter im Protokoll unkenntlich) und
# index.ts (nutzt konto.ts). Keine Migration, kein App-Build: Web, iOS und Android schicken den Kontext schon mit.
# Mehrfach ausfuehren schadet nicht.

set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin

for d in anlegen.ts konto.ts ki.ts index.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "Fertig. Im KI-Assistenten z. B. „Leg Fahrer Max Mustermann an, Nummer 14“ oder"
echo "„Neues Fahrzeug Mercedes V-Klasse, Kennzeichen M-TR 105, 7 Sitze“, dann „ja“."
