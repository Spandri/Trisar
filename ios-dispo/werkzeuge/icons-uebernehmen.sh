#!/bin/sh
# Alle SVG-Icons der Dispo-Web-App (admin/public/icon) in den Asset-Katalog. Name = Dateiname.
set -e
cd "$(dirname "$0")/.."
QUELLE=../admin/public/icon
ZIEL=TrisarDispo/Assets.xcassets/WebIcons
rm -rf "$ZIEL"; mkdir -p "$ZIEL"
printf '{ "info" : { "author" : "xcode", "version" : 1 } }\n' > "$ZIEL/Contents.json"
find -L "$QUELLE" -name '*.svg' | while read -r datei; do
  name=$(basename "$datei" .svg)
  [ -d "$ZIEL/$name.imageset" ] && continue
  mkdir -p "$ZIEL/$name.imageset"
  cp "$datei" "$ZIEL/$name.imageset/$name.svg"
  printf '{\n  "images" : [ { "filename" : "%s.svg", "idiom" : "universal" } ],\n  "info" : { "author" : "xcode", "version" : 1 },\n  "properties" : { "preserves-vector-representation" : true }\n}\n' "$name" > "$ZIEL/$name.imageset/Contents.json"
done
xattr -cr TrisarDispo 2>/dev/null || true
echo "$(ls "$ZIEL" | grep -c imageset) Icons übernommen"
