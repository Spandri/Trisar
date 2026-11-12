#!/bin/bash
# Geschaetzte Reichweite und Verbrauch ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/reichweite-ausrollen.sh
#
# Liefert das Auto keine Restreichweite (z. B. BMW X7, 7er: nur Tank in Litern und Kilometerstand),
# lernt die Datenbank je Tracker den Verbrauch aus echten Fahrten und rechnet die Reichweite selbst.
# Anzeige in Dispo und Fahrer-App: "Reichweite ca. 496 km" und "Verbrauch 11,0 l/100 km".
# Erste Werte nach rund 50 km Fahrt ohne Tanken. Gateway bleibt unveraendert.
# Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/3 Datenbank"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261112020000_reichweite_schaetzen

kopieren() { # app (admin|fahrer), container, datei relativ zur App
  local app="$1" container="$2" datei="$3"
  for ziel in "$R/fahrer-app-lokal/.docker-sync/$app/$datei" "$R/trisar/$app/$datei"; do
    scp -q "$HIER/$app/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec $container touch /app/$datei"
  echo "   $app/$datei"
}

echo "2/3 Dispo"
for f in src/shared/fahrzeugTelemetrie.js src/i18n/de.js src/i18n/en.js; do
  kopieren admin fahrer-app-lokal-admin-1 "$f"
done

echo "3/3 Fahrer-App"
for f in src/shared/fahrzeugTelemetrie.js src/i18n/de.js src/i18n/en.js; do
  kopieren fahrer fahrer-app-lokal-fahrer-1 "$f"
done
echo "Fertig. Dispo und Fahrer-App neu laden. iOS und Android brauchen einen neuen Build."
