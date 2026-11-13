#!/bin/bash
# KI-Assistent Fehlgriffe (13.11., aus werkzeuge/ki-test/abdeckung.ts). Vom eigenen Mac starten:
#   bash werkzeuge/ki-fehlgriffe-ausrollen.sh
#
# dispo-admin: weitereKi.ts (neu: Standby anzeigen, loeschen, verschieben mit "ja", Gaeste-Fragen Telefon/E-Mail/Firma/
# Adresse/Hinweise, Fahrer-Telefon direkt, Kunde/Gast/Ort anlegen ehrlich statt Fahrzeug-Karte), dienst.ts (ganze Woche
# "jeden Tag"/"werktags", Nachricht mit Uhrzeit ist kein Dienst), dienstAendernKi.ts (alle Dienste einer Woche loeschen),
# ki.ts (Reihenfolge). Kein App-Build, keine Migration. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin
for d in weitereKi.ts dienst.ts dienstAendernKi.ts fragenKi.ts ki.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "Fertig. Im KI-Assistenten z. B. „Welche Standbys gibt es morgen?“ oder „Plan Tim nächste Woche werktags 8 bis 16“."
