#!/bin/bash
# Terminal-Zuordnung und GAT (18.11.2026) auf dem MacBook 2018 ausrollen. Vom eigenen Mac starten:
#   bash werkzeuge/orte-gat-ausrollen.sh
#
# 1. Migration 20261118120000_ort_terminal_vorrang: "Terminal 1"/"T1" im Text gewinnt vor der Entfernung
#    (Fahrt zum Terminal 1 hing an MUC T2), offene Fahrten mit Terminal im Text werden neu zugeordnet.
# 2. Edge Functions: GAT/General Aviation als fester Flughafen-Vorschlag (flughafen-vorschlaege.ts) mit
#    eigenem Punkt (tomtom-routing.ts), KI-Ortsuche nimmt ihn vor Google (ortSuche.ts), "Vom ..."/"nach ..."
#    aendert Start/Ziel des offenen Vorschlags (kiKern.js).
# Kein App-Build noetig. Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
FN=supabase/functions
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/2 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261118120000_ort_terminal_vorrang

echo "2/2 Edge Functions"
# Server-Stand vor dieser Aenderung (18.11. 02:10). Weicht er ab, nicht ueberschreiben, erst abgleichen.
vorher() {
  case "$1" in
    dispo-admin/kiKern.js) echo 27b3a9773f41079a72511b517f2973765220abb2 ;;
    dispo-admin/ortSuche.ts) echo d2e052e614fbc94db6395995a3625b35de2ed6aa ;;
    _shared/tomtom-routing.ts) echo e59c15d2d76742dd342f72a3f2d6cd3f33d149eb ;;
    _shared/flughafen-vorschlaege.ts) echo 6a00c479f790bccb4f8984f86fdb0c00f5dfef09 ;;
  esac
}
DATEIEN="_shared/flughafen-vorschlaege.ts _shared/tomtom-routing.ts dispo-admin/ortSuche.ts dispo-admin/kiKern.js"
# Erst alles pruefen, dann kopieren, damit nicht die Haelfte ausgerollt ist.
for datei in $DATEIEN; do
  neu=$(shasum "$HIER/fahrer/$FN/$datei" | awk '{print $1}')
  for z in "$R/fahrer-app-lokal/$FN/$datei" "$R/trisar/fahrer/$FN/$datei"; do
    jetzt=$(ssh "$SERVER" "shasum \"$z\"" | awk '{print $1}')
    if [[ "$jetzt" != "$neu" && "$jetzt" != "$(vorher "$datei")" ]]; then
      echo "Auf dem Server liegt in $z ein anderer Stand als erwartet. Abbruch, erst abgleichen."
      exit 1
    fi
  done
done
for datei in $DATEIEN; do
  for z in "$R/fahrer-app-lokal/$FN/$datei" "$R/trisar/fahrer/$FN/$datei"; do
    scp -q "$HIER/fahrer/$FN/$datei" "$SERVER:$z"
  done
  echo "   $datei"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
ssh "$SERVER" "$DOCKER exec supabase_db_fahrer-app-lokal psql -U postgres -At -c \"select o.name from public.jobs j join public.orte o on o.id = j.dropoff_ort_id where j.id = 'b1c185c5-8530-4484-8455-e92f5871e968'\""
echo "Fertig. Oben muss MUC T1 stehen (Fahrt Frühlingstraße -> Terminal 1)."
