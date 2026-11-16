#!/bin/bash
# Dienstreise (14.11.): Verspaetung auf einen Blick (Zeit orange + "+5") und Zwischenhalte zum Ausklappen
# (MacBook 2018). Vom eigenen Mac starten:
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/halte-ausrollen.sh
# 1. train-validate (liefert halte mit Zeiten), Neustart Edge Functions (ca. 10 s).
# 2. Web-Fahrer und Web-Dispo. iOS/Android brauchen einen neuen Build.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/2 train-validate"
d=supabase/functions/train-validate/index.ts
for ziel in "$R/fahrer-app-lokal/$d" "$R/trisar/fahrer/$d"; do
  scp -q "$HIER/fahrer/$d" "$SERVER:$ziel"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

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
echo "2/2 Web"
kopieren fahrer fahrer-app-lokal-fahrer-1 src/shared/dienstreise.js src/features/fahrer/views/ZugHalte.jsx \
  src/features/fahrer/views/DienstreiseDetail.jsx src/features/fahrer/views/DienstreiseKarte.jsx
kopieren admin fahrer-app-lokal-admin-1 src/shared/dienstreise.js src/components/ui/ZugHalte.jsx \
  src/components/views/DienstreiseView.jsx src/components/views/FahrtAdd.jsx src/components/views/KartenView.jsx
echo "Fertig. Dispo und Fahrer-App neu laden."
