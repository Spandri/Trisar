#!/bin/bash
# KI-Assistent, Sicherheits-Sperren (15.11.). Vom eigenen Mac:
#   bash werkzeuge/ki-sicherheit-ausrollen.sh
#
# - Ausnahme-Sperre: "alle außer Tim" gilt nur, wenn der Satz ein Ausnahme-Wort hat. Antwortet das Modell
#   nicht, fragt er nach, statt die Regeln raten zu lassen (die drehten "bis auf Stefano" zu "nur Stefano").
#   Unbekannter ausgenommener Name: Rueckfrage statt Aktion fuer alle (ki.ts, verstehen.ts).
# - Fehlt die Uhrzeit, nie still die aktuelle Uhrzeit einsetzen. "Jetzt" nur bei heute + jetzt/sofort/Feierabend.
#   "Das Ende rausnehmen" setzt keine Zeit mehr (dienst.ts).
# - Ab 3 Diensten loescht ein blosses "ja" nichts, es braucht "ja, löschen" (dienstAendernKi.ts).
# - Dienst-Vorschlag mit Ausnahme: im Voice-Modus nur per Knopf (nurKnopf, Web KiAssistentView.jsx).
#   iOS und Android haben das mit dem naechsten App-Build.
# Vorher pruefen: deno run -A werkzeuge/ki-test/sicherheit-test.ts
# Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin
for d in ki.ts verstehen.ts dienst.ts dienstAendernKi.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
datei=src/components/views/KiAssistentView.jsx
for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
  scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
done
echo "   KiAssistentView.jsx"
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && $DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei && sleep 8"
echo "Fertig. Dispo neu laden, z. B. „Lösch morgen die Dienste von allen Fahrern“."
