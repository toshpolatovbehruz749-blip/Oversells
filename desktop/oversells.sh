#!/usr/bin/env bash
# Oversells — start on macOS or Linux (needs Docker Desktop / Docker Engine).
# macOS: double-click desktop/Oversells.command, which runs this script.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker ishga tushirilmoqda..."
  if [ "$(uname)" = "Darwin" ]; then open -a Docker; fi
  until docker info >/dev/null 2>&1; do sleep 3; done
fi

# Daily backups of all projects land here.
export OVERSELLS_BACKUP_DIR="${OVERSELLS_BACKUP_DIR:-$HOME/Documents/Oversells zaxira}"
mkdir -p "$OVERSELLS_BACKUP_DIR"
# The app runs as an unprivileged user inside the container (Linux needs this; macOS maps owners itself).
[ "$(uname)" = "Linux" ] && chmod a+rwx "$OVERSELLS_BACKUP_DIR" 2>/dev/null

echo "Oversells ishga tushirilmoqda (birinchi marta 15–30 daqiqa)..."
docker compose -f docker-compose.desktop.yml up -d --build
until curl -fs http://localhost:3000/api/ready >/dev/null 2>&1; do sleep 2; done

url=http://localhost:3000
if [ "$(uname)" = "Darwin" ]; then
  if [ -d "/Applications/Google Chrome.app" ]; then open -na "Google Chrome" --args --app="$url"; else open "$url"; fi
else
  for b in google-chrome chromium chromium-browser microsoft-edge; do
    if command -v "$b" >/dev/null 2>&1; then "$b" --app="$url" >/dev/null 2>&1 & exit 0; fi
  done
  xdg-open "$url" >/dev/null 2>&1 || echo "Brauzerda oching: $url"
fi
