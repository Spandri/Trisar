#!/bin/zsh
# Baut eine iOS-App als Release und laedt sie zu App Store Connect (TestFlight) hoch.
# Aufruf: zsh werkzeuge/ios-hochladen.sh fahrer|dispo
# Vorher CURRENT_PROJECT_VERSION in ios-<app>/project.yml hochzaehlen.
set -e
HIER="$(cd "$(dirname "$0")/.." && pwd)"
case "$1" in
  fahrer) ORDNER=ios-fahrer; PROJEKT=TrisarFahrer ;;
  dispo)  ORDNER=ios-dispo;  PROJEKT=TrisarDispo ;;
  *) echo "Aufruf: $0 fahrer|dispo"; exit 1 ;;
esac
ABLAGE="${TMPDIR:-/tmp}/trisar-hochladen/$PROJEKT"
rm -rf "$ABLAGE"; mkdir -p "$ABLAGE"
cat > "$ABLAGE/export.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>upload</string>
<key>teamID</key><string>LB3DZM6U3A</string>
<key>signingStyle</key><string>automatic</string>
</dict></plist>
PLIST
SAUBER=(env -i HOME="$HOME" USER="$USER" PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin)
cd "$HIER/$ORDNER"
xattr -cr . 2>/dev/null || true
$SAUBER xcodegen generate --quiet
$SAUBER xcodebuild -project "$PROJEKT.xcodeproj" -scheme "$PROJEKT" -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ABLAGE/$PROJEKT.xcarchive" \
  -derivedDataPath "$HOME/Library/Developer/Xcode/DerivedData/$PROJEKT-release" \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=LB3DZM6U3A CODE_SIGN_STYLE=Automatic -quiet archive
$SAUBER xcodebuild -exportArchive -archivePath "$ABLAGE/$PROJEKT.xcarchive" \
  -exportOptionsPlist "$ABLAGE/export.plist" -exportPath "$ABLAGE/export" -allowProvisioningUpdates
echo "HOCHGELADEN $PROJEKT"
