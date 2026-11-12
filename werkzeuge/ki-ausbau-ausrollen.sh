#!/bin/bash
# KI-Assistent Ausbau 12.11. abends (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/ki-ausbau-ausrollen.sh
#
# dispo-admin: kiKern.js ("Fahrt Stefano von X zu Y" ist Buchung, "zu" und Komma vor PLZ in Adressen),
# anlegen.ts (mehrere Fahrer/Fahrzeuge in einem Satz, Karten, aktion ki_anlegen), index.ts (ki_anlegen),
# fragenKi.ts (Dienst-, Pausen-, Stundenzettel-Fragen, Fahrer aus dem Gespraech), zuordnenKi.ts (Fahrzeug an
# Fahrer, Tracker ins Auto), standbyKi.ts (Standby ohne Fahrt), dienst.ts (Hilfen exportiert), ki.ts (Reihenfolge).
# Web-Dispo: KiAssistentView.jsx (Fahrer-/Fahrzeug-Karten), kiAssistant.js (kiAnlegen).
# Keine Migration. Mehrfach ausfuehren schadet nicht.

set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin

echo "1/2 Funktion dispo-admin"
for d in kiKern.js anlegen.ts index.ts fragenKi.ts zuordnenKi.ts standbyKi.ts dienst.ts ki.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "2/2 Web-Dispo"
for datei in src/components/views/KiAssistentView.jsx src/services/kiAssistant.js; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei"
  echo "   admin/$datei"
done
echo "Fertig. Dispo neu laden."
