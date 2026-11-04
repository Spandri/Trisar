#!/bin/sh
# Baut die Dispo-App fuer den Simulator (gleiche Fallen wie bei ios-fahrer: Conda, iCloud-Attribute).
set -e
cd "$(dirname "$0")/.."
ABLAGE="$HOME/Library/Developer/Xcode/DerivedData/TrisarDispo-cli"
xattr -cr TrisarDispo ../ios-fahrer/TrisarFahrer
xcodegen generate --quiet
env -i HOME="$HOME" USER="$USER" PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin \
  xcodebuild -project TrisarDispo.xcodeproj -scheme TrisarDispo \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$ABLAGE" -quiet build
echo "$ABLAGE/Build/Products/Debug-iphonesimulator/TRISAR Dispo.app"
