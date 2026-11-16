#!/bin/bash
# Dienstreise: Dispo-Karte wie Fahrer (Fahrzeug + "Bus 192 ab 06:45" schon vor dem Start, Umstieg-Symbole,
# Zielflagge, keine Anfahrt zur spaeteren Fahrt), Fahrer-Karte mit Umstieg-Symbolen (MacBook 2018).
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/dienstreise8-ausrollen.sh
# Nur Web. iOS/Android brauchen einen neuen Build.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
kopieren() { # app container dateien...
  local app=$1 container=$2; shift 2
  for datei in "$@"; do
    for ziel in "$R/fahrer-app-lokal/.docker-sync/$app/$datei" "$R/trisar/$app/$datei"; do
      ssh "$SERVER" "mkdir -p \"\$(dirname '$ziel')\""
      scp -q "$HIER/$app/$datei" "$SERVER:$ziel"
    done
    ssh "$SERVER" "$DOCKER exec $container touch /app/$datei" 2>/dev/null || true
  done
}
echo "1/2 Web-Fahrer"
kopieren fahrer fahrer-app-lokal-fahrer-1 src/shared/reiseLage.js src/features/fahrer/views/DienstreiseDetail.jsx
echo "2/2 Web-Dispo"
kopieren admin fahrer-app-lokal-admin-1 src/shared/reiseLage.js src/components/ui/DienstreiseKartenSchicht.jsx \
  src/components/views/KartenView.jsx
echo "Fertig. Dispo und Fahrer-App neu laden."
