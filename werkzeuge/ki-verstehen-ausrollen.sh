#!/bin/bash
# KI-Assistent: Verstehen, Regeln zuerst, Ausfall-Sicherung (15.11. nachts). Vom eigenen Mac:
#   bash werkzeuge/ki-verstehen-ausrollen.sh
#
# Verstehen (aus dem ki_protokoll und dem Test wie in der App, werkzeuge/ki-test/mensch-test.ts):
# - "Pause von 12 bis 12:30" setzt kein Dienstende mehr auf die aktuelle Uhrzeit. "Tim macht jetzt Pause" geht (dienst.ts).
# - Getipptes "Ja" oder "Nein" ohne offene Rückfrage: feste Antwort statt erfundenem "wird gebucht" (ki.ts).
# - Auftrag, den keine Regel ausführen kann: ehrlich "nichts geändert" statt Antwort vom freien Modell (ki.ts).
# - Zwei Dienst-Aufträge in einem Satz: der erste wird bearbeitet, der zweite genannt (ki.ts).
# - Neue Fahrt nach verstandener Absicht, auch wenn kein Muster passt: "am Flughafen ... zum ...",
#   "alle Fahrer außer Marvin von ... zum ... um 14:30", zweite Fahrt statt Änderung der ersten (kiKern.js, absicht.ts).
# - "um halb 4", "für herrn engel" klein getippt, "Heute" ist kein Ziel mehr (absicht.ts, kiKern.js).
# - "am Montag" ist der nächste Montag, "morgn", "Dienst statt" werden geglättet (verstehen.ts, glaetten.ts neu).
# - Gruß und "Kannst du mich hören" ohne Modell, Anrede du (ki.ts, kiKern.js, freiKi.ts).
# Regeln zuerst: Im Frei-Modus antworten erst Regeln und gerechnete Antworten, dann das freie Modell (ki.ts, kiKern.js).
# Ausfall: Nach einer gerissenen Frist wird das Modell 2 Minuten übersprungen, Fristen 12 s statt 20 s,
#   bei ausgeschaltetem Rechner antworten die Regeln weiter (verstehen.ts, ki.ts, freiKi.ts).
# Vorher prüfen: deno run -A werkzeuge/ki-test/sicherheit-test.ts
# Kein App-Build. Mehrfach ausführen schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin
for d in ki.ts kiKern.js verstehen.ts dienst.ts absicht.ts freiKi.ts glaetten.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "Fertig. Im KI-Assistenten z. B. „Pause für Tim heute von 13 bis 13:30“ oder „Hallo“."
