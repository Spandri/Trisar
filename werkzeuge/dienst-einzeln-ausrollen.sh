#!/bin/bash
# Dienstanfragen einzeln (Dienststart, Dienstende, Pausenstart, Pausenende) ausrollen (MacBook 2018).
#   bash werkzeuge/dienst-einzeln-ausrollen.sh
#
# 1. Datenbank: Tabelle dienst_aenderung (alter Stand einer Aenderung), Funktion dienst_antworten,
#    Trigger auf dienst_pausen, angepasste Push-Meldungen.
# 2. Web-Fahrer-App: Anfrage zeigt nur das Geaenderte (oder bei neuem Dienst alles inkl. Pausen),
#    Pausenstart/-ende als graue Zeilen zwischen den Fahrten, Ablehnen einer Aenderung setzt zurueck.
# iOS und Android brauchen einen neuen Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/2 Datenbank"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261112050000_dienst_aenderung_einzeln

echo "2/2 Fahrer-App"
for datei in src/shared/dienstAnfrage.js src/features/fahrer/FahrerApp.jsx src/features/fahrer/views/FahrtenScreen01View.jsx \
             src/i18n/de.js src/i18n/en.js src/i18n/fr.js src/i18n/es.js src/i18n/it.js src/i18n/tr.js; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/fahrer/$datei" "$R/trisar/fahrer/$datei"; do
    scp -q "$HIER/fahrer/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-fahrer-1 touch /app/$datei"
  echo "   fahrer/$datei"
done
echo "Fertig. Fahrer-App neu laden. iOS und Android brauchen einen neuen Build."
