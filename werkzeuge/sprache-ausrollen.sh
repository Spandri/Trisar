#!/bin/bash
# Voice-Modus im KI-Assistenten (Web-Dispo, 13.11.). Vom eigenen Mac starten:
#   bash werkzeuge/sprache-ausrollen.sh
# Sprechen-Knopf mit TRISAR-Balken statt Senden-Pfeil bei leerem Feld, Kugel mit Planungs-Verlauf.
# Erkennung und Vorlesen ueber den Browser (am besten Chrome). Mikrofon braucht HTTPS.
# iOS und Android haben es mit dem naechsten App-Build.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
DATEIEN=(
  src/shared/sprache.js
  src/components/ui/SprachModus.jsx
  src/index.css
  src/components/views/KiAssistentView.jsx
)
for datei in "${DATEIEN[@]}"; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
done
ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/src/components/views/KiAssistentView.jsx"
echo "Fertig. Dispo neu laden."
