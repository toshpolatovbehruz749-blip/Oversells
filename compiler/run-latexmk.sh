#!/bin/sh
# Entry point of the compiler container.
#
# Usage: run-latexmk <pdflatex|xelatex|lualatex> <main-file.tex>
#
#   stdin  : tar archive with the project files (extracted into /work)
#   stdout : tar archive with <main>.pdf, <main>.log, <main>.synctex.gz
#            (whichever exist) and, when OVERSELLS_PREVIEW=1, <main>.preview.png
#            (first page rendered with pdftoppm)
#   stderr : latexmk console output
#   exit   : latexmk's exit code (0 = success)
#
# latexmk flags:
#   -norc            ignore any latexmkrc (a project could otherwise run Perl)
#   -no-shell-escape never allow \write18
#   -file-line-error "file:line: message" errors, parsed by the server
#   -f               keep going after errors so a partial PDF is still produced
set -u

engine="${1:-}"
main="${2:-}"

case "$engine" in
  pdflatex) mode="-pdf" ;;
  xelatex)  mode="-pdfxe" ;;
  lualatex) mode="-pdflua" ;;
  *) echo "run-latexmk: unsupported engine '$engine'" >&2; exit 2 ;;
esac

case "$main" in
  *.tex) ;;
  *) echo "run-latexmk: main file must be a .tex file" >&2; exit 2 ;;
esac

cd /work || exit 2
# GNU tar refuses absolute names and '..' members by default.
tar -x -f - --no-same-owner --no-same-permissions >&2 || {
  echo "run-latexmk: could not unpack project files" >&2
  exit 3
}

if [ ! -f "$main" ]; then
  echo "run-latexmk: main file '$main' not found" >&2
  exit 4
fi

latexmk -norc "$mode" \
  -interaction=nonstopmode \
  -file-line-error \
  -synctex=1 \
  -latexoption=-no-shell-escape \
  -f \
  "$main" </dev/null >&2
status=$?

base="$(basename "$main" .tex)"
if [ "${OVERSELLS_PREVIEW:-0}" = "1" ] && [ -f "$base.pdf" ]; then
  pdftoppm -png -r 50 -f 1 -l 1 -singlefile "$base.pdf" "$base.preview" >&2 || true
fi
set --
for f in "$base.pdf" "$base.log" "$base.synctex.gz" "$base.preview.png"; do
  [ -f "$f" ] && set -- "$@" "$f"
done
if [ "$#" -gt 0 ]; then
  tar -c -f - -- "$@"
fi
exit "$status"
