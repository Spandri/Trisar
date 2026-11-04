#!/bin/sh
# Uebernimmt alle SVG-Icons der Web-App (fahrer/public/icon) in den Asset-Katalog.
# Name im Code = Dateiname ohne .svg, z.B. Image("Pin_Nav_Trisar_Icons_01_grau").
# Erneut ausfuehren, wenn in der Web-App Icons dazukommen.
set -e
cd "$(dirname "$0")/.."
QUELLE=../fahrer/public/icon
ZIEL=TrisarFahrer/Assets.xcassets/WebIcons
rm -rf "$ZIEL"; mkdir -p "$ZIEL"
printf '{ "info" : { "author" : "xcode", "version" : 1 } }\n' > "$ZIEL/Contents.json"
find -L "$QUELLE" -name '*.svg' | while read -r datei; do
  name=$(basename "$datei" .svg)
  [ -d "$ZIEL/$name.imageset" ] && continue
  mkdir -p "$ZIEL/$name.imageset"
  cp "$datei" "$ZIEL/$name.imageset/$name.svg"
  printf '{\n  "images" : [ { "filename" : "%s.svg", "idiom" : "universal" } ],\n  "info" : { "author" : "xcode", "version" : 1 },\n  "properties" : { "preserves-vector-representation" : true }\n}\n' "$name" > "$ZIEL/$name.imageset/Contents.json"
done
xattr -cr TrisarFahrer 2>/dev/null || true
echo "$(ls "$ZIEL" | grep -c imageset) Icons übernommen"
