#!/bin/bash
# KI-Assistent: Korrekturen aus der Prüfung vom 16.11. (reports/KI Assistent Prüfung 16.11.md, Gruppe A) auf dem
# MacBook 2018 ausrollen. Vom eigenen Mac starten:
#   bash werkzeuge/ki-pruefung-ausrollen.sh
#
# - Falsch geschriebener Vorname mit gleichem Klang („Stephano“, „Marwin“) wird der richtige Fahrer (namenAngleichen.ts).
#   Unbekannter Name im Dienst-Auftrag („Feierabend für Klaus“): „finde ich nicht“ statt still der Fahrer, um den es
#   zuletzt ging (ki.ts).
# - „Notiz zur Fahrt von Müller: … stornieren“: der Text hinter dem Doppelpunkt ist die Notiz, kein Auftrag
#   (ki.ts, fahrtenKi.ts).
# - „dreiviertel 7“ ist 06:45, „viertel 8“ ist 07:15 (glaetten.ts).
# - „in drei Wochen am Dienstag“, „in zwei Wochen“, „in 10 Tagen“, „übernächsten Freitag“ werden gerechnet
#   (dienst.ts, verstehen.ts).
# - Negativer Stundenlohn wird abgelehnt (lohn.ts).
# - Folgeauftrag ohne Namen ("Dann schick ihr Dienststart …"): nennt den Fahrer beim Namen statt
#   „den markierten Fahrer“, wenn niemand markiert ist (ki.ts, dienst.ts).
# - Rechte, Rollen, Ortung, Abmelden und Fahrer-Tausch: feste ehrliche Antwort statt unsinniger Fahrt-Änderung (ki.ts).
# Vorher prüfen: deno run -A werkzeuge/ki-test/sicherheit-test.ts
#   und: deno run -A werkzeuge/ki-test/mensch-test.ts werkzeuge/ki-test/pruefung-1611/8-korrektur.json
# Kein App-Build. Mehrfach ausführen schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin
for d in ki.ts fahrtenKi.ts lohn.ts glaetten.ts dienst.ts verstehen.ts namenAngleichen.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "Fertig. Im KI-Assistenten z. B. „Dienststart für Tim morgen um viertel 8“ (soll 07:15 ergeben)."
