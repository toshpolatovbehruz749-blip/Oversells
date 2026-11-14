#!/bin/sh
# Installs the Uzbek hyphenation patterns into TeX Live (compiler image build).
# Language name "uzbek" with the synonyms babel users pick for the two scripts;
# the same pattern set covers Latin and Cyrillic.
set -eu
here="$(dirname "$0")"
dest=/usr/local/share/texmf/tex/generic/hyph-uz
config=/var/lib/texmf/tex/generic/config
mkdir -p "$dest"
cp "$here/hyph-uz.tex" "$here/hyph-uz.pat.txt" "$here/loadhyph-uz.tex" "$dest/"
mktexlsr >/dev/null

# pdfTeX / XeTeX formats (patterns are part of the format).
printf 'uzbek loadhyph-uz.tex\n=uzbeklatin\n=uzbekcyr\n=uzbekcyrillic\n' >> "$config/language.dat"
# e-TeX language.def.
sed -i '/^\\uselanguage/i \\addlanguage{uzbek}{loadhyph-uz.tex}{}{2}{2}' "$config/language.def"
# LuaTeX loads patterns at run time.
sed -i '$d' "$config/language.dat.lua"
cat >> "$config/language.dat.lua" <<'LUA'
  ['uzbek'] = {
    loader = 'loadhyph-uz.tex',
    lefthyphenmin = 2,
    righthyphenmin = 2,
    synonyms = { 'uzbeklatin', 'uzbekcyr', 'uzbekcyrillic' },
    patterns = 'hyph-uz.pat.txt',
    hyphenation = '',
  },
}
LUA
fmtutil-sys --byfmt xelatex >/dev/null 2>&1
fmtutil-sys --byfmt lualatex >/dev/null 2>&1
fmtutil-sys --byfmt pdflatex >/dev/null 2>&1
