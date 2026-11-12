#!/bin/bash
# Stundenlohn, Einsatzkosten und Sprung Fahrer <-> Fahrzeug (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/lohn-fahrzeug-ausrollen.sh
#
# 1. Migration 20261112040000_stundenlohn_einsatzkosten: profiles.stundenlohn (nur Dispo darf setzen),
#    einsatzkosten() fuer die Startseite (Minuten x Lohn, laeuft ab Dienstbeginn mit, Zettel gilt).
# 2. Web-Dispo: Lohnfeld + Knopf "Fahrzeug" in Fahrer bearbeiten, Fahrer-Zeile in Fahrzeug bearbeiten,
#    Fahrzeug in der Fahrer-Ansicht antippbar, Startseite zeigt Einsatzkosten und Arbeitsstunden live.
# iOS/Android brauchen einen neuen Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/2 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261112040000_stundenlohn_einsatzkosten

echo "2/2 Web-Dispo"
for datei in src/components/views/FahrerAnsichtView.jsx src/components/views/FahrerErstellenView.jsx src/components/views/FahrzeugErstellenView.jsx src/components/HomeScreen.jsx src/App.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei" 2>/dev/null || true
done
echo "Fertig. Dispo neu laden."
