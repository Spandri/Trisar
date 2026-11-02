#!/usr/bin/env bash
#
# Demo auf demo.trisar.de veroeffentlichen.
#
#   ./deploy.sh            nur veroeffentlichen (Texte, Rahmen, Tutorial-Schritte)
#   ./deploy.sh --build    vorher Fahrer- und Dispo-App neu bauen
#
# Setzt dabei die Versionsmarke der Tutorial-Schritte (tutorial-fahrer.js und
# tutorial-dispo.js) auf die aktuelle Zeit.
# Ohne diese Marke liefert Cloudflare die Datei bis zu vier Stunden aus dem
# Cache — geaenderte Tutorial-Texte waeren dann erst Stunden spaeter zu sehen.

set -euo pipefail
cd "$(dirname "$0")"
APPS=..

MIT_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --build) MIT_BUILD=1 ;;
    *) echo "Unbekannte Option: $arg" >&2; exit 1 ;;
  esac
done

if [ "$MIT_BUILD" = "1" ]; then
  echo "→ Fahrer-App bauen"
  (cd "$APPS/fahrer" && VITE_DATENQUELLE=demo npx vite build --base=/fahrer/ >/dev/null)
  rm -rf deploy/fahrer && cp -R "$APPS/fahrer/dist" deploy/fahrer

  echo "→ Dispo-App bauen"
  (cd "$APPS/admin" && VITE_DATENQUELLE=demo npx vite build --base=/admin/ >/dev/null)
  rm -rf deploy/admin && cp -R "$APPS/admin/dist" deploy/admin
fi

# Beide Apps holen Icons und Fahrzeugbilder ueber absolute Pfade (/icon/…,
# /fahrzeuge/…) von der Wurzel der Seite. Neue Dateien aus public/ muessen
# deshalb auch dort liegen — sonst liefert Cloudflare stattdessen die Startseite.
for ordner in icon fahrzeuge support; do
  for app in "$APPS/fahrer" "$APPS/admin"; do
    if [ -d "$app/public/$ordner" ]; then
      mkdir -p "deploy/$ordner"
      rsync -a --exclude '.DS_Store' "$app/public/$ordner/" "deploy/$ordner/"
    fi
  done
done

# Versionsmarke der Tutorial-Schritte auf jetzt setzen.
MARKE="$(date +%Y%m%d-%H%M%S)"
python3 - "$MARKE" <<'PY'
import io, re, sys
marke = sys.argv[1]
pfad = 'deploy/index.html'
inhalt = io.open(pfad, encoding='utf-8').read()
neu = inhalt
gesamt = 0
# Beide Schritt-Dateien muessen eingebunden sein — fehlt eine, abbrechen,
# statt still einen veralteten Stand zu veroeffentlichen.
for datei in ('tutorial-fahrer.js', 'tutorial-dispo.js'):
    muster = r'(' + re.escape(datei) + r'\?v=)[^"\']*'
    neu, treffer = re.subn(muster, r'\g<1>' + marke, neu)
    if treffer == 0:
        raise SystemExit(f'{pfad}: Versionsmarke fuer {datei} nicht gefunden')
    gesamt += treffer
io.open(pfad, 'w', encoding='utf-8').write(neu)
print(f'→ Versionsmarke: {marke} ({gesamt}x)')
PY

# Finder-Reste nicht mit veroeffentlichen.
find deploy -name '.DS_Store' -delete

echo "→ Veroeffentlichen"
# Feste Version: npx sucht sonst gelegentlich eine noch nicht veroeffentlichte und bricht ab.
npx -y wrangler@4.156.1 pages deploy deploy --project-name=trisar-demo --branch=main
