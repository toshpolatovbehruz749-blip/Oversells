#!/bin/bash
# «InDesignʼda ochish»: run by the helper app «Oversells InDesign» for an
# oversells-indesign://open?ticket=… link from the editor. Downloads the project
# as an InDesign package from Oversells on this computer (the ticket is good for
# one download within two minutes), puts it into
#   ~/Documents/Oversells InDesign/<project>/   (.idml, Links/, Document fonts/)
# and opens the .idml in the newest Adobe InDesign in /Applications.
# Files already in that folder with other names (an .indd you saved) are kept.
#
#   open-in-indesign.sh <link> [port]
set -euo pipefail

link="${1:-}"
port="${2:-${OVERSELLS_PORT:-3000}}"
[[ "$port" =~ ^[0-9]{2,5}$ ]] || { echo "Notoʻgʻri port: $port" >&2; exit 2; }
# Only a ticket is taken from the link: nothing in it is a path, a host or a command.
[[ "$link" =~ ^oversells-indesign://open\?ticket=([A-Za-z0-9_-]{20,64})$ ]] || {
  echo "Bu havola Oversells muharriridan emas." >&2
  exit 2
}
ticket="${BASH_REMATCH[1]}"

indesign="$(ls -d "/Applications/Adobe InDesign "*/"Adobe InDesign "*.app 2>/dev/null | tail -n 1 || true)"
[ -n "$indesign" ] || { echo "Adobe InDesign topilmadi (/Applications ichida)." >&2; exit 3; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsS --max-time 600 -o "$tmp/paket.zip" "http://127.0.0.1:$port/api/idml-ticket/$ticket" || {
  echo "Oversellsdan yuklab boʻlmadi. Tugmani qayta bosing (havola 2 daqiqa ishlaydi)." >&2
  exit 4
}
mkdir "$tmp/x"
/usr/bin/ditto -x -k "$tmp/paket.zip" "$tmp/x"
idml="$(find "$tmp/x" -maxdepth 1 -name '*.idml' | head -n 1)"
[ -n "$idml" ] || { echo "Paketda .idml yoʻq." >&2; exit 4; }
name="$(basename "$idml" .idml)"
dest="$HOME/Documents/Oversells InDesign/$name"
mkdir -p "$dest"
# Merges into the folder: the new .idml, pictures and fonts replace the old ones of the same name.
/usr/bin/ditto "$tmp/x" "$dest"
open -a "$indesign" "$dest/$name.idml"
