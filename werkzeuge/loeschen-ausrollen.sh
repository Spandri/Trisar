#!/bin/bash
# Fahrer und Fahrzeuge loeschen ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/loeschen-ausrollen.sh
#
# 1. Funktion dispo-admin: aktion konto_loeschen (Auth-Konto weg, Profil und Anhaengsel per CASCADE)
# 2. Web-Dispo: "Fahrer löschen" und "Fahrzeug löschen" im Bearbeiten
# iOS- und Android-Dispo brauchen einen neuen Build.
# Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN="fahrer/supabase/functions/dispo-admin"

echo "1/2 Funktion dispo-admin"
for ziel in "$R/fahrer-app-lokal/supabase/functions/dispo-admin" "$R/trisar/$FN"; do
  scp -q "$HIER/$FN/index.ts" "$SERVER:$ziel/index.ts"
done
# Laedt beim naechsten Aufruf neu, Edge-Container nicht neu starten.

echo "2/2 Web-Dispo"
for d in src/components/views/FahrerErstellenView.jsx src/components/views/FahrzeugErstellenView.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$d" "$R/trisar/admin/$d"; do
    scp -q "$HIER/admin/$d" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$d"
done
echo "Fertig."
