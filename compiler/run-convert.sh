#!/bin/sh
# Document conversions with pandoc, in the same sandbox as compiles.
#
# Usage: run-convert <docx-to-latex|latex-to-docx|latex-to-epub> [main-file.tex]
#
#   stdin  : tar archive with the input files (extracted into /work)
#            docx-to-latex: input.docx;  latex-to-*: the project files
#   stdout : tar archive of the results
#            docx-to-latex: main.tex and media/* (pictures of the document)
#            latex-to-docx: output.docx;  latex-to-epub: output.epub
#   stderr : pandoc messages
#   exit   : pandoc's exit code (0 = success)
set -u

mode="${1:-}"
main="${2:-main.tex}"

cd /work || exit 2
tar -x -f - --no-same-owner --no-same-permissions >&2 || {
  echo "run-convert: could not unpack the input files" >&2
  exit 3
}
mkdir -p /work/out

case "$mode" in
  docx-to-latex)
    [ -f input.docx ] || { echo "run-convert: input.docx missing" >&2; exit 4; }
    # Uzbek setup of the Oversells templates, added at the end of pandoc's preamble.
    cat > /tmp/uz-header.tex <<'EOF'
\usepackage{babel}
\babelprovide[import=uz-Latn, main]{uzbek}
\babelprovide[import=uz-Cyrl]{uzbekcyr}
\def\uzbekhyphenmins{22}\def\uzbekcyrhyphenmins{22}
\setlength{\emergencystretch}{3em}
EOF
    cd /work/out && pandoc ../input.docx \
      --from=docx --to=latex --standalone --wrap=preserve \
      --extract-media=. \
      --include-in-header=/tmp/uz-header.tex \
      --variable=documentclass:article \
      --variable=papersize:a4 \
      --variable=geometry:margin=2.5cm \
      --variable=mainfont:"Noto Serif" \
      --variable=colorlinks \
      --output=main.tex >&2
    status=$?
    # Paths as the project sees them: media/image1.png, not ./media/image1.png.
    [ -f main.tex ] && sed -i 's#{\./media/#{media/#g' main.tex
    ;;
  latex-to-docx|latex-to-epub)
    case "$main" in *.tex) ;; *) echo "run-convert: main file must be a .tex file" >&2; exit 2 ;; esac
    [ -f "$main" ] || { echo "run-convert: main file '$main' not found" >&2; exit 4; }
    if [ "$mode" = latex-to-docx ]; then target=docx; out=output.docx; else target=epub3; out=output.epub; fi
    # pandoc reads local packages and can loop on TikZ-heavy ones (dizayn.sty):
    # without them it keeps the text of unknown environments and commands.
    find . -name '*.sty' -o -name '*.cls' | while read -r f; do mv "$f" "$f.hidden"; done
    timeout 120 pandoc "$main" --from=latex --to="$target" \
      --resource-path=".:$(dirname "$main")" \
      --output="/work/out/$out" >&2
    status=$?
    ;;
  *)
    echo "run-convert: unknown conversion '$mode'" >&2
    exit 2
    ;;
esac

cd /work/out && tar -c -f - .
exit "$status"
