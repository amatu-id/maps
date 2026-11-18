#!/bin/bash
# Cap versi ke index.html (?v=<hash> pada css/js; cache GitHub Pages ±10 menit) + versi.txt + sw.js (daftar file offline).
set -e
cd "$(dirname "$0")"
for f in js/*.js sw.src.js; do node --check "$f"; done
H=$(cat index.src.html app.css js/*.js sw.src.js | shasum | cut -c1-12)
sed "s/%%VERSI%%/$H/g" index.src.html > index.html
# file list for the service worker: every ?v= asset of index.html plus the page itself
FILES=$(grep -oE '(href|src)="[^"]+\?v='"$H"'"' index.html | sed -E 's/^(href|src)="//; s/"$//' | awk 'BEGIN{printf "[\"./\",\"./index.html\""} {printf ",\"./%s\"", $0} END{printf "]"}')
sed -e "s/%%VERSI%%/$H/g" -e "s#\[/\*FILES\*/\]#$FILES#" sw.src.js > sw.js
node --check sw.js
echo "$H" > versi.txt
echo "versi $H"
