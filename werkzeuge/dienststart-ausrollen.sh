#!/bin/bash
# Dienststart automatisch vor der ersten Fahrt (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/dienststart-ausrollen.sh
#
# 1. Migration 20261115140000_dienststart_automatisch: Tabelle dispo_einstellungen, Trigger
#    trg_jobs_dienststart auf jobs. Gilt fuer alle Apps und den KI-Assistenten. Standard: 60 min
#    vor der 1. Fahrt, sofort aktiv. Aus im Karten Filter.
# 2. Web-Dispo: Karten Filter mit Zeile "Dienststart ... vor 1. Fahrt", dazu "Ohne Signal" (ohneSignal.js, KartenView).
# iOS-/Android-Dispo brauchen einen neuen Build. Vorher testen: bash werkzeuge/dienststart-test.sh
# Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/2 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261115140000_dienststart_automatisch

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

echo "2/2 Web-Dispo"
kopieren admin fahrer-app-lokal-admin-1 \
  src/shared/dienststartVorlauf.js src/components/views/KartenFilterView.jsx \
  src/shared/ohneSignal.js src/components/views/KartenView.jsx \
  src/i18n/de.js src/i18n/en.js src/i18n/fr.js src/i18n/es.js src/i18n/it.js src/i18n/tr.js
echo "Fertig. Dispo neu laden, im Karten Filter den Vorlauf einstellen."
