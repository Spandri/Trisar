#!/bin/bash
# KI-Assistent: unbestaetigter Flug ist Hinweis statt Fehler (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/ki-flug-ausrollen.sh
#
# dispo-admin: flugKi.ts prueft die Flugnummer jedes Buchungsvorschlags (flight-validate), ki.ts setzt
# flugUnbestaetigt und haengt den Hinweis an. Web: App.jsx speichert mit flugOhnePruefung die Nummer ohne
# Flugdaten, KiAssistentView.jsx zeigt "Flug ... nicht bestätigt" auf der Karte und schickt das Kennzeichen mit.
# iOS/Android ab dem naechsten Build. Mehrfach ausfuehren schadet nicht.

set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin

echo "1/2 Funktion dispo-admin"
for d in ki.ts flugKi.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "2/2 Web-Dispo"
for datei in src/App.jsx src/components/views/KiAssistentView.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei"
  echo "   admin/$datei"
done
echo "Fertig. Dispo neu laden."
