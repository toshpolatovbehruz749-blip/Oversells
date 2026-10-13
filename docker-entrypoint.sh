#!/bin/sh
# Applies pending database migrations, then starts the server.
set -e
cd /app/apps/server
/app/node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma
exec node dist/index.js
