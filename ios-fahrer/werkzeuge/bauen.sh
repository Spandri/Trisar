#!/bin/sh
# Baut die App fuer den Simulator. Umgeht zwei Fallen auf diesem Mac:
#  - Conda setzt LD/CC auf eigene Werkzeuge -> Build mit sauberer Umgebung (env -i)
#  - iCloud haengt Attribute an Dateien in Documents -> CodeSign scheitert -> xattr -cr
# Aufruf: werkzeuge/bauen.sh   (danach liegt TRISAR.app unter $ABLAGE)
set -e
cd "$(dirname "$0")/.."
ABLAGE="$HOME/Library/Developer/Xcode/DerivedData/TrisarFahrer-cli"
xattr -cr TrisarFahrer
xcodegen generate --quiet
env -i HOME="$HOME" USER="$USER" PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin \
  xcodebuild -project TrisarFahrer.xcodeproj -scheme TrisarFahrer \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$ABLAGE" -quiet build
echo "$ABLAGE/Build/Products/Debug-iphonesimulator/TRISAR.app"
