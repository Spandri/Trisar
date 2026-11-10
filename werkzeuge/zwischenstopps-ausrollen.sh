#!/bin/bash
# Zwischenstopps, nachwachsende Fahrerzeilen und Adresspruefung (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/zwischenstopps-ausrollen.sh
# 1. Migration jobs.zwischenstopps
# 2. Edge Functions external-sync, places-proxy, _shared/tomtom-routing.ts, danach Neustart (ca. 10 s)
# 3. Web-Dispo und Web-Fahrer
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/3 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261110100000_zwischenstopps

echo "2/3 Edge Functions"
for d in supabase/functions/external-sync/index.ts supabase/functions/places-proxy/index.ts supabase/functions/_shared/tomtom-routing.ts; do
  scp -q "$HIER/fahrer/$d" "$SERVER:$R/fahrer-app-lokal/$d"
  scp -q "$HIER/fahrer/$d" "$SERVER:$R/trisar/fahrer/$d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

kopieren() { # app datei container
  local app="$1" datei="$2" container="$3"
  for ziel in "$R/fahrer-app-lokal/.docker-sync/$app/$datei" "$R/trisar/$app/$datei"; do
    scp -q "$HIER/$app/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec $container touch /app/$datei" 2>/dev/null || true
}
echo "3/3 Web"
A=fahrer-app-lokal-admin-1
# Neue Bausteine zuerst, sonst baut Vite kurz mit fehlendem Import.
kopieren admin src/shared/fahrtZeilen.js "$A"
kopieren admin src/components/ui/ZwischenstoppVorschlaege.jsx "$A"
for l in de en es fr it tr; do kopieren admin "src/i18n/$l.js" "$A"; done
kopieren admin src/components/views/FahrtAdd.jsx "$A"
kopieren admin src/components/views/FahrtBearbeitenView.jsx "$A"
kopieren admin src/components/views/KartenView.jsx "$A"
kopieren admin src/App.jsx "$A"
F=fahrer-app-lokal-fahrer-1
kopieren fahrer src/features/fahrer/views/ZwischenstoppZeile.jsx "$F"
kopieren fahrer src/shared/utils/navigation.js "$F"
for v in SoloNormal SoloFlughafen KoloneNormal KoloneFlughafen; do kopieren fahrer "src/features/fahrer/views/$v.jsx" "$F"; done
kopieren fahrer src/features/fahrer/FahrerApp.jsx "$F"
echo "Fertig. Dispo und Fahrer-Web neu laden."
