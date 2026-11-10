#!/bin/bash
# NFC-Tags am Tracker (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/nfc-ausrollen.sh
# 1. Migration 20261110120000_nfc_tags
# 2. Web-Dispo (Tracker am Fahrzeug zuordnen)
# 3. Web-Fahrer, Domain-Dateien fuer iOS und Android
# Danach zeigt werkzeuge/nfc-links.sh die Links zum Beschreiben der Tags.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

kopieren() { # app datei container
  local app="$1" datei="$2" container="$3"
  for ziel in "$R/fahrer-app-lokal/.docker-sync/$app/$datei" "$R/trisar/$app/$datei"; do
    scp -q "$HIER/$app/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec $container touch /app/$datei" 2>/dev/null || true
}

echo "1/3 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261110120000_nfc_tags

echo "2/3 Web-Dispo"
A=fahrer-app-lokal-admin-1
for l in de en es fr it tr; do kopieren admin "src/i18n/$l.js" "$A"; done
kopieren admin src/components/views/FahrzeugErstellenView.jsx "$A"

echo "3/3 Web-Fahrer und Domain-Dateien"
F=fahrer-app-lokal-fahrer-1
ssh "$SERVER" "mkdir -p $R/fahrer-app-lokal/.docker-sync/fahrer/public/.well-known $R/trisar/fahrer/public/.well-known"
kopieren fahrer public/.well-known/apple-app-site-association "$F"
kopieren fahrer public/.well-known/assetlinks.json "$F"
kopieren fahrer src/features/fahrer/FahrerApp.jsx "$F"
kopieren fahrer vite.config.js "$F"
sleep 6
curl -s -m 10 -o /dev/null -w "Apple-Datei %{http_code} %{content_type}\n" https://fahrer.trisar.de/.well-known/apple-app-site-association
curl -s -m 10 -o /dev/null -w "Android-Datei %{http_code} %{content_type}\n" https://fahrer.trisar.de/.well-known/assetlinks.json
echo "Fertig. Dispo und Fahrer-Web neu laden."
