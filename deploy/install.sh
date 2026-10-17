#!/usr/bin/env bash
# Installs Oversells for one person on a fresh Ubuntu 22.04/24.04 server.
#
#   git clone https://github.com/toshpolatovbehruz749-blip/Oversells.git
#   cd Oversells
#   sudo bash deploy/install.sh
#
# What it does: installs Docker, adds swap on small servers, writes
# .env.production with random passwords (only the first time), picks a free
# HTTPS address (<ip>.sslip.io) unless you give a domain, starts
# docker-compose.single.yml, and sets up a daily database backup.
# Run it again after `git pull` to update; your data and passwords are kept.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
ENV_FILE="$ROOT/.env.production"
COMPOSE=(docker compose -f "$ROOT/docker-compose.single.yml" --env-file "$ENV_FILE")

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mXato: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "skriptni sudo bilan ishga tushiring: sudo bash deploy/install.sh"

# --- Docker ------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  say "Docker oʻrnatilmoqda / installing Docker"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 topilmadi"

# --- Swap on small servers (TeX Live builds and compiles need memory) --------------
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
if [ "$mem_kb" -lt 7000000 ] && [ "$(swapon --show | wc -l)" -eq 0 ]; then
  say "2 GB swap qoʻshilmoqda / adding 2 GB swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- Settings (first run only) ---------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  ip=$(curl -fsS https://api.ipify.org || true)
  default_domain=""
  [ -n "$ip" ] && default_domain="${ip//./-}.sslip.io"
  echo
  echo "Domeningiz boʻlsa, uni kiriting (u shu server IP manziliga yoʻnaltirilgan boʻlishi kerak)."
  echo "Boʻlmasa Enter bosing — bepul manzil ishlatiladi: ${default_domain:-?}"
  read -r -p "Domen: " domain
  domain=${domain:-$default_domain}
  [ -n "$domain" ] || die "domen aniqlanmadi"
  read -r -p "Elektron pochtangiz (admin boʻlasiz): " email
  [ -n "$email" ] || die "elektron pochta kerak"
  umask 077
  cat > "$ENV_FILE" <<EOF
# Oversells sozlamalari (deploy/install.sh yaratgan). Maxfiy fayl — hech kimga bermang.
OVERSELLS_DOMAIN=$domain
ACME_EMAIL=$email
ADMIN_EMAILS=$email
POSTGRES_PASSWORD=$(openssl rand -hex 24)
COMPILE_CONCURRENCY=1

# AI yordamchi (ixtiyoriy): true qiling va kalitni yozing, soʻng skriptni qayta ishga tushiring.
AI_ENABLED=false
ANTHROPIC_API_KEY=
AI_DAILY_LIMIT=30
EOF
  say "Sozlamalar saqlandi: $ENV_FILE"
fi

# --- Start ----------------------------------------------------------------------------
say "Oversells qurilmoqda va ishga tushirilmoqda (birinchi marta 15–30 daqiqa)"
"${COMPOSE[@]}" up -d --build

# --- Daily database backup (kept 14 days) ------------------------------------------------
mkdir -p "$ROOT/backups"
cat > /etc/cron.d/oversells-backup <<EOF
# Oversells: daily database dump at 03:15, kept for 14 days.
15 3 * * * root cd $ROOT && docker compose -f docker-compose.single.yml --env-file .env.production exec -T db pg_dump -U oversells -d oversells --format=custom > backups/oversells-\$(date +\\%F).dump && find backups -name 'oversells-*.dump' -mtime +14 -delete
EOF

domain=$(grep '^OVERSELLS_DOMAIN=' "$ENV_FILE" | cut -d= -f2)
say "Tayyor! Bir necha daqiqadan soʻng oching: https://$domain"
echo "Holatni koʻrish: docker compose -f docker-compose.single.yml --env-file .env.production ps"
