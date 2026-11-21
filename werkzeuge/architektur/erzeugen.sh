#!/bin/bash
# Architektur-Karte neu erzeugen: Live-DB (2018, nur lesend) + Code auslesen, Modell bauen, Seite bauen.
#   bash werkzeuge/architektur/erzeugen.sh            # mit frischem DB-Stand
#   bash werkzeuge/architektur/erzeugen.sh --ohne-db  # letzten DB-Stand aus roh/db.json nehmen
set -euo pipefail
HIER="$(cd "$(dirname "$0")" && pwd)"
if [ "${1:-}" != "--ohne-db" ]; then
  bash "$HIER/db-auslesen.sh"
fi
python3 "$HIER/code-auslesen.py" > /dev/null
python3 "$HIER/modell-bauen.py"
python3 "$HIER/seite-bauen.py"
echo "Öffnen: open \"$HIER/architektur.html\""
