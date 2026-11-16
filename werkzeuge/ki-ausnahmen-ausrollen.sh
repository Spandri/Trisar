#!/bin/bash
# KI-Assistent versteht Ausnahmen frei formuliert ("allen bis auf Stefano", "alle außer Tim und Lisa",
# "Feierabend für alle, nur Marvin nicht", "alle außer den markierten"). Das Modell liest sie mit der Absicht
# (verstehen.ts, Feld ausser), ki.ts legt sie je Anfrage ab (ausnahmen.ts), alleFahrer/genannteFahrer lassen sie weg.
# Gilt fuer Dienst setzen/loeschen, Nachricht, Stundenlohn, Stundenzettel, Fahrzeug je Fahrer. Vorschlag nennt
# "(ohne …)". 15.11.: Datum (Wochentag nie Vergangenheit, nachts "morgen" = heute, Datumsgrenze), Änderung als
# offene Anfrage (Fahrer bestätigt), Dienstfragen aus Daten, num_ctx 4096 überall (kein Neuladen am Mac mini).
# Kein App-Build. Mehrfach ausfuehren schadet nicht. Vom eigenen Mac:
#   bash werkzeuge/ki-ausnahmen-ausrollen.sh
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin
for d in ausnahmen.ts verstehen.ts ki.ts dienst.ts lohn.ts steuernKi.ts anlegen.ts dienstAendernKi.ts fragenKi.ts kiKern.js standbyKi.ts fahrtenKi.ts freiKi.ts import.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "Fertig. Im KI-Assistenten z. B. „Schick allen bis auf Stefano Dienstbeginn heute 13:30“."
