#!/bin/bash
# Fahrtenbuch je Fahrzeug ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/fahrtenbuch-ausrollen.sh
#
# 1. Datenbank: Kilometerstand am Auto (vehicles.km_stand, Verlauf fahrzeug_km_stand), km je Fahrt
#    (jobs.km_start, km_ende, km_gefahren, km_quelle), Tabelle fahrtenbuch mit Leerfahrten. Das Buch
#    haengt an der Fahrgestellnummer, nicht am Kennzeichen (zweite Migration).
# 2. Edge Function dispo-admin: Aktion fahrtenbuch_export (Excel, PDF, CSV).
# 3. Web-Dispo: Block "Fahrtenbuch" auf der Fahrzeug-Seite und die Seite mit Zeitraum und Export,
#    dazu die gefahrenen km an beendeten Fahrten in Abfahrten und Ankuenfte.
# Gilt ab dem Ausrollen, alte Fahrten werden nicht nachgetragen. Gateway bleibt unveraendert.
# Die Sprachdateien haben lokal fremde, nicht ausgerollte Schluessel. Darum holt das Skript deren
# Live-Stand und legt nur werkzeuge/fahrtenbuch/i18n.patch darauf. Passt der Patch nicht, bricht es ab.
# Test vorher lokal: bash werkzeuge/fahrtenbuch-test.sh
# iOS- und Android-Dispo brauchen spaeter einen neuen Build.
# Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "1/3 Datenbank"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261121100000_fahrtenbuch 20261121110000_fahrtenbuch_vin

echo "2/3 Edge Function"
for d in dispo-admin/fahrtenbuch.ts dispo-admin/index.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "3/3 Web-Dispo"
SPRACHE="admin/src/i18n/de.js admin/src/i18n/en.js"
for f in $SPRACHE; do
  mkdir -p "$TMP/$(dirname "$f")"
  scp -q "$SERVER:$R/fahrer-app-lokal/.docker-sync/$f" "$TMP/$f"
done
if patch -p1 -d "$TMP" --dry-run -R -s -f < "$HIER/werkzeuge/fahrtenbuch/i18n.patch" >/dev/null 2>&1; then
  echo "   Sprachdateien schon drin"
else
  if ! patch -p1 -d "$TMP" --dry-run -s -f < "$HIER/werkzeuge/fahrtenbuch/i18n.patch"; then
    echo "i18n.patch passt nicht auf den Live-Stand. Web-Dispo nicht kopiert."
    exit 1
  fi
  patch -p1 -d "$TMP" -s -f --no-backup-if-mismatch < "$HIER/werkzeuge/fahrtenbuch/i18n.patch"
  for f in $SPRACHE; do
    for ziel in "$R/fahrer-app-lokal/.docker-sync/$f" "$R/trisar/$f"; do scp -q "$TMP/$f" "$SERVER:$ziel"; done
    echo "   $f"
  done
fi
for f in admin/src/components/views/dispoFahrzeug/Fahrtenbuch.jsx admin/src/components/views/dispoFahrzeug/DispoFahrzeugView.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/$f" "$R/trisar/$f"; do scp -q "$HIER/$f" "$SERVER:$ziel"; done
  echo "   $f"
done

# km in den Fahrtenlisten (beendete Fahrt: "Ankunft 22:12 · 38,1 km"). App.jsx und die Listen haben
# lokal fremde Aenderungen, darum auch hier nur der Patch auf den Live-Stand.
LISTEN="admin/src/App.jsx admin/src/components/views/AbfahrtenView.jsx admin/src/components/views/AnkuenfteView.jsx"
rm -rf "$TMP/admin"
for f in $LISTEN; do
  mkdir -p "$TMP/$(dirname "$f")"
  scp -q "$SERVER:$R/fahrer-app-lokal/.docker-sync/$f" "$TMP/$f"
done
if patch -p1 -d "$TMP" --dry-run -R -s -f < "$HIER/werkzeuge/fahrtenbuch/listen.patch" >/dev/null 2>&1; then
  echo "   Listen schon drin"
else
  if ! patch -p1 -d "$TMP" --dry-run -s -f < "$HIER/werkzeuge/fahrtenbuch/listen.patch"; then
    echo "listen.patch passt nicht auf den Live-Stand. Listen nicht kopiert, der Rest ist ausgerollt."
    exit 1
  fi
  patch -p1 -d "$TMP" -s -f --no-backup-if-mismatch < "$HIER/werkzeuge/fahrtenbuch/listen.patch"
  for f in $LISTEN; do
    for ziel in "$R/fahrer-app-lokal/.docker-sync/$f" "$R/trisar/$f"; do scp -q "$TMP/$f" "$SERVER:$ziel"; done
    ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/${f#*/}" 2>/dev/null || true
    echo "   $f"
  done
fi
for f in $SPRACHE admin/src/components/views/dispoFahrzeug/Fahrtenbuch.jsx admin/src/components/views/dispoFahrzeug/DispoFahrzeugView.jsx; do
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/${f#*/}" 2>/dev/null || true
done
echo "Fertig. Dispo neu laden. Der Block Fahrtenbuch steht auf der Fahrzeug-Seite (Karte, Fahrer, Kennzeichen)."
