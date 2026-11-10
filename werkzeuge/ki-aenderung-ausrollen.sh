#!/bin/bash
# KI-Assistent: Aenderungen an Fahrten als Vorschlag mit Bestaetigung (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/ki-aenderung-ausrollen.sh
# 1. Funktion dispo-admin, danach Neustart der Edge Functions (ca. 10 s)
# 2. Web-Dispo
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin

echo "1/2 Funktion dispo-admin"
for d in kiKern.js ki.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "2/2 Web-Dispo"
# Texte und Bausteine zuerst, sonst baut Vite kurz mit fehlendem Export.
for datei in src/i18n/de.js src/i18n/en.js src/i18n/es.js src/i18n/fr.js src/i18n/it.js src/i18n/tr.js \
  src/services/kiAssistant.js src/components/views/FahrtBearbeitenView.jsx src/components/views/KiAssistentView.jsx src/App.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei" 2>/dev/null || true
done
echo "Fertig. Dispo neu laden."
