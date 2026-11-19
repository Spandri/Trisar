#!/bin/bash
# Eigene Navigation der Web-Fahrer-App (Route von Dispo, 16./17.11. inkl. Vorschau der Dispo-Route).
# Nur die Navigations-Dateien, keine fremden Aenderungen. Vom eigenen Mac starten:
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/navigation-web-ausrollen.sh
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
DATEIEN=(
  src/shared/navigation/naviLogik.js
  src/shared/utils/navigation.js
  src/features/fahrer/views/Navigation.jsx
  src/features/fahrer/views/ZwischenstoppZeile.jsx
  src/features/fahrer/views/KoloneFlughafen.jsx
  src/features/fahrer/views/KoloneNormal.jsx
  src/features/fahrer/views/SoloFlughafen.jsx
  src/features/fahrer/views/SoloNormal.jsx
  src/features/fahrer/FahrerApp.jsx
)
for basis in "$R/fahrer-app-lokal/.docker-sync/fahrer" "$R/trisar/fahrer"; do
  ssh "$SERVER" "mkdir -p $basis/src/shared/navigation"
  for datei in "${DATEIEN[@]}"; do
    scp -q "$HIER/fahrer/$datei" "$SERVER:$basis/$datei"
  done
done
for datei in "${DATEIEN[@]}"; do
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-fahrer-1 touch /app/$datei" 2>/dev/null || true
done
echo "Fertig. Fahrer-App neu laden."
