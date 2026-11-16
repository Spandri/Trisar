#!/bin/bash
# KI-Assistent, Tempo (15.11. abends). Vom eigenen Mac:
#   bash werkzeuge/ki-tempo-ausrollen.sh
#
# - Modell bleibt dauerhaft geladen (keep_alive -1 statt 60m). Vorher zahlte der erste Disponent nach einer Stunde
#   Pause 15 bis 20 s fuers Neuladen (verstehen.ts, kiKern.js, freiKi.ts, import.ts).
# - Dienst-Saetze: Das Modell laesst leere Felder weg. 53 statt 83 Antwort-Tokens, 4,8 s statt 7,5 s je
#   Dienst-Aufruf (verstehen.ts). „Nächste Woche werktags“ zaehlt die Regel selbst (Montag fehlte sonst). Gemessen mit werkzeuge/ki-test/messen.ts, Dateien messungen/*-vorher-*, *-v2-*.
# Kein App-Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin
for d in verstehen.ts dienst.ts kiKern.js freiKi.ts import.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "Fertig. Im KI-Assistenten z. B. „Tim morgen 7 bis 15, Pause 12 bis halb eins“."
