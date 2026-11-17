#!/bin/bash
# Glocke je Fahrt (17.11.2026) auf dem MacBook 2018 ausrollen. Vom eigenen Mac starten:
#   bash werkzeuge/glocke-ausrollen.sh
#
# 1. Migration 20261117180000_fahrt_glocke: Tabelle fahrt_glocke (Glocke je Dispo-Konto und Fahrt),
#    fahrt_ziel_rest() und push_fahrt_glocke() (beim Gast, unterwegs, 5 min vor Ankunft, angekommen)
# 2. push-dienst.js: ruft push_fahrt_glocke() jede Minute auf, Dienst neu starten
# 3. Web-Dispo: Wisch-Knopf Glocke statt "Fahrer hinzufuegen", kleine Glocke oben rechts an der Fahrt
# 4. Probe
# Dazu (17.11.): Migration 20261117190000_ohne_signal_standard_aus ("Fahrer seit 5 min ohne Signal" fuer
# Dispo-Konten standardmaessig aus) und "Mein Standort" in Alle Fahrten traegt den gespeicherten Ort ein,
# in dem man steht (shared/ankunftMelden.js ortHier). Die Liste vergleicht dafuer auch mit dem Namen des
# gespeicherten Orts (werkzeuge/ort-name-einbauen.py baut das in die App.jsx auf dem Server ein).
# iOS- und Android-Dispo brauchen einen neuen Build.
# Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/4 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261117180000_fahrt_glocke 20261117190000_ohne_signal_standard_aus

echo "2/4 push-dienst.js kopieren und neu starten"
for ziel in "$R/fahrer-app-lokal/.docker-sync/koordinaten/scripts" "$R/trisar/koordinaten/scripts"; do
  scp -q "$HIER/koordinaten/scripts/push-dienst.js" "$SERVER:$ziel/push-dienst.js"
done
ssh "$SERVER" "cd $R/fahrer-app-lokal && $DOCKER compose up -d push-dienst >/dev/null 2>&1; $DOCKER restart fahrer-app-lokal-push-dienst-1 >/dev/null"

echo "3/4 Web-Dispo"
kopieren() { # datei relativ zu admin/
  local datei="$1"
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    ssh "$SERVER" "mkdir -p \"\$(dirname \"$ziel\")\""
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 sh -c 'mkdir -p \"\$(dirname /app/$datei)\" && touch /app/$datei'"
  echo "   $datei"
}
# Erst die neue Datei, die die Listen importieren.
for d in src/shared/fahrtGlocke.js src/shared/ankunftMelden.js src/components/views/AnkuenfteView.jsx src/components/views/AbfahrtenView.jsx; do
  kopieren "$d"
done
# App.jsx: nur den Standort-Vergleich (Adresse oder Name des gespeicherten Orts) in die Server-Fassung
# einbauen. Die lokale App.jsx hat noch nicht ausgerollte Aenderungen anderer Sitzungen (Routenpunkte).
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/src/App.jsx" "$R/trisar/admin/src/App.jsx"; do
  scp -q "$SERVER:$ziel" "$ARBEIT/App.jsx"
  python3 "$HIER/werkzeuge/ort-name-einbauen.py" "$ARBEIT/App.jsx"
  scp -q "$ARBEIT/App.jsx" "$SERVER:$ziel"
done
ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/src/App.jsx"

echo "4/4 Probe"
ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 'Tabelle: ' || coalesce(to_regclass('public.fahrt_glocke')::text, 'FEHLT'), 'Push: ' || coalesce(to_regprocedure('public.push_fahrt_glocke()')::text, 'FEHLT')\""
sleep 70
ssh "$SERVER" "$DOCKER logs --since 90s fahrer-app-lokal-push-dienst-1 2>&1 | tail -6"
echo "Fertig. Im Log darf kein 'Fehler bei Glocken-Meldungen' stehen."
