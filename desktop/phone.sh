#!/bin/sh
# Opens Oversells to phones and tablets on the same Wi-Fi (or closes it again).
#   sh desktop/phone.sh on    phones on this Wi-Fi can open it
#   sh desktop/phone.sh off   only this computer can open it (the default)
# Everyone who opens it still has to log in with their own password.
set -eu
cd "$(dirname "$0")/.."

case "${1:-on}" in
  on) bind=0.0.0.0 ;;
  off) bind=127.0.0.1 ;;
  *) echo "Ishlatish: sh desktop/phone.sh on | off"; exit 1 ;;
esac

touch .env
grep -v '^OVERSELLS_BIND=' .env >.env.tmp || true
echo "OVERSELLS_BIND=$bind" >>.env.tmp
mv .env.tmp .env

export OVERSELLS_BACKUP_DIR="${OVERSELLS_BACKUP_DIR:-$HOME/Documents/Oversells zaxira}"
mkdir -p "$OVERSELLS_BACKUP_DIR"
docker compose -f docker-compose.desktop.yml up -d --no-build app

if [ "$bind" = 127.0.0.1 ]; then
  echo "Yopildi: Oversells endi faqat shu kompyuterda ochiladi."
  exit 0
fi
port="$(sed -n 's/^APP_PORT=//p' .env | tail -n 1)"
port="${port:-3000}"
ip=""
if [ "$(uname)" = Darwin ]; then
  for i in en0 en1 en2; do ip="$(ipconfig getifaddr "$i" 2>/dev/null || true)"; [ -n "$ip" ] && break; done
else
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
echo "Tayyor. Telefon shu Wi-Fi'ga ulangan boʻlsin va brauzerda oching:"
echo "    http://${ip:-<kompyuter manzili>}:$port"
echo "Kompyuter yoqiq va Oversells ochiq boʻlishi kerak. Yopish: sh desktop/phone.sh off"
