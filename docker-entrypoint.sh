#!/bin/sh
# Usage: docker-entrypoint.sh [app|worker|migrate]
#   app     apply pending database migrations, then start the API server (default)
#   worker  start the compile worker service (needs the Docker socket)
# Both run as the unprivileged "oversells" user (uid 10001).
#   migrate only apply the migrations
set -e
cd /app/apps/server
role="${1:-app}"
export OVERSELLS_ROLE="$role"

migrate() {
  /app/node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma
}

# Drops root: runs as the "oversells" user, plus the group that owns the
# Docker socket when there is one (the worker starts the sandbox containers).
as_app_user() {
  if [ "$(id -u)" != "0" ]; then exec "$@"; fi
  if [ -d /data ] && [ "$(stat -c %u /data)" != "10001" ]; then chown -R oversells:oversells /data; fi
  # The daily project ZIPs (BACKUP_DIR, a folder of the host): the folder itself must be writable.
  if [ -n "${BACKUP_DIR:-}" ] && [ -d "$BACKUP_DIR" ] && [ "$(stat -c %u "$BACKUP_DIR")" != "10001" ]; then
    chown oversells:oversells "$BACKUP_DIR" 2>/dev/null || true
  fi
  sock="${DOCKER_SOCKET:-/var/run/docker.sock}"
  if [ -S "$sock" ]; then
    exec setpriv --reuid=oversells --regid=oversells --groups "$(stat -c %g "$sock")" "$@"
  fi
  exec setpriv --reuid=oversells --regid=oversells --init-groups "$@"
}

case "$role" in
  app)
    migrate
    as_app_user node dist/index.js
    ;;
  worker)
    as_app_user node dist/worker.js
    ;;
  migrate)
    migrate
    ;;
  *)
    exec "$@"
    ;;
esac
