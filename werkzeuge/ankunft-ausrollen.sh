#!/bin/bash
# "Ankuenfte bei mir" (17.11.2026, Kundenwunsch) auf dem MacBook 2018 ausrollen. Vom eigenen Mac starten:
#   bash werkzeuge/ankunft-ausrollen.sh
#
# 1. Migration 20261117140000_ankunft_bei_mir: Tabelle dispo_ankunft_melden (Schalter, Ort, Minuten je
#    Dispo-Konto), ankunft_bei_mir() fuer die Listen der Apps, push_dispo_ankuenfte() fuer die Meldungen
# 2. push-dienst.js: ruft push_dispo_ankuenfte() jede Minute auf, Dienst neu starten
# 3. Web-Dispo: Schalter im Fahrten Filter, Ankuenfte/Abfahrten "Nur zu mir" mit Restzeit
# 4. Probe: Funktionen da, Log des push-dienstes
# Stufe 2 (17.11.): Migration 20261117160000_ankunft_automatisch (Ort automatisch, Melden "sobald
# unterwegs"), eigener Standort als blauer Punkt auf der Dispo-Karte (KartenView.jsx, eigenerStandort.js,
# karte/eigenerPunkt.js).
# iOS- und Android-Dispo brauchen einen neuen Build.
# Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/4 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261117140000_ankunft_bei_mir 20261117160000_ankunft_automatisch

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
# Erst die Dateien, die andere importieren, sonst meldet Vite kurz "Failed to resolve import".
for d in src/shared/eigenerStandort.js src/shared/karte/eigenerPunkt.js src/shared/ankunftMelden.js \
  src/components/ui/AnkunftPlakette.jsx src/components/views/FahrtenFilter.jsx \
  src/components/views/AnkuenfteView.jsx src/components/views/AbfahrtenView.jsx \
  src/components/views/KartenView.jsx; do
  kopieren "$d"
done

echo "4/4 Probe"
ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 'Tabelle: ' || coalesce(to_regclass('public.dispo_ankunft_melden')::text, 'FEHLT'), 'Liste: ' || coalesce(to_regprocedure('public.ankunft_bei_mir()')::text, 'FEHLT'), 'Push: ' || coalesce(to_regprocedure('public.push_dispo_ankuenfte()')::text, 'FEHLT'), 'Automatik: ' || (select count(*) from information_schema.columns where table_name = 'dispo_ankunft_melden' and column_name = 'automatisch')\""
sleep 70
ssh "$SERVER" "$DOCKER logs --since 90s fahrer-app-lokal-push-dienst-1 2>&1 | tail -8"
echo "Fertig. Im Log darf kein 'Fehler bei Ankunft-Meldungen' stehen."
