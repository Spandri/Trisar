#!/bin/bash
# "Danach Dienstende" (19.11.2026) auf dem MacBook 2018 ausrollen. Vom eigenen Mac starten:
#   bash werkzeuge/danach-dienstende-ausrollen.sh
#
# 1. Migration 20261119150000_danach_dienstende: jobs.danach_dienstende, Tabelle dienstende_fahrt,
#    Trigger auf jobs, convoy_assignments und driver_service_requests. Die Datenbank setzt das
#    Dienstende selbst (Plan = Start + Fahrzeit, nach Erledigt die echte Ankunft).
# 2. Web-Dispo: Zeile "Danach" im Fahrt erstellen und bearbeiten (App.jsx, FahrtAdd.jsx,
#    FahrtBearbeitenView.jsx, i18n).
# 3. Fahrer-Web: rote Zeile "Danach Dienstende" / "Dienstende HH:MM" unter der Fahrt
#    (FahrerApp.jsx, FahrtenScreen01View.jsx, i18n).
# Die Dateien haben lokal noch fremde, nicht ausgerollte Aenderungen (Routen-Editor, "beim Gast",
# Import-Felder). Darum werden keine ganzen Dateien kopiert: das Skript holt den Live-Stand, legt nur
# die Patches aus werkzeuge/danach-dienstende/ darauf und schiebt das Ergebnis zurueck.
# Passt ein Patch nicht mehr, bricht es ab, ohne etwas zu kopieren.
# iOS- und Android-Apps brauchen einen neuen Build.
# Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$HIER/werkzeuge/danach-dienstende"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Live-Stand holen, Patch anlegen. $1 = Patch-Datei, Rest = Dateien relativ zum Programmordner.
patchen() {
  local patch="$1"; shift
  local f
  for f in "$@"; do
    mkdir -p "$TMP/$(dirname "$f")"
    scp -q "$SERVER:$R/fahrer-app-lokal/.docker-sync/$f" "$TMP/$f"
  done
  if patch -p1 -d "$TMP" --dry-run -R -s -f < "$patch" >/dev/null 2>&1; then
    echo "   schon drin"
    return 1
  fi
  if ! patch -p1 -d "$TMP" --dry-run -s -f < "$patch"; then
    echo "Patch $(basename "$patch") passt nicht auf den Live-Stand. Nichts kopiert."
    exit 1
  fi
  patch -p1 -d "$TMP" -s -f --no-backup-if-mismatch < "$patch"
}

# Gepatchte Dateien nach .docker-sync und trisar/ schieben. $1 = Container, Rest = Dateien.
schieben() {
  local container="$1"; shift
  local f
  for f in "$@"; do
    for ziel in "$R/fahrer-app-lokal/.docker-sync/$f" "$R/trisar/$f"; do
      scp -q "$TMP/$f" "$SERVER:$ziel"
    done
    echo "   $f"
  done
  for f in "$@"; do
    ssh "$SERVER" "$DOCKER exec $container touch /app/${f#*/}" 2>/dev/null || true
  done
}

echo "1/4 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261119150000_danach_dienstende

echo "2/4 Web-Dispo"
ADMIN=(admin/src/i18n/de.js admin/src/i18n/en.js admin/src/i18n/es.js admin/src/i18n/fr.js admin/src/i18n/it.js
  admin/src/i18n/tr.js admin/src/components/views/FahrtAdd.jsx admin/src/components/views/FahrtBearbeitenView.jsx
  admin/src/App.jsx)
if patchen "$PATCHES/admin.patch" "${ADMIN[@]}"; then
  schieben fahrer-app-lokal-admin-1 "${ADMIN[@]}"
fi

echo "3/4 Fahrer-Web"
FAHRER=(fahrer/src/i18n/de.js fahrer/src/i18n/en.js fahrer/src/i18n/es.js fahrer/src/i18n/fr.js fahrer/src/i18n/it.js
  fahrer/src/i18n/tr.js fahrer/src/features/fahrer/views/FahrtenScreen01View.jsx fahrer/src/features/fahrer/FahrerApp.jsx)
if patchen "$PATCHES/fahrer.patch" "${FAHRER[@]}"; then
  schieben fahrer-app-lokal-fahrer-1 "${FAHRER[@]}"
fi

echo "4/4 Probe"
ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 'Spalte: ' || count(*) from information_schema.columns where table_name = 'jobs' and column_name = 'danach_dienstende'; select 'Trigger: ' || count(*) from pg_trigger where tgname in ('trg_jobs_z_danach_dienstende', 'trg_konvoi_danach_dienstende', 'trg_dienst_z_danach_dienstende');\""
echo "Fertig. Erwartet: Spalte 1, Trigger 3. Web-Dispo und Fahrer-App neu laden."
