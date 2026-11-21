#!/bin/sh
# Adds the TeX Gyre text fonts to the compiler image that is already on this
# computer, without rebuilding it. A rebuild starts from ubuntu:24.04 on
# Docker Hub; where Docker Hub cannot be reached ("failed to fetch oauth
# token ... connection refused") this needs only the Ubuntu package mirror.
#
#   sh desktop/add-fonts.sh
set -eu
image=oversells-texlive:latest
name=oversells-add-fonts
docker image inspect "$image" >/dev/null 2>&1 || { echo "$image topilmadi: avval Oversells ni bir marta ishga tushiring."; exit 1; }
if docker run --rm --entrypoint sh "$image" -c 'kpsewhich texgyreheros-regular.otf' >/dev/null 2>&1; then
  echo "TeX Gyre shriftlari allaqachon bor."
  exit 0
fi
docker rm -f "$name" >/dev/null 2>&1 || true
echo "TeX Gyre shriftlari oʻrnatilmoqda (1–3 daqiqa)…"
docker run --name "$name" --user root --entrypoint sh "$image" -c '
  apt-get update -qq &&
  apt-get install -y -qq --no-install-recommends fonts-texgyre >/dev/null &&
  rm -rf /var/lib/apt/lists/* /usr/share/doc/* &&
  fc-cache -f >/dev/null && mktexlsr >/dev/null 2>&1 &&
  TEXMFVAR=/var/lib/texmf luaotfload-tool --update --force >/dev/null 2>&1 &&
  chmod -R a+rX /var/lib/texmf'
# The run above changed the user and entry point; the image keeps its own.
docker commit \
  --change 'USER tex' \
  --change 'WORKDIR /work' \
  --change 'ENTRYPOINT ["/usr/local/bin/run-latexmk"]' \
  --change 'CMD []' \
  "$name" "$image" >/dev/null
docker rm "$name" >/dev/null
docker run --rm --entrypoint sh "$image" -c 'kpsewhich texgyreheros-regular.otf' >/dev/null
echo "Tayyor: TeX Gyre shriftlari oʻrnatildi. Kitobni qayta kompilyatsiya qiling."
