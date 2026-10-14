#!/bin/sh
# pdfLaTeX knows ‘ and ’ but not the Uzbek letters ʻ (U+02BB: oʻ, gʻ) and
# ʼ (U+02BC: maʼno): "Unicode character ʻ not set up", and the letter is
# lost. Each font encoding's .dfu file gets them as
# \textquoteleft / \textquoteright, which every text encoding has.
# XeLaTeX and LuaLaTeX take them from the font and are not affected.
set -eu
for f in $(find /usr/share/texlive/texmf-dist/tex/latex/base /usr/share/texlive/texmf-dist/tex/latex-dev/base \
    -name '*enc.dfu' ! -name 'utf8enc.dfu' ! -name 'omsenc.dfu' 2>/dev/null); do
  grep -q '{02BB}' "$f" && continue
  # Before the file's final \endinput.
  sed -i '/^\\endinput/i \
% Oversells: Uzbek okina and tutuq (oʻ gʻ, maʼno) for pdfLaTeX.\
\\DeclareUnicodeCharacter{02BB}{\\textquoteleft}\
\\DeclareUnicodeCharacter{02BC}{\\textquoteright}' "$f"
done
# OT1, T1 and TS1 are read into the format when it is built: rebuild it.
fmtutil-sys --byfmt pdflatex >/dev/null 2>&1 || { fmtutil-sys --byfmt pdflatex; exit 1; }
fmtutil-sys --byfmt latex >/dev/null 2>&1 || true
grep -l '{02BB}' /usr/share/texlive/texmf-dist/tex/latex/base/ot1enc.dfu
