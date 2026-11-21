#!/bin/bash
# Ort statt Strassenmitte + ganze Anschrift in der KI (20.11.2026). Vom eigenen Mac:
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/adresse-lage-ausrollen.sh
#
# 1. _shared/tomtom-routing.ts: "Wöllinger Wirtshaus, Johann-Clanze-Straße, München, Deutschland" (Google-Text ohne
#    Hausnummer) lag auf der Strassenmitte, rund 1 km neben dem Lokal. Kennt TomTom nur die Strasse und steht ein
#    Name davor, gilt jetzt der Ort an derselben Strasse. Zwischenspeicher neu (tomtom-geo2), alte Punkte gelten nicht.
#    Wirkt fuer Route, Karte und Standort aller neu berechneten Fahrten.
# 2. dispo-admin/ortSuche.ts, ortWahl.ts, ortKorrektur.ts: Waehlt die KI einen Google-Treffer, holt sie die ganze
#    Anschrift (Place Details, lief fuer die Koordinaten schon) und speichert
#    "Wöllinger Wirtshaus, Johann-Clanze-Straße 112, 81369 München".
# Das Formular (Web, iOS, Android) bleibt unveraendert, keine App-Builds.
# Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions

echo "Edge Functions"
for d in _shared/tomtom-routing.ts dispo-admin/ortSuche.ts dispo-admin/ortWahl.ts dispo-admin/ortKorrektur.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "Fertig. Test: im KI-Assistenten „Fahrt vom Wöllinger Wirtshaus zum Hauptbahnhof in 10 Minuten“."
echo "Erwartet: Start „Wöllinger Wirtshaus, Johann-Clanze-Straße 112, 81369 München“, Punkt auf der Karte am Lokal."
