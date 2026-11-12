#!/bin/bash
# KI-Assistent: Start und Ziel richtig aufloesen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/ki-orte-ausrollen.sh
#
# 1. dispo-admin mit ortSuche.ts: eigener Ort (orte) mit ID und Adresse, sonst Adresssuche wie im Formular
#    (Google Places D/A/CH, feste Flughaefen zuerst). ki.ts gibt startOrtId/startAdresse/zielOrtId/zielAdresse mit.
# 2. _shared/flughafen-vorschlaege.ts (aus places-proxy herausgezogen) und places-proxy/index.ts.
# 3. Web-Dispo: KiAssistentView.jsx und FahrtAdd.jsx uebernehmen den eigenen Ort.
# iOS und Android brauchen einen neuen Build. Mehrfach ausfuehren schadet nicht.

set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
F=supabase/functions

echo "1/2 Funktionen"
for d in dispo-admin/ki.ts dispo-admin/ortSuche.ts _shared/flughafen-vorschlaege.ts places-proxy/index.ts; do
  scp -q "$HIER/fahrer/$F/$d" "$SERVER:$R/fahrer-app-lokal/$F/$d"
  scp -q "$HIER/fahrer/$F/$d" "$SERVER:$R/trisar/fahrer/$F/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "2/2 Web-Dispo"
for datei in src/components/views/KiAssistentView.jsx src/components/views/FahrtAdd.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei"
  echo "   admin/$datei"
done
echo "Fertig. Dispo neu laden. iOS und Android brauchen einen neuen Build."
