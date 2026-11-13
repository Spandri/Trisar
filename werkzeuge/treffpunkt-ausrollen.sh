#!/bin/bash
# Treffpunkt und Notiz beim Dienststart (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/treffpunkt-ausrollen.sh
#
# 1. Migration 20261113140000_dienst_treffpunkt: Tabelle dienst_treffpunkt (Ort + Notiz je Dienst),
#    wandert beim Ersetzen eines Dienstes mit (trisar_dienst_zusammenfuehren).
# 2. Web-Dispo: Dienste planen mit Feld "Treffpunkt beim Dienststart" (eigene Orte + Adresse) und Notiz.
# 3. Web-Fahrer: Dienststart-Karte mit Ort (Figma 2908-12498), Antippen zeigt Karte, Ort und Notiz.
#    Dazu volle Icon-Liste fuer Orte (ortIcons.js), auch bei Start/Ziel der Fahrten.
# iOS/Android brauchen einen neuen Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/3 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261113140000_dienst_treffpunkt

kopieren() { # app container dateien...
  local app=$1 container=$2; shift 2
  for datei in "$@"; do
    for ziel in "$R/fahrer-app-lokal/.docker-sync/$app/$datei" "$R/trisar/$app/$datei"; do
      ssh "$SERVER" "mkdir -p \"\$(dirname '$ziel')\""
      scp -q "$HIER/$app/$datei" "$SERVER:$ziel"
    done
    ssh "$SERVER" "$DOCKER exec $container touch /app/$datei" 2>/dev/null || true
  done
}

echo "2/3 Web-Dispo"
kopieren admin fahrer-app-lokal-admin-1 \
  src/shared/dienstTreffpunkt.js src/shared/dienstBestand.js \
  src/components/views/DienstePlanenBlatt.jsx src/components/views/AlleFahrer.jsx src/App.jsx

echo "3/3 Web-Fahrer"
kopieren fahrer fahrer-app-lokal-fahrer-1 \
  src/shared/ortIcons.js src/shared/orte.js src/shared/dienstTreffpunkt.js \
  src/features/fahrer/views/DienstStartDetail.jsx src/features/fahrer/views/FahrtenScreen01View.jsx \
  src/features/fahrer/FahrerApp.jsx
echo "Fertig. Dispo und Fahrer-App neu laden."
