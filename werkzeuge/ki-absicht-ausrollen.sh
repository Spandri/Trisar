#!/bin/bash
# KI-Assistent: Fahrt schlaegt Dienst, Dienste loeschen, mehrere Tage, alle Fahrer (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/ki-absicht-ausrollen.sh
#
# dispo-admin: absicht.ts (neu, klarer Fahrtauftrag geht direkt zur Buchung, "Start in X, Ende in Y" wird
# "von X nach Y"), dienstAendernKi.ts (neu, Dienst/Dienstende/Dienststart/Pause loeschen mit "ja", mehrere
# Dienste mit "ja"), namenKi.ts (neu, reine Namensliste fragt nach), dienst.ts (Start/Ende vor Ort zaehlen
# nicht als Dienst, "dienstart", "alle Fahrer", mehrere Tage, ausdruecklicher Dienststart bleibt Start,
# Genitiv "Stefanos", Zahl nach Dienststart/Ende, "Tim kommt um 7", "bis 16 Uhr", Uhrzeit mitten im Dienst fragt nach),
# fragenKi.ts ("Hat Anna morgen Dienst?"), ki.ts (Reihenfolge, Fahrt mit allen Fahrern), anlegen.ts (ein Fahrzeug je Fahrer,
# beim Bestaetigen zugeordnet). Web-Dispo: KiAssistentView.jsx (Fahrer auf der Fahrzeug-Karte, "Ohne Fahrer").
# iOS und Android zeigen den Fahrer erst mit dem naechsten App-Build, legen aber schon jetzt mit Zuordnung an.
# Keine Migration. Mehrfach ausfuehren schadet nicht.

set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin

for d in absicht.ts dienstAendernKi.ts namenKi.ts dienst.ts fragenKi.ts ki.ts anlegen.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

datei=src/components/views/KiAssistentView.jsx
for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
  scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
done
ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei"
echo "   admin/$datei"
echo "Fertig. Im KI-Assistenten z. B. „Neue Fahrt Stefano am Samstag um 11:58 Start in Offenburg am Bahnhof, Ende in München Möhlstr 31“."
