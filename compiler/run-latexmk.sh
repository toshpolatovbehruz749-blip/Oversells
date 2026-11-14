#!/bin/sh
# Entry point of the compiler container.
#
# Usage: run-latexmk <pdflatex|xelatex|lualatex> <main-file.tex>
#
#   stdin  : tar archive with the project files (extracted into /work); it may
#            hold .oversells-cache.tar, the auxiliary files of the previous
#            successful compile (unpacked without replacing project files)
#   stdout : tar archive with <main>.pdf, <main>.log, <main>.synctex.gz
#            (whichever exist), when OVERSELLS_PREVIEW=1, <main>.preview.png
#            (first page rendered with pdftoppm) and, after a successful
#            compile, .oversells-cache.tar with the auxiliary files
#            (.aux, .toc, .bbl, ...) so the next compile needs fewer passes
#   stderr : latexmk console output
#   exit   : latexmk's exit code (0 = success)
#
# latexmk flags:
#   -norc            ignore any latexmkrc (a project could otherwise run Perl)
#   -no-shell-escape never allow \write18
#   -file-line-error "file:line: message" errors, parsed by the server
#   -f               keep going after errors so a partial PDF is still produced
#   -e $makeindex    oversells-index: Uzbek alphabetical order for Uzbek documents
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

cache=.oversells-cache.tar
if [ -f "$cache" ]; then
  tar -x -f "$cache" --skip-old-files --no-same-owner --no-same-permissions 2>/dev/null || true
  rm -f "$cache"
fi

if [ ! -f "$main" ]; then
  echo "run-latexmk: main file '$main' not found" >&2
  exit 4
fi

latexmk -norc "$mode" \
  -interaction=nonstopmode \
  -file-line-error \
  -synctex=1 \
  -latexoption=-no-shell-escape \
  -e '$makeindex = q/oversells-index %O -o %D %S/' \
  -f \
  "$main" </dev/null >&2
status=$?

base="$(basename "$main" .tex)"
if [ "${OVERSELLS_PREVIEW:-0}" = "1" ] && [ -f "$base.pdf" ]; then
  pdftoppm -png -r 50 -f 1 -l 1 -singlefile "$base.pdf" "$base.preview" >&2 || true
fi
if [ "$status" -eq 0 ]; then
  find . -type f \( -name '*.aux' -o -name '*.toc' -o -name '*.lof' -o -name '*.lot' -o -name '*.loa' \
    -o -name '*.out' -o -name '*.bbl' -o -name '*.bcf' -o -name '*.run.xml' -o -name '*.blg' \
    -o -name '*.idx' -o -name '*.ind' -o -name '*.ilg' -o -name '*.glo' -o -name '*.gls' -o -name '*.glg' \
    -o -name '*.nav' -o -name '*.snm' -o -name '*.thm' -o -name '*.mtc*' -o -name '*.maf' \
    -o -name '*.fls' -o -name '*.fdb_latexmk' \) -print > /tmp/cache-list
  [ -s /tmp/cache-list ] && tar -c -f "$cache" -T /tmp/cache-list 2>/dev/null
fi
set --
for f in "$base.pdf" "$base.log" "$base.synctex.gz" "$base.preview.png" "$cache"; do
  [ -f "$f" ] && set -- "$@" "$f"
done
if [ "$#" -gt 0 ]; then
  tar -c -f - -- "$@"
fi
exit "$status"
