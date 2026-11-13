#!/bin/bash
# 360-Grad-Drehung der V-Klasse ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/fahrzeug-dreh-ausrollen.sh
#
# Was kommt mit:
# 1. Web-Fahrer-App: Fahrzeugseite dreht die V-Klasse (FahrzeugDrehung.jsx, VehicleView.jsx),
#    Startseiten-Karte zeigt sie stehend (FahrzeugKarte.jsx)
#    plus die Bilder public/fahrzeug-dreh (11 Lacke x 36 Ansichten, ca. 12 MB)
# 2. Web-Dispo: Fahrzeug anlegen/bearbeiten schlaegt "Mercedes-Benz V-Klasse" und die Lacke vor
#
# Kopiert den committeten Stand (git HEAD), nicht die Arbeitskopie: offene Aenderungen
# anderer Arbeiten an denselben Dateien kommen so nicht mit.
# iOS- und Android-Apps brauchen einen neuen Build. Keine Migration noetig.
# Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git -C "$HIER" archive HEAD \
  fahrer/public/fahrzeug-dreh fahrer/src/shared/FahrzeugDrehung.jsx fahrer/src/features/fahrer/views/VehicleView.jsx \
  fahrer/src/shared/FahrzeugKarte.jsx \
  admin/public/fahrzeug-dreh admin/src/shared/fahrzeugDreh.js admin/src/components/views/FahrzeugErstellenView.jsx \
  | tar -x -C "$TMP"

ausrollen() { # app (fahrer|admin), container
  local app="$1" container="$2"
  for ziel in "$R/fahrer-app-lokal/.docker-sync/$app" "$R/trisar/$app"; do
    tar -C "$TMP/$app" -cf - . | ssh "$SERVER" "mkdir -p '$ziel' && tar -xf - -C '$ziel'"
  done
  # Quelldateien antippen, damit die laufende App neu laedt
  for datei in $(cd "$TMP/$app" && find src -type f); do
    ssh "$SERVER" "$DOCKER exec $container touch /app/$datei" || true
    echo "   $app/$datei"
  done
}

echo "1/2 Web-Fahrer-App (Drehung + Bilder)"
ausrollen fahrer fahrer-app-lokal-fahrer-1
echo "2/2 Web-Dispo (Vorschlaege Modell und Farbe)"
ausrollen admin fahrer-app-lokal-admin-1
echo "Fertig. Fahrer-App und Dispo neu laden."
