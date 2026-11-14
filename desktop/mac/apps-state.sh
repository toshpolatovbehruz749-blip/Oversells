#!/bin/sh
# Tells Oversells (through desktop/state/, which the app container reads) which
# layout programs this Mac has, so the editor shows «InDesignʼda ochish» and
# «CorelDRAWʼda ochish» only here: desktop/state/indesign and desktop/state/coreldraw
# hold the program's name. They are written only when the helper app «Oversells
# Yordamchi» is installed (desktop/mac/install-app.sh) and the program is in
# /Applications; otherwise removed. The launchers run it on every start.
repo="$(cd "$(dirname "$0")/../.." && pwd)"
state="$repo/desktop/state"
mkdir -p "$state"
if [ "$(uname)" != "Darwin" ]; then
  rm -f "$state/indesign" "$state/coreldraw"
  exit 0
fi
helper=""
for dir in "${OVERSELLS_APP_DIR:-$HOME/Applications}" "$HOME/Applications" /Applications; do
  [ -d "$dir/Oversells Yordamchi.app" ] && helper="$dir/Oversells Yordamchi.app" && break
done
found() { [ -n "$helper" ] && ls -d "$@" 2>/dev/null | tail -n 1; }
write() { if [ -n "$2" ]; then basename "$2" .app >"$state/$1"; else rm -f "$state/$1"; fi; }
write indesign "$(found "/Applications/Adobe InDesign "*/"Adobe InDesign "*.app)"
write coreldraw "$(found /Applications/CorelDRAW*/CorelDRAW*.app /Applications/CorelDRAW*.app)"
