#!/bin/bash
# Macht codeleichen-fahrer-ausrollen.sh (20.11.2026) auf dem MacBook 2018 rueckgaengig. Vom eigenen Mac:
#   bash werkzeuge/codeleichen-fahrer-zurueck.sh
#
# Anlass: Das Aufraeumen hatte auch Teile entfernt, die die Dispo-App mitbenutzt. Alles kommt zurueck.
# - Geaenderte Dateien: lokale Fassung (= Stand vor dem Aufraeumen plus spaetere fremde Aenderungen) rueber.
#   Vorher Abgleich: Live-Datei muss dem Aufraeum-Stand (ceb2cd6) entsprechen oder FahrerApp.jsx mit dem
#   Navi-Fix aus adresse-neu-navigation-ausrollen.sh sein. Sonst Abbruch fuer diese Datei.
# - Verschobene Dateien aus ~/trisar-codeleichen-20261120/ an ihren Platz zurueck.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
SICHERUNG=trisar-codeleichen-20261120
cd "$HIER"

GEAENDERT=(
  src/features/fahrer/FahrerApp.jsx
  src/features/fahrer/views/CancelRideSheet.jsx
  src/features/fahrer/views/FahrtBeenden.jsx
  src/features/fahrer/views/FahrtenScreen01View.jsx
  src/features/fahrer/views/KoloneFlughafen.jsx
  src/features/fahrer/views/KoloneNormal.jsx
  src/features/fahrer/views/KolonnenChat.jsx
  src/features/fahrer/views/NotizSend.jsx
  src/features/fahrer/views/SoloFlughafen.jsx
  src/features/fahrer/views/SoloNormal.jsx
  src/features/fahrer/views/Stunden.jsx
  src/services/supabase.js
  src/shared/etaBerechnung.js
  src/shared/gaesteAnzeige.js
  src/shared/ui/icons.js
)
# FahrerApp.jsx live = Aufraeum-Stand + Navi-Fix (anderer Chat, 20.11.)
NAVI_FIX_LIVE=676bc255cfbe

echo "1/2 Geaenderte Dateien zurueck"
for datei in "${GEAENDERT[@]}"; do
  ceb=$(git show "ceb2cd6:fahrer/$datei" | shasum | cut -c1-12)
  for basis in fahrer-app-lokal/.docker-sync/fahrer trisar/fahrer; do
    live=$(ssh "$SERVER" "shasum < '$R/$basis/$datei' | cut -c1-12")
    if [ "$live" != "$ceb" ] && ! { [ "$datei" = src/features/fahrer/FahrerApp.jsx ] && [ "$live" = "$NAVI_FIX_LIVE" ]; }; then
      echo "   UEBERSPRUNGEN $basis/$datei: live hat unbekannten Stand ($live)"
      continue
    fi
    scp -q "fahrer/$datei" "$SERVER:$R/$basis/$datei"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-fahrer-1 touch /app/$datei" 2>/dev/null || true
  echo "   $datei"
done

echo "2/2 Verschobene Dateien zurueck"
ssh "$SERVER" "cd \"\$HOME/$SICHERUNG\" && find . -type f | while read -r f; do z='$R/'\"\${f#./}\"; mkdir -p \"\$HOME/\$(dirname \"\$z\")\" && mv \"\$f\" \"\$HOME/\$z\" && echo \"   \${f#./}\"; done"
echo "Fertig. fahrer.trisar.de neu laden."
