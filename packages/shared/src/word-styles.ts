import { defaultPageDesign, normalizePageDesign, type PageDesignSpec } from './page-design.js';

/**
 * «Sahifa dizayni»: Word documents imported with their styles. The compiler
 * image has pandoc; this script travels with the job (like the preflight), so
 * the image needs no rebuild. pandoc's docx+styles marks every paragraph and
 * character style; a Lua filter turns the ones pandoc does not understand
 * itself into \begin{uslub}{id} … \end{uslub} and \matnuslubi{id}{…}, and
 * lists them in out/styles.txt ("p|c <tab> id <tab> Word name" per line).
 * Headings, normal text, captions, lists and links stay pandoc's own LaTeX.
 */

const UZ_HEADER = [
  '\\usepackage{babel}',
  '\\babelprovide[import=uz-Latn, main]{uzbek}',
  '\\babelprovide[import=uz-Cyrl]{uzbekcyr}',
  '\\def\\uzbekhyphenmins{22}\\def\\uzbekcyrhyphenmins{22}',
  '\\setlength{\\emergencystretch}{3em}',
].join('\n');

const LUA_FILTER = String.raw`local ids, used, list = {}, {}, {}
local builtin = {
  ['Normal'] = true, ['Body Text'] = true, ['First Paragraph'] = true, ['Compact'] = true,
  ['Title'] = true, ['Subtitle'] = true, ['Author'] = true, ['Date'] = true, ['Abstract'] = true,
  ['Bibliography'] = true, ['List Paragraph'] = true, ['Caption'] = true, ['Image Caption'] = true,
  ['Table Caption'] = true, ['Figure'] = true, ['Captioned Figure'] = true, ['Footnote Text'] = true,
  ['Hyperlink'] = true, ['Default Paragraph Font'] = true, ['Footnote Reference'] = true,
  ['Verbatim Char'] = true, ['Source Code'] = true, ['Table'] = true,
}
local function skip(name)
  return name == nil or builtin[name] or name:match('^[Hh]eading %d') or name:match('^[Tt][Oo][Cc]')
end
local function idof(name, kind)
  local key = kind .. '\0' .. name
  if ids[key] then return ids[key] end
  local base = name:lower():gsub('[^a-z0-9]', '')
  if not base:match('^[a-z]') then base = 'uslub' .. base end
  base = base:sub(1, 26)
  local id, n = base, 2
  while used[kind .. id] do id = base .. n; n = n + 1 end
  used[kind .. id] = true
  ids[key] = id
  list[#list + 1] = kind .. '\t' .. id .. '\t' .. name
  return id
end
function Div(el)
  local name = el.attributes['custom-style']
  if skip(name) then return nil end
  local out = { pandoc.RawBlock('latex', '\\begin{uslub}{' .. idof(name, 'p') .. '}') }
  for _, b in ipairs(el.content) do out[#out + 1] = b end
  out[#out + 1] = pandoc.RawBlock('latex', '\\end{uslub}')
  return out
end
function Span(el)
  local name = el.attributes['custom-style']
  if skip(name) then return nil end
  local out = { pandoc.RawInline('latex', '\\matnuslubi{' .. idof(name, 'c') .. '}{') }
  for _, i in ipairs(el.content) do out[#out + 1] = i end
  out[#out + 1] = pandoc.RawInline('latex', '}')
  return out
end
function Pandoc(doc)
  local f = io.open('/work/out/styles.txt', 'w')
  f:write(table.concat(list, '\n'))
  f:close()
  return doc
end`;

/** Shell script for the sandbox: input.docx in, a tar of out/ (main.tex, media/, styles.txt) on stdout. */
export const DOCX_STYLES_SCRIPT = [
  'set -u',
  'cd /work || exit 2',
  'tar -x -f - --no-same-owner --no-same-permissions >&2 || exit 3',
  '[ -f input.docx ] || { echo "import: input.docx missing" >&2; exit 4; }',
  'mkdir -p /work/out',
  // The two files are written with printf %s, so nothing in them is read by the shell.
  `printf '%s\\n' '${UZ_HEADER.replace(/'/g, "'\\''")}' > /tmp/uz-header.tex`,
  `printf '%s\\n' '${LUA_FILTER.replace(/'/g, "'\\''")}' > /tmp/styles.lua`,
  'cd /work/out && pandoc ../input.docx \\',
  '  --from=docx+styles --to=latex --standalone --wrap=preserve \\',
  '  --extract-media=. \\',
  '  --lua-filter=/tmp/styles.lua \\',
  '  --include-in-header=/tmp/uz-header.tex \\',
  '  --variable=documentclass:article \\',
  '  --variable=papersize:a4 \\',
  '  --variable=geometry:margin=2.5cm \\',
  '  --variable=mainfont:"Noto Serif" \\',
  '  --variable=colorlinks \\',
  '  --output=main.tex >&2',
  'status=$?',
  // Paths as the project sees them: media/image1.png, not ./media/image1.png.
  "[ -f main.tex ] && sed -i 's#{\\./media/#{media/#g' main.tex",
  'cd /work/out && tar -c -f - .',
  'exit "$status"',
].join('\n');

/** The page design of an imported Word document: the defaults plus its styles under their Word names. */
export function pageDesignFromWordStyles(stylesTxt: string, title: string): PageDesignSpec {
  const spec = defaultPageDesign(title.slice(0, 120));
  for (const line of stylesTxt.split('\n')) {
    const [kind, id, ...name] = line.split('\t');
    if (!id || !/^[a-z][a-z0-9]{0,29}$/.test(id) || (kind !== 'p' && kind !== 'c')) continue;
    const list: { id: string; name: string }[] = kind === 'p' ? spec.paragraphStyles : spec.characterStyles;
    if (list.length >= 60 || list.some((s) => s.id === id)) continue;
    list.push({ id, name: name.join('\t').trim().slice(0, 60) || id });
  }
  return normalizePageDesign(spec);
}
