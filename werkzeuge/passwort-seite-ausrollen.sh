#!/bin/bash
# Passwort setzen nur noch unter fahrer.trisar.de/passwort (19.11.2026). Vom eigenen Mac:
#   bash werkzeuge/passwort-seite-ausrollen.sh
#
# Vorher: nach einem Einladungs-/Reset-Link blieb im Browser ein Merker haengen, danach zeigte jeder
# Aufruf von fahrer.trisar.de zuerst "Passwort speichern" (Safari, 19.11.).
# Jetzt:
# - Haupt-URL zeigt nie die Passwort-Seite und loescht den alten Merker.
# - Reset-Mail (Web) und Einladung (dispo-admin fahrer_einladen) fuehren auf /passwort.
# - Aeltere Links auf die Haupt-URL springen sofort auf /passwort (fahrer/index.html).
# - Nach dem Speichern zurueck auf die Haupt-URL zum Anmelden.
# iOS- und Android-Fahrer schicken den Reset-Link ab dem naechsten Build auf /passwort, bis dahin
# greift die Umleitung. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions

echo "1/2 Edge Function dispo-admin"
d=dispo-admin/index.ts
scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "   $d"

echo "2/2 Fahrer-Web"
for datei in index.html src/App.jsx src/features/auth/useAuthSession.js; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/fahrer/$datei" "$R/trisar/fahrer/$datei"; do
    scp -q "$HIER/fahrer/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-fahrer-1 touch /app/$datei" 2>/dev/null || true
  echo "   $datei"
done
echo "Fertig. fahrer.trisar.de in Safari neu laden: Login statt Passwort-Seite."
