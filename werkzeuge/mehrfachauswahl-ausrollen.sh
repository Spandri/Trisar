#!/bin/bash
# Mehrfachauswahl der Fahrer (Kaestchen oben rechts auf der Karte) und "Dienste planen"
# im Stil der Stundenerfassung (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/mehrfachauswahl-ausrollen.sh
#
# 1. Funktion dispo-admin: KI-Vorschlag Dienstende/Dienststart fuer markierte Fahrer
#    (dienst.ts) und Aktion dienst_senden, danach Neustart der Edge Functions (ca. 10 s)
# 2. Icons (Kaestchen, Haken, Pfeil) fuer die Web-Dispo, nur hinzufuegen
# 3. Web-Dispo: Karte, Fahrer, Fahrzeuge, Fahrten, Fahrt anlegen, KI-Assistent, Dienste planen
# Keine Migration noetig. Mehrfach ausfuehren schadet nicht.
# iOS- und Android-Dispo brauchen einen neuen Build.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
CONTAINER=fahrer-app-lokal-admin-1
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin

echo "1/3 Funktion dispo-admin"
for d in dienst.ts ki.ts index.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "2/3 Icons"
for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/icon/" "$R/trisar/admin/icon/"; do
  rsync -a "$HIER/admin/icon/" "$SERVER:$ziel"
done

echo "3/3 Web-Dispo"
DATEIEN=(
  src/shared/fahrerMarkierung.js
  src/components/ui/AuswahlErklaerung.jsx
  src/components/ui/MarkierungsVermerk.jsx
  src/services/kiAssistant.js
  src/i18n/de.js src/i18n/en.js src/i18n/es.js src/i18n/fr.js src/i18n/it.js src/i18n/tr.js
  src/components/views/DienstePlanenBlatt.jsx
  src/components/views/AlleFahrer.jsx
  src/components/views/FahrzeugeView.jsx
  src/components/views/AnkuenfteView.jsx
  src/components/views/AbfahrtenView.jsx
  src/components/views/FahrtAdd.jsx
  src/components/views/KiAssistentView.jsx
  src/components/views/KartenView.jsx
  src/App.jsx
)
for datei in "${DATEIEN[@]}"; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec $CONTAINER touch /app/$datei" 2>/dev/null || true
done
echo "Fertig. Dispo neu laden, auf der Karte das Kaestchen oben rechts antippen."
