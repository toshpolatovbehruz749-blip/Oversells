#!/bin/sh
# Installs the new Oversells version when Docker Hub cannot be reached
# ("failed to fetch oauth token ... connection refused").
# The new app image is built on top of the installed one, which already holds
# Ubuntu and Node.js; only the Ubuntu and npm package mirrors are needed.
#   sh desktop/update-offline.sh
set -eu
cd "$(dirname "$0")/.."

docker image inspect oversells-app:latest >/dev/null 2>&1 || {
  echo "Oversells hali oʻrnatilmagan: birinchi oʻrnatish uchun Docker Hub kerak."
  exit 1
}
export OVERSELLS_BACKUP_DIR="${OVERSELLS_BACKUP_DIR:-$HOME/Documents/Oversells zaxira}"
mkdir -p "$OVERSELLS_BACKUP_DIR"

# Always build on the same base (the image installed before the first offline
# update), so the images do not pile up on each other with every update.
docker image inspect oversells-app:offline-base >/dev/null 2>&1 ||
  docker tag oversells-app:latest oversells-app:offline-base

echo "Yangi versiya yigʻilmoqda (bir necha daqiqa)..."
OVERSELLS_BASE_IMAGE=oversells-app:offline-base OVERSELLS_NODE_IMAGE=oversells-app:offline-base \
  docker compose -f docker-compose.desktop.yml build app
docker compose -f docker-compose.desktop.yml up -d --no-build
docker image prune -f >/dev/null 2>&1 || true
echo "Tayyor: yangi versiya ishga tushdi."
