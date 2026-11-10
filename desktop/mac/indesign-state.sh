#!/bin/sh
# Tells Oversells (through desktop/state/indesign, which the app container reads)
# which InDesign this Mac has, so the editor shows «InDesignʼda ochish» only here.
# The file is written only when the helper app «Oversells InDesign» is installed
# (desktop/mac/install-app.sh) and InDesign is in /Applications; otherwise removed.
# The launchers run it on every start.
repo="$(cd "$(dirname "$0")/../.." && pwd)"
state="$repo/desktop/state"
mkdir -p "$state"
[ "$(uname)" = "Darwin" ] || { rm -f "$state/indesign"; exit 0; }
indesign="$(ls -d "/Applications/Adobe InDesign "*/"Adobe InDesign "*.app 2>/dev/null | tail -n 1)"
helper=""
for dir in "${OVERSELLS_APP_DIR:-$HOME/Applications}" "$HOME/Applications" /Applications; do
  [ -d "$dir/Oversells InDesign.app" ] && helper="$dir/Oversells InDesign.app" && break
done
if [ -n "$indesign" ] && [ -n "$helper" ]; then
  basename "$indesign" .app >"$state/indesign"
else
  rm -f "$state/indesign"
fi
