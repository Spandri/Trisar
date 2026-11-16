#!/bin/bash
# KI-Assistent: Befunde aus dem Härtetest (15.11. nachts). Vom eigenen Mac:
#   bash werkzeuge/ki-haerte-ausrollen.sh
# Enthält auch die Frist-Korrektur aus ki-frist-ausrollen.sh, das braucht es dann nicht mehr.
#
# Sicherheit:
# - Bestätigungs-Sperre: Als „ja“ zählt nur ein Satz ohne weiteren Inhalt („ja“, „ja, löschen“, „ok mach das“).
#   Vorher wertete jede Regel nur das erste Wort: „Bitte gib Tim morgen 7 Uhr Dienststart“ löschte den Dienst,
#   nach dem gerade gefragt war. Ein neuer Satz verwirft jetzt die offene Rückfrage und wird neu gelesen (ki.ts).
# - Nur was im Satz steht: Zeiten und „alle“ ohne Grundlage im Satz gelten nicht („Und für Anna auch“ ergab
#   00:00 bis 23:59 für alle Fahrer) (verstehen.ts).
# - Unmögliche Angaben: „25 Uhr“, „30.02.“, „Pause von 12 bis 11“ werden abgelehnt statt umgedeutet (glaetten.ts).
#   Neue Fahrt in der Vergangenheit bekommt eine Warnung (ki.ts).
# - Frist wieder 20 s, Sperre erst nach zwei Abbrüchen, kein halber Vorschlag bei Abbruch (verstehen.ts, ki.ts).
# Formulierungen:
# - Zuordnen, Gast anlegen und Standby liest das Modell aus und baut den festen Befehl: „Ordne Marvin das Auto
#   M-TR 103 zu“, „Marvin fährt den BMW X5“, „Tim soll von 10 bis 18 am Bayerischen Hof bereitstehen“ (verstehen.ts).
# - „Braucht Frau Weber einen Kindersitz“ antwortet aus den Gästedaten (weitereKi.ts).
# - „Schreib allen, dass morgen frei ist“ ist eine Nachricht. Ausgenommene stehen nicht mehr im Push-Text.
# - Nachts vor 05:00 meint der heutige Wochentag heute (dienst.ts, verstehen.ts).
# Nachtrag 16.11.:
# - „Dienstende heute 24 Uhr“, „von 16 bis 24 Uhr“: 24 Uhr als Ende ist 00:00. Als Beginn fragt er nach (glaetten.ts).
# - „Gib Tim den BMW“: Marke oder Modell statt Kennzeichen. Bei mehreren Fahrzeugen fragt er, welches,
#   „den X5“ oder das Kennzeichen wählt aus (zuordnenKi.ts, ki.ts).
# - Frage mit „er“, „sie“, „der“ ohne jeden Bezug: „Wen meinst du?“ statt geratenem Fahrer (ki.ts, freiKi.ts).
#   „Wo ist der Band“: unbekannter Name wird gesagt, nicht der zuletzt besprochene Fahrer genommen (kiKern.js).
# - Heutiger Wochentag beim Löschen, Ändern und Fragen meint heute, nicht den in 7 Tagen (verstehen.ts).
# - „Kein Fahrer hat am Mo 23.11. einen Dienst“ statt doppelter Verneinung (dienstAendernKi.ts).
# - „Bekommt Tim den BMW“, „Wer fährt den X5“: Antwort aus den Daten statt vom freien Modell (kiKern.js).
# Vorher prüfen: deno run -A werkzeuge/ki-test/sicherheit-test.ts
# Kein App-Build. Mehrfach ausführen schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin
for d in ki.ts kiKern.js verstehen.ts dienst.ts absicht.ts freiKi.ts glaetten.ts weitereKi.ts zuordnenKi.ts dienstAendernKi.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "Fertig. Im KI-Assistenten z. B. „Lösch den Dienst von Anna morgen“, dann statt ja einen neuen Auftrag."
