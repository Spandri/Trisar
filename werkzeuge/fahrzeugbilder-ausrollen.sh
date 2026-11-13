#!/bin/bash
# Fahrzeugbilder (360 Grad, alle Modelle) auf den Server bringen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/fahrzeugbilder-ausrollen.sh
#
# Quelle: werkzeuge/fahrzeugbilder/ausgabe/ (dreh-laden.py, bmw-verarbeiten.py, katalog-bauen.py).
# Die Bilder liegen nicht in Git (ca. 250 MB+), nur hier lokal und auf dem Server.
# Ziel:
#   Fahrer-App  public/fahrzeug-dreh/  alles (36 Ansichten je Lack + Seitenbilder + fahrzeug-dreh.json)
#   Dispo       public/fahrzeug-dreh/  nur fahrzeug-dreh.json und *-seite.webp
# Ausgeliefert unter https://fahrer.trisar.de/fahrzeug-dreh/ (die iPhone-/Android-Apps laden von dort).
# Nur geaenderte Dateien werden uebertragen. Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
Q="$HIER/werkzeuge/fahrzeugbilder/ausgabe/"

[ -f "$Q/fahrzeug-dreh.json" ] || { echo "Erst katalog-bauen.py laufen lassen."; exit 1; }

for app in fahrer admin; do
  for basis in "$R/fahrer-app-lokal/.docker-sync/$app" "$R/trisar/$app"; do
    ziel="$basis/public/fahrzeug-dreh/"
    ssh "$SERVER" "mkdir -p '$ziel'"
    if [ "$app" = fahrer ]; then
      rsync -a "$Q" "$SERVER:$ziel"
    else
      rsync -a --include='fahrzeug-dreh.json' --include='*-seite.webp' --exclude='*' "$Q" "$SERVER:$ziel"
    fi
    echo "   $app -> $basis"
  done
done
echo "Pruefen: https://fahrer.trisar.de/fahrzeug-dreh/fahrzeug-dreh.json"
