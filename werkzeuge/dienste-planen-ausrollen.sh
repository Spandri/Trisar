#!/bin/bash
# "Dienste planen" in der Web-Dispo ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/dienste-planen-ausrollen.sh
#
# Alle Fahrer: Fahrer markieren, "Dienste planen" -> Tag, Dienststart, Dienstende, Pausen.
# Je Fahrer eine Dienstanfrage (driver_service_requests, pending), Pausen in dienst_pausen.
# Nimmt der Fahrer an, laeuft der Dienst in seine Stundenerfassung (Verlauf).
# Keine Migration noetig. Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
CONTAINER=fahrer-app-lokal-admin-1
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

for datei in src/components/views/DienstePlanenBlatt.jsx src/components/views/AlleFahrer.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec $CONTAINER touch /app/$datei"
  echo "   $datei"
done
echo "Fertig. Dispo neu laden, Alle Fahrer, Fahrer markieren, Dienste planen."
