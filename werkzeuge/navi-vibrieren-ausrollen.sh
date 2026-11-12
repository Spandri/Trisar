#!/bin/bash
# Kurzes Vibrieren beim Antippen von Home und Karte in der Web-Dispo ausrollen (MacBook 2018).
#   bash werkzeuge/navi-vibrieren-ausrollen.sh
# Nur Navibar.jsx. Vibriert nur, wo der Browser es kann (Android-Chrome, nicht iPhone-Safari).
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
datei=src/components/navigation/Navibar.jsx
for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
  scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
done
ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei"
echo "Fertig. Dispo neu laden."
