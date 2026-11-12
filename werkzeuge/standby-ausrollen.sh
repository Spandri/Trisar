#!/bin/bash
# Standby am Event-Ort ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/standby-ausrollen.sh
#
# 1. Datenbank: Tabellen standby, standby_fahrer, standby_ereignis, Erkennung aus dem Live-Standort
#    (vor Ort, mit Gast, Rueckweg), Funktionen standby_antworten und standby_melden, Push-Meldungen,
#    Vermerk "Standby ... von–bis" in stunden_verlauf.
# 2. Funktion dispo-admin: Excel-Export mit Spalte "Standby".
# 3. Web-Dispo: Schalter "Fahrt | Standby" in Fahrt hinzufuegen, Standby-Seite, Kacheln in Alle Fahrten.
# 4. Web-Fahrer-App: Standby-Karte mit Ablehnen/Annehmen, Gast drin, Gast abgesetzt, Mit Gast | Bei Standby.
# iOS und Android brauchen einen neuen Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN="fahrer/supabase/functions/dispo-admin"

echo "1/4 Datenbank"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261112060000_standby

echo "2/4 Funktion dispo-admin"
for ziel in "$R/fahrer-app-lokal/supabase/functions/dispo-admin" "$R/trisar/$FN"; do
  scp -q "$HIER/$FN/stunden.ts" "$SERVER:$ziel/stunden.ts"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "   stunden.ts, Edge-Container neu gestartet"

kopieren() { # app, container, datei relativ zur App
  local app="$1" container="$2" datei="$3"
  for ziel in "$R/fahrer-app-lokal/.docker-sync/$app/$datei" "$R/trisar/$app/$datei"; do
    ssh "$SERVER" "mkdir -p \"\$(dirname '$ziel')\""
    scp -q "$HIER/$app/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec $container touch /app/$datei"
  echo "   $app/$datei"
}

echo "3/4 Web-Dispo"
for f in src/shared/standby.js src/components/ui/ArtUmschalter.jsx src/components/ui/StandbyKacheln.jsx \
         src/components/views/StandbyAdd.jsx src/components/views/StandbyView.jsx src/components/views/FahrtAdd.jsx \
         src/components/views/AnkuenfteView.jsx src/components/views/FahrerStundenKarten.jsx src/App.jsx; do
  kopieren admin fahrer-app-lokal-admin-1 "$f"
done

echo "4/4 Web-Fahrer-App"
for f in src/shared/standby.js src/features/fahrer/views/StandbyKarte.jsx src/features/fahrer/views/FahrtenScreen01View.jsx \
         src/features/fahrer/views/Stunden.jsx src/features/fahrer/FahrerApp.jsx; do
  kopieren fahrer fahrer-app-lokal-fahrer-1 "$f"
done
echo "Fertig. Dispo und Fahrer-App neu laden. iOS und Android brauchen einen neuen Build."
