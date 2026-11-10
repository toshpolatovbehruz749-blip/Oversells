#!/bin/bash
# «InDesignʼda ochish» / «CorelDRAWʼda ochish»: run by the helper app «Oversells
# Yordamchi» for an oversells-open://open?ticket=… link from the editor (the older
# oversells-indesign:// links too). Downloads the package from Oversells on this
# computer (the ticket is good for one download within two minutes), puts it into
#   ~/Documents/Oversells InDesign/<project>/    (.idml, Links/, Document fonts/)
#   ~/Documents/Oversells CorelDRAW/<project>/   (book and cover PDF, Rasmlar/, Shriftlar/)
# and opens it in the newest InDesign or CorelDRAW in /Applications. Files already
# in that folder with other names (an .indd or .cdr you saved) are kept.
#
#   oversells-open.sh <link> [port]
# OVERSELLS_COREL_APP may name another program for the PDF (used by the tests).
set -euo pipefail

link="${1:-}"
port="${2:-${OVERSELLS_PORT:-3000}}"
[[ "$port" =~ ^[0-9]{2,5}$ ]] || { echo "Notoʻgʻri port: $port" >&2; exit 2; }
# Only a ticket is taken from the link: nothing in it is a path, a host or a command.
[[ "$link" =~ ^oversells-(open|indesign)://open\?ticket=([A-Za-z0-9_-]{20,64})$ ]] || {
  echo "Bu havola Oversells muharriridan emas." >&2
  exit 2
}
ticket="${BASH_REMATCH[2]}"

newest() { ls -d "$@" 2>/dev/null | tail -n 1 || true; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsS --max-time 600 -o "$tmp/paket.zip" "http://127.0.0.1:$port/api/idml-ticket/$ticket" || {
  echo "Oversellsdan yuklab boʻlmadi. Tugmani qayta bosing (havola 2 daqiqa ishlaydi)." >&2
  exit 4
}
mkdir "$tmp/x"
/usr/bin/ditto -x -k "$tmp/paket.zip" "$tmp/x"

if grep -qx 'app=coreldraw' "$tmp/x/.oversells" 2>/dev/null; then
  rm -f "$tmp/x/.oversells"
  app="${OVERSELLS_COREL_APP:-$(newest /Applications/CorelDRAW*/CorelDRAW*.app /Applications/CorelDRAW*.app)}"
  [ -n "$app" ] || { echo "CorelDRAW topilmadi (/Applications ichida)." >&2; exit 3; }
  book="$(find "$tmp/x" -maxdepth 1 -name '*.pdf' ! -name '* - muqova.pdf' | head -n 1)"
  [ -n "$book" ] || { echo "Paketda kitob PDF yoʻq." >&2; exit 4; }
  name="$(basename "$book" .pdf)"
  dest="$HOME/Documents/Oversells CorelDRAW/$name"
  mkdir -p "$dest"
  /usr/bin/ditto "$tmp/x" "$dest"
  open -a "$app" "$dest/$name.pdf"
  exit 0
fi

rm -f "$tmp/x/.oversells"
indesign="$(newest "/Applications/Adobe InDesign "*/"Adobe InDesign "*.app)"
[ -n "$indesign" ] || { echo "Adobe InDesign topilmadi (/Applications ichida)." >&2; exit 3; }
idml="$(find "$tmp/x" -maxdepth 1 -name '*.idml' | head -n 1)"
[ -n "$idml" ] || { echo "Paketda .idml yoʻq." >&2; exit 4; }
name="$(basename "$idml" .idml)"
dest="$HOME/Documents/Oversells InDesign/$name"
mkdir -p "$dest"
# Merges into the folder: the new .idml, pictures and fonts replace the old ones of the same name.
/usr/bin/ditto "$tmp/x" "$dest"
open -a "$indesign" "$dest/$name.idml"
