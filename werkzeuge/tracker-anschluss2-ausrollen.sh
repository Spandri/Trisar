#!/bin/bash
# Tracker-Anschluss (18.11.): Erkennung auch ohne bekannte Fahrt (geparkter Tracker nach 30 min = OBD).
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/tracker-anschluss2-ausrollen.sh
set -euo pipefail
HIER="$(cd "$(dirname "$0")/.." && pwd)"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261118170000_tracker_anschluss_start
echo "Fertig. In ca. 30 min nach dem naechsten Datensatz steht der Anschluss im Karten Filter."
