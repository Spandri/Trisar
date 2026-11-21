#!/bin/bash
# Import erkennt Rueckfahrten (21.11.2026): Spalte "Abfahrt Zielort"/"Rückfahrt" (Zeit, Zeitraum oder ja),
# "Rückkehrort", "hin und zurück" in der Bemerkung -> je Zeile Hinfahrt + Rueckfahrt.
# Dazu: Ziel aus "Ziel Adresse komplett" bzw. Ziel Straße/PLZ/Ort, "Prof. Buck" als Gast, Kunde als Firma,
# Rueckkehrzeit und Fahrzeit werden erkannt und nicht uebernommen.
#
# Nimmt den Import-Stand vom 18.11. mit (import-felder-ausrollen.sh lief nie, Server stand am 21.11. davor):
# Zeitraum, Zwischenstopps, Orte, Gaeste, Konvoi, mehrere Fahrer, Zug, storniert. DB-Spalten dafuer sind live.
#
# Aufruf: bash werkzeuge/rueckfahrt-import-ausrollen.sh
#   1. Funktion dispo-admin: import.ts + importKern.js
#   2. Web-Dispo: ImportView, importKern (Kopie)
#   3. Web-Dispo i18n (6 Sprachen): nur fehlende imp.*-Texte in die Server-Datei einfuegen. Der Rest der
#      lokalen i18n (andere, noch nicht ausgerollte Funktionen) bleibt draussen.
# iOS-/Android-Dispo: nur neue Texte (Feldnamen, Hinweis "Rückfahrt"), kommen mit dem naechsten Build.
# import.ts: lokales "think: false" (KI-Umbau) geht nicht mit raus.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=fahrer/supabase/functions/dispo-admin
MUX="-o ControlMaster=auto -o ControlPath=/tmp/trisar-ausrollen-%C -o ControlPersist=120"
ssh() { command ssh $MUX "$@"; }
scp() { command scp $MUX "$@"; }

cmp -s "$HIER/$FN/importKern.js" "$HIER/admin/src/services/importKern.js" || { echo "importKern.js: Server- und Web-Kopie weichen ab. Abbruch."; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
sha() { shasum "$1" | awk '{print $1}'; }
sed 's/stream: false, think: false, format/stream: false, format/' "$HIER/$FN/import.ts" > "$TMP/import.ts"

FZ=("$R/fahrer-app-lokal/supabase/functions/dispo-admin" "$R/trisar/$FN")
WZ=("$R/fahrer-app-lokal/.docker-sync/admin" "$R/trisar/admin")
# Datei, alter Server-Stand (21.11. geprueft), neue Quelle
DATEIEN_F=(
  "import.ts a6e88bbdbe99f7236d335ce4de4cb76733e987b2 $TMP/import.ts"
  "importKern.js e6738130439709176a55d77755d69cd4335b58b9 $HIER/$FN/importKern.js"
)
DATEIEN_W=(
  "src/components/views/ImportView.jsx b24ea2e1294a578b7d81b333c733d9e72bbc3a9f $HIER/admin/src/components/views/ImportView.jsx"
  "src/services/importKern.js e6738130439709176a55d77755d69cd4335b58b9 $HIER/admin/src/services/importKern.js"
)

pruefen() { # ziel alt neu
  local jetzt; jetzt=$(ssh "$SERVER" "shasum \"$1\" 2>/dev/null || true" | awk '{print $1}')
  if [[ "$jetzt" != "$2" && "$jetzt" != "$(sha "$3")" ]]; then echo "Auf dem Server liegt in $1 ein anderer Stand als erwartet. Abbruch."; exit 1; fi
}

echo "Pruefen"
for z in "${FZ[@]}"; do for e in "${DATEIEN_F[@]}"; do set -- $e; pruefen "$z/$1" "$2" "$3"; done; done
for z in "${WZ[@]}"; do for e in "${DATEIEN_W[@]}"; do set -- $e; pruefen "$z/$1" "$2" "$3"; done; done

echo "1/3 Funktion dispo-admin"
for z in "${FZ[@]}"; do for e in "${DATEIEN_F[@]}"; do set -- $e; scp -q "$3" "$SERVER:$z/$1"; done; done

echo "2/3 Web-Dispo"
for e in "${DATEIEN_W[@]}"; do
  set -- $e
  for z in "${WZ[@]}"; do scp -q "$3" "$SERVER:$z/$1"; done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$1" 2>/dev/null || true
done

echo "3/3 Texte (imp.*)"
for l in de en fr it es tr; do
  for z in "${WZ[@]}"; do
    scp -q "$SERVER:$z/src/i18n/$l.js" "$TMP/server.js"
    python3 - "$HIER/admin/src/i18n/$l.js" "$TMP/server.js" <<'PY'
import re, sys
lokal = open(sys.argv[1], encoding='utf-8').read().split('\n')
server = open(sys.argv[2], encoding='utf-8').read().split('\n')
schl = lambda z: (m.group(1) if (m := re.match(r'\s*"([^"]+)":', z)) else None)
da = {schl(z) for z in server if schl(z)}
neu = 0
for i, z in enumerate(lokal):
    k = schl(z)
    if not k or not k.startswith('imp.') or k in da:
        continue
    # hinter den naechsten Vorgaenger, den es auf dem Server gibt
    pos = None
    for j in range(i - 1, -1, -1):
        v = schl(lokal[j])
        if v in da:
            pos = next(n for n, s in enumerate(server) if schl(s) == v)
            break
    if pos is None:
        sys.exit('kein Ankerpunkt fuer ' + k)
    server.insert(pos + 1, z)
    da.add(k)
    neu += 1
open(sys.argv[2], 'w', encoding='utf-8').write('\n'.join(server))
print(neu)
PY
    node --check "$TMP/server.js" 2>/dev/null || node -e "import('$TMP/server.js')" >/dev/null || { echo "$l.js nach dem Einfuegen fehlerhaft. Abbruch."; exit 1; }
    scp -q "$TMP/server.js" "$SERVER:$z/src/i18n/$l.js"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/src/i18n/$l.js" 2>/dev/null || true
done
echo "Fertig."
