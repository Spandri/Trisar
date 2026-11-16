#!/bin/bash
# KI-Assistent: Korrektur der Ausfall-Sicherung (15.11. nachts, nach dem Lasttest). Vom eigenen Mac:
#   bash werkzeuge/ki-frist-ausrollen.sh
#
# Die Sicherung aus ki-verstehen-ausrollen.sh war zu scharf: 12 s Frist reichen nicht, wenn drei Disponenten
# zugleich fragen (bis 19 s, werkzeuge/ki-test/stabil-test.ts --gleichzeitig=3). Eine Frage verlor so still ihre Pause,
# und im Betrieb hätte die erste lange Antwort das Modell 2 Minuten gesperrt.
# - Frist wieder 20 s. Gesperrt wird erst nach zwei gerissenen Fristen in Folge (verstehen.ts).
# - Reißt die Frist beim Lesen der Felder, sagt er „zu lange gebraucht, nichts geändert“ statt aus dem
#   halben Satz einen Vorschlag zu bauen (ki.ts).
# Kein App-Build. Mehrfach ausführen schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin
for d in ki.ts verstehen.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "Fertig."
