#!/bin/bash
# KI-Assistent mit Karten-Liste (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/ki-karten-ausrollen.sh
#
# 1. dispo-admin: ki.ts (aktionen-Liste fuer Apps mit karten: true, mehrere Auftraege einzeln),
#    standbyKi.ts (Standby als eigene Karte), _shared/tomtom-routing.ts (Adresssuche D/A/CH statt nur DE,
#    betrifft auch Routen nach Oesterreich und in die Schweiz).
# 2. Web-Dispo: KiAssistentView.jsx (Karten, Standby-Karte), StandbyAdd.jsx (Vorlage vom Assistenten),
#    kiAssistant.js (schickt karten: true), tomtomRoute.js (D/A/CH).
# Alte iOS/Android-Builds bekommen weiter die bisherige Antwort (Standby mit "ja"). Mehrfach ausfuehren schadet nicht.

set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
F=supabase/functions

echo "1/2 Funktionen"
for d in dispo-admin/ki.ts dispo-admin/standbyKi.ts _shared/tomtom-routing.ts; do
  scp -q "$HIER/fahrer/$F/$d" "$SERVER:$R/fahrer-app-lokal/$F/$d"
  scp -q "$HIER/fahrer/$F/$d" "$SERVER:$R/trisar/fahrer/$F/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "2/2 Web-Dispo"
for datei in src/components/views/KiAssistentView.jsx src/components/views/StandbyAdd.jsx src/services/kiAssistant.js src/services/tomtomRoute.js; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei"
  echo "   admin/$datei"
done
echo "Fertig. Dispo neu laden."
