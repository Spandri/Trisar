#!/bin/bash
# KI-Assistent: Enter macht eine neue Zeile statt zu senden (Web-Dispo). Vom eigenen Mac starten:
#   bash werkzeuge/ki-enter-ausrollen.sh
# Senden mit dem Pfeil oder Cmd/Strg+Enter. iOS und Android haben es mit dem naechsten App-Build.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
datei=src/components/views/KiAssistentView.jsx
for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
  scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
done
ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei"
echo "Fertig. Dispo neu laden."
