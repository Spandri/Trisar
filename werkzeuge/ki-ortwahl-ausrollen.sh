#!/bin/bash
# KI-Assistent: Ortsauswahl zum Antippen + Fahrtkarte auch im Sprachmodus bearbeiten (18.11.2026). Vom eigenen Mac:
#   bash werkzeuge/ki-ortwahl-ausrollen.sh
#
# Server (dispo-admin):
# - Ort unsicher (mehrere Treffer, andere Hausnummer, nichts gefunden): statt still den ersten Treffer zu nehmen,
#   fragt der Assistent „Welchen Start meinst du?“ mit bis zu 3 Orten. Die Buchung wartet so lange (ortWahl.ts,
#   ortSuche.ts, ki.ts). Getippt gehen auch „2“, „die erste“, „keiner davon“ oder eine neue Adresse.
# - Text und Karte zeigen denselben Ort (14:32: Text „Franz Josef Straße 48“, Karte „Terminal 2“).
# - „Franz Josef Straße …“ ist kein Flughafen mehr (_shared/flughafen-vorschlaege.ts, gilt auch fuer die
#   Adresssuche im Formular, darum places-proxy mit).
# - Nimmt den KI-Umbau mit (kiNeu*.ts, freiKi.ts, kiKern.js), weil ki.ts ihn importiert. Er bleibt aus, solange
#   integration_settings ki_ablauf nicht 'neu' ist. Testsatz alter Ablauf gruen (ausser Gruppe „Protokoll 18.11.“).
# Web-Dispo: Kacheln unter der Frage, Fahrtkarte im Sprachmodus antippbar (KiAssistentView.jsx).
# iOS- und Android-Dispo brauchen einen neuen Build, aeltere Apps zeigen die Orte nummeriert im Text.
# Vorher pruefen: deno run -A werkzeuge/ki-test/ki-test.ts ... --nur=Ortwahl
# Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions

echo "1/2 Edge Functions"
for d in _shared/flughafen-vorschlaege.ts places-proxy/index.ts \
  dispo-admin/kiNeuPruefen.ts dispo-admin/kiNeuFormular.ts dispo-admin/kiNeuAufloesen.ts dispo-admin/kiNeuAblauf.ts \
  dispo-admin/freiKi.ts dispo-admin/kiKern.js dispo-admin/ortSuche.ts dispo-admin/ortWahl.ts dispo-admin/ki.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "2/2 Web-Dispo"
for datei in src/components/views/KiAssistentView.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 sh -c 'touch /app/$datei'"
  echo "   $datei"
done
echo "Fertig. Im KI-Assistenten z. B. „Fahrt morgen um 9 von Franz Josef Straße 48 zum Hauptbahnhof“."
