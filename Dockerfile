# Oversells application image: API server + built web client, and the
# compile worker service (same image, started with the "worker" command).
#
# Node.js is copied from the official image onto Ubuntu 24.04 (the same base
# as the compiler image), which also provides the OpenSSL that Prisma needs.
ARG NODE_IMAGE=node:22-bookworm-slim
ARG BASE_IMAGE=ubuntu:24.04

FROM ${NODE_IMAGE} AS node

FROM ${BASE_IMAGE} AS base
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 LC_ALL=C.UTF-8
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl util-linux \
 && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
WORKDIR /app

# --- build ------------------------------------------------------------------
FROM base AS build
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN npx prisma generate --schema apps/server/prisma/schema.prisma \
 && npm run build \
 && npm prune --omit=dev --no-audit --no-fund \
 && npx prisma generate --schema apps/server/prisma/schema.prisma

# --- runtime ----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIST_DIR=/app/apps/web/dist \
    TEMPLATES_DIR=/app/apps/server/templates
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages packages
COPY --from=build /app/apps/server/package.json apps/server/package.json
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/prisma apps/server/prisma
COPY --from=build /app/apps/server/templates apps/server/templates
COPY --from=build /app/apps/web/dist apps/web/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh \
 && useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin oversells \
 && mkdir -p /data && chown oversells:oversells /data

# The entrypoint starts as root only to fix /data ownership, then runs the
# app and the worker as the unprivileged "oversells" user (the worker gets
# the Docker socket's group). User LaTeX never runs here, only in the
# sandboxed compiler containers. Set OVERSELLS_ROLE=worker on the worker
# container so the health check probes the worker endpoint.
EXPOSE 3000 9464
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s \
  CMD node -e "const w=process.env.OVERSELLS_ROLE==='worker';fetch(w?'http://127.0.0.1:'+(process.env.WORKER_PORT||9464)+'/health':'http://127.0.0.1:'+(process.env.PORT||3000)+'/api/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["app"]
