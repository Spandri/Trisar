#!/bin/bash
# KI-Assistent, Dienst (13.11. abends). Vom eigenen Mac:
#   bash werkzeuge/ki-dienst-jetzt-ausrollen.sh
#
# - „Schick allen Fahrern ein Dienstende für heute 20:00“: einfacher Vorschlag „Dienstende 20:00 heute für alle
#   7 Fahrer. Soll ich das senden?“ statt der Liste „hat heute schon Dienst …“. Erwaehnt wird nur noch, wo ein
#   schon eingetragener Wert ueberschrieben wird (dienst.ts).
# - „Ist Joris noch im Dienst?“: Ja oder Nein bezogen auf jetzt („Nein, Joris hat seit 20:00 Dienstende.“),
#   „Ist gerade irgendein Fahrer im Dienst?“: Liste der Fahrer, die jetzt im Dienst sind (fragenKi.ts).
# Kein App-Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin
for d in dienst.ts fragenKi.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "Fertig. Im KI-Assistenten z. B. „Ist Joris noch im Dienst?“"
