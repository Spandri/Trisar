#!/bin/bash
# Treffpunkt in der offenen Dienstanfrage nur, wenn sie den Dienststart betrifft (nicht bei "nur Dienstende").
# Web-Fahrer auf dem MacBook 2018. Vom eigenen Mac starten:
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/treffpunkt-anfrage-ausrollen.sh
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
datei=src/features/fahrer/views/FahrtenScreen01View.jsx
for ziel in "$R/fahrer-app-lokal/.docker-sync/fahrer/$datei" "$R/trisar/fahrer/$datei"; do
  scp -q "$HIER/fahrer/$datei" "$SERVER:$ziel"
done
ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-fahrer-1 touch /app/$datei" 2>/dev/null || true
echo "Fertig. Fahrer-App neu laden."
