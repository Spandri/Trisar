#!/bin/bash
# N schlanke iOS-Simulatoren "TRISAR Fahrer 1..N" mit der Fahrer-App (simslim, brew install mobai-app/tap/simslim).
#   bash werkzeuge/sims-fahrer.sh [Anzahl, Standard 6]
# Baut die App fuer den Simulator, legt fehlende Simulatoren an, macht sie schlank (Push bleibt an),
# installiert und startet die App. Mehrfach ausfuehren schadet nicht.
# ACHTUNG: Nur Testkonten anmelden. Steht ein Konto auf Ortung 'app', schreibt der Simulator
# seinen erfundenen Standort in die Live-Datenbank.
set -euo pipefail

N="${1:-6}"
HIER="$(cd "$(dirname "$0")/.." && pwd)"
DD=/private/tmp/claude-501/dd-fahrer-sim
GERAET="iPhone 17"
RUNTIME=$(xcrun simctl list runtimes | grep -oE 'com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9-]+' | sort -V | tail -1)

cd "$HIER/ios-fahrer"
env -i HOME="$HOME" USER="$USER" PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" xcodegen generate -q
env -i HOME="$HOME" USER="$USER" PATH="/usr/bin:/bin:/usr/sbin:/sbin" xcodebuild -project TrisarFahrer.xcodeproj \
  -scheme TrisarFahrer -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$DD" build 2>&1 | grep -E "error:|BUILD" | tail -3
APP="$DD/Build/Products/Debug-iphonesimulator/TRISAR.app"
BUNDLE=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Info.plist")

open -a Simulator
for i in $(seq 1 "$N"); do
  NAME="TRISAR Fahrer $i"
  UDID=$(xcrun simctl list devices | grep -F "$NAME (" | grep -oE '[0-9A-F-]{36}' | head -1 || true)
  [[ -n "$UDID" ]] || UDID=$(xcrun simctl create "$NAME" "$GERAET" "$RUNTIME")
  echo "== $NAME ($UDID)"
  # Erst sicher hochfahren, sonst scheitert simslim an einem halb gebooteten Simulator.
  xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || true
  simslim on "$UDID" --except store | tail -1 || { sleep 10; simslim on "$UDID" --except store | tail -1; }
  xcrun simctl install "$UDID" "$APP"
  xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
done
echo "Fertig. Speicher: simslim top"
