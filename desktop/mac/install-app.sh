#!/usr/bin/env bash
# Creates Oversells.app (with its icon) in ~/Applications, so Oversells is in
# Launchpad, Spotlight and can be kept in the Dock. Clicking it starts Docker
# Desktop if needed, starts Oversells and opens it in its own window.
#
#   bash desktop/mac/install-app.sh
#
# Run it again after moving the Oversells folder. Set OVERSELLS_APP_DIR to
# install somewhere else (e.g. /Applications).
set -euo pipefail

[ "$(uname)" = "Darwin" ] || { echo "Bu skript faqat macOS uchun / macOS only" >&2; exit 1; }

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
apps="${OVERSELLS_APP_DIR:-$HOME/Applications}"
app="$apps/Oversells.app"

mkdir -p "$apps"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$here/Oversells.icns" "$app/Contents/Resources/Oversells.icns"

cat > "$app/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Oversells</string>
  <key>CFBundleDisplayName</key><string>Oversells</string>
  <key>CFBundleIdentifier</key><string>uz.oversells.desktop</string>
  <key>CFBundleExecutable</key><string>Oversells</string>
  <key>CFBundleIconFile</key><string>Oversells</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
EOF

# The launcher: the Oversells folder is written in at install time.
{
  echo '#!/bin/bash'
  printf 'REPO=%q\n' "$repo"
  cat <<'EOF'
# Apps started from Finder get a minimal PATH; add where Docker and Homebrew live.
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
URL="http://localhost:${APP_PORT:-3000}"
LOG="$HOME/Library/Logs/Oversells.log"
mkdir -p "$(dirname "$LOG")"

notify() { osascript -e "display notification \"$1\" with title \"Oversells\"" >/dev/null 2>&1 || true; }
fail() {
  osascript -e "display dialog \"$1\" with title \"Oversells\" buttons {\"OK\"} default button 1 with icon stop" >/dev/null 2>&1
  exit 1
}
ready() { curl -fs "$URL/api/ready" >/dev/null 2>&1; }
show() {
  if [ -d "/Applications/Google Chrome.app" ]; then open -na "Google Chrome" --args --app="$URL"; else open "$URL"; fi
  exit 0
}

# Which InDesign this Mac has, for «InDesignʼda ochish» (read by the app on every request).
sh "$REPO/desktop/mac/indesign-state.sh" >/dev/null 2>&1 || true
ready && show
[ -f "$REPO/docker-compose.desktop.yml" ] || fail "Oversells papkasi topilmadi: $REPO. Papkani koʻchirgan boʻlsangiz, desktop/mac/install-app.sh ni qayta ishga tushiring."
command -v docker >/dev/null 2>&1 || fail "Docker Desktop oʻrnatilmagan. Uni docker.com saytidan yuklab oʻrnating."

if ! docker info >/dev/null 2>&1; then
  notify "Docker ishga tushirilmoqda…"
  open -a Docker
  for _ in $(seq 1 150); do docker info >/dev/null 2>&1 && break; sleep 2; done
  docker info >/dev/null 2>&1 || fail "Docker ishga tushmadi. Docker Desktop ni oching va qayta urinib koʻring."
fi

cd "$REPO" || fail "Oversells papkasi ochilmadi: $REPO"
# Rebuild only when the code changed (git pull) or an image is missing: checking
# the build on every start costs Docker Desktop many seconds.
STAMP="$HOME/Library/Application Support/Oversells/built-rev"
mkdir -p "$(dirname "$STAMP")"
rev="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || true)"
images=true
docker image inspect oversells-app:latest oversells-texlive:latest >/dev/null 2>&1 || images=false
build=--build
if $images && [ -n "$rev" ] && [ "$rev" = "$(cat "$STAMP" 2>/dev/null)" ]; then build=; fi
if ! $images; then
  notify "Birinchi ishga tushirish: 15–30 daqiqa. Tayyor boʻlganda oʻzi ochiladi."
elif [ -n "$build" ]; then
  notify "Yangi versiya oʻrnatilmoqda (bir necha daqiqa)…"
else
  notify "Oversells ishga tushirilmoqda…"
fi
# Daily backups of all projects land here (Documents/Oversells zaxira).
export OVERSELLS_BACKUP_DIR="$HOME/Documents/Oversells zaxira"
mkdir -p "$OVERSELLS_BACKUP_DIR"
echo "=== $(date) ===" >>"$LOG"
# shellcheck disable=SC2086
if ! docker compose -f docker-compose.desktop.yml up -d $build >>"$LOG" 2>&1; then
  # A rebuild needs Docker Hub (ubuntu, node). Without it, build on top of the
  # installed image instead; if even that fails, the old version still works.
  [ -n "$build" ] && $images || fail "Ishga tushirishda xato. Batafsil: ~/Library/Logs/Oversells.log"
  if sh "$REPO/desktop/update-offline.sh" >>"$LOG" 2>&1; then
    :
  else
    notify "Yangi versiyani yigʻib boʻlmadi (Docker Hub ga ulanib boʻlmadi). Oldingi versiya ochilmoqda."
    build=
    docker compose -f docker-compose.desktop.yml up -d --no-build >>"$LOG" 2>&1 ||
      fail "Ishga tushirishda xato. Batafsil: ~/Library/Logs/Oversells.log"
  fi
fi
[ -n "$build" ] && [ -n "$rev" ] && echo "$rev" >"$STAMP"
for _ in $(seq 1 900); do ready && show; sleep 2; done
fail "Oversells javob bermayapti. Batafsil: ~/Library/Logs/Oversells.log"
EOF
} > "$app/Contents/MacOS/Oversells"
chmod 0755 "$app/Contents/MacOS/Oversells"

