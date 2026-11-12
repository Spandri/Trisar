#!/bin/bash
# Stunden zwischen Fahrer und Dispo (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/stunden-dispo-ausrollen.sh
#
# 1. Migration 20261112010000_stunden_dispo_aendert: neuer Stand "dispo_geaendert",
#    Fahrer stimmt per stunden_fahrer_zustimmen() zu, Mitteilungen an die jeweils andere Seite.
# 2. Web-Dispo: Fahrer-Ansicht zeigt die Stunden wie in der Fahrer-App, mit Bearbeiten/Bestaetigen.
# 3. Web-Fahrer-App: Aenderung der Dispo bestaetigen oder bearbeiten.
# iOS und Android brauchen einen neuen Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/3 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261112010000_stunden_dispo_aendert

kopieren() { # app container datei
  for ziel in "$R/fahrer-app-lokal/.docker-sync/$1/$3" "$R/trisar/$1/$3"; do
    scp -q "$HIER/$1/$3" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec $2 touch /app/$3" 2>/dev/null || true
}

echo "2/3 Web-Dispo"
kopieren admin fahrer-app-lokal-admin-1 src/components/views/FahrerStundenKarten.jsx

echo "3/3 Web-Fahrer-App"
kopieren fahrer fahrer-app-lokal-fahrer-1 src/features/fahrer/views/Stunden.jsx
echo "Fertig. Dispo und Fahrer-App neu laden."
