#!/bin/zsh
# Baut Fahrer- und/oder Dispo-App fuer ein per Kabel verbundenes iPhone und spielt sie auf.
# Kostenloses Personal Team: eigene Bundle-IDs mit .dev, damit die echten IDs fuer
# TestFlight frei bleiben. Die Apps laufen damit 7 Tage, danach neu aufspielen.
#
#   werkzeuge/aufs-iphone.sh            beide Apps
#   werkzeuge/aufs-iphone.sh fahrer     nur Fahrer-App
#   werkzeuge/aufs-iphone.sh dispo      nur Dispo-App
#
# TEAM und IPHONE_UDID koennen von aussen gesetzt werden.
set -e
TEAM=${TEAM:-LB3DZM6U3A}
REPO=${0:A:h:h}
WAS=${1:-beide}

# Geraetename hat Leerzeichen, darum die Kennung per Muster holen.
UDID=${IPHONE_UDID:-$(xcrun devicectl list devices 2>/dev/null | grep -E 'iPhone.*(connected|available)' | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' | head -1)}
[ -n "$UDID" ] || { echo "Kein iPhone verbunden."; exit 1; }
HW_UDID=$(xcrun devicectl device info details --device "$UDID" 2>/dev/null | grep -o 'udid: [0-9A-Fa-f-]*' | head -1 | cut -d' ' -f2)

baue() {
  local ordner=$1 projekt=$2 schema=$3 bundle=$4 dd=$5
  echo "== $schema -> $bundle"
  cd "$REPO/$ordner"
  xattr -cr . ../ios-fahrer/TrisarFahrer 2>/dev/null || true
  xcodegen generate --quiet
  env -i HOME=$HOME USER=$USER PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin \
    xcodebuild -project "$projekt" -scheme "$schema" -configuration Debug \
      -destination "id=$HW_UDID" -derivedDataPath "$HOME/Library/Developer/Xcode/DerivedData/$dd" \
      -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM" PRODUCT_BUNDLE_IDENTIFIER="$bundle" \
      CODE_SIGN_STYLE=Automatic -quiet build
  local app=$(ls -d "$HOME/Library/Developer/Xcode/DerivedData/$dd/Build/Products/Debug-iphoneos/"*.app | head -1)
  xattr -cr "$app"
  xcrun devicectl device install app --device "$UDID" "$app"
}

[[ $WAS == beide || $WAS == fahrer ]] && baue ios-fahrer TrisarFahrer.xcodeproj TrisarFahrer de.trisar.fahrer.dev TrisarFahrer-iphone
[[ $WAS == beide || $WAS == dispo ]] && baue ios-dispo TrisarDispo.xcodeproj TrisarDispo de.trisar.dispo.dev TrisarDispo-iphone
echo "Fertig. Beim ersten Start am iPhone: Einstellungen > Allgemein > VPN & Geraeteverwaltung > Entwickler-App vertrauen."