# Make Finder, Launchpad and the Dock pick up the new icon.
touch "$app"
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
"$lsregister" -f "$app" >/dev/null 2>&1 || true

# «Oversells InDesign»: a small helper without a window that opens oversells-indesign://
# links from the editor («InDesignʼda ochish»): it downloads the project as an InDesign
# package and opens it in InDesign (desktop/mac/open-in-indesign.sh, copied into it).
helper="$apps/Oversells InDesign.app"
rm -rf "$helper"
if ls -d "/Applications/Adobe InDesign "*/"Adobe InDesign "*.app >/dev/null 2>&1; then
  src="$(mktemp -d)/helper.applescript"
  cat >"$src" <<'EOF'
on open location theURL
	set script_ to POSIX path of (path to resource "open-in-indesign.sh")
	set port_ to do shell script "cat " & quoted form of POSIX path of (path to resource "port")
	try
		do shell script "/bin/bash " & quoted form of script_ & " " & quoted form of theURL & " " & quoted form of port_
	on error errorText
		display dialog errorText with title "Oversells → InDesign" buttons {"OK"} default button 1 with icon caution
	end try
end open location

on run
	display dialog "Bu yordamchi Oversells muharriridagi «InDesignʼda ochish» tugmasi uchun: oʻzi ochiladi." with title "Oversells InDesign" buttons {"OK"} default button 1
end run
EOF
  osacompile -o "$helper" "$src"
  cp "$here/open-in-indesign.sh" "$helper/Contents/Resources/open-in-indesign.sh"
  echo "${APP_PORT:-3000}" >"$helper/Contents/Resources/port"
  plist="$helper/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier uz.oversells.indesign" "$plist" 2>/dev/null ||
    /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string uz.oversells.indesign" "$plist"
  /usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" \
    -c "Add :CFBundleURLTypes:0 dict" \
    -c "Add :CFBundleURLTypes:0:CFBundleURLName string uz.oversells.indesign" \
    -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" \
    -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string oversells-indesign" "$plist"
  cp "$here/Oversells.icns" "$helper/Contents/Resources/applet.icns"
  # Info.plist and Resources changed after osacompile signed it: sign it again (ad hoc).
  codesign --force --deep --sign - "$helper" >/dev/null 2>&1 || true
  touch "$helper"
  "$lsregister" -f "$helper" >/dev/null 2>&1 || true
  echo "«InDesignʼda ochish» yordamchisi oʻrnatildi: $helper"
fi
sh "$here/indesign-state.sh" || true

echo "Tayyor: $app"
echo "Launchpad yoki Spotlight (⌘ + Probel) orqali «Oversells» ni oching."
echo "Dock'da qoldirish: ilova ochiq turganda uning belgisini o'ng tugma bilan bosing → Options → Keep in Dock."
open -R "$app" 2>/dev/null || true
