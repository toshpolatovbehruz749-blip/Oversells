import type { Compiler, LogEntry } from './types.js';

/**
 * Letters the document's fonts do not have.
 *
 * XeLaTeX and LuaLaTeX only write "Missing character: There is no Ў (U+040E)
 * in font [lmroman10-regular]" to the log and leave the letter out of the PDF,
 * so a document without fontspec (Latin Modern has no Cyrillic, no ʻ) comes
 * out with empty gaps. pdfLaTeX stops with "Unicode character Ў (U+040E) not
 * set up for use with LaTeX". The log parser turns the first into one warning
 * per font; this module recognises both and repairs the main file.
 */

export type FontRole = 'main' | 'sans' | 'mono' | 'math';

export interface FontProblem {
  /** The text fonts (by role) and math fonts that lack letters, with the letters. */
  fonts: Array<{ font: string; role: FontRole; chars: string[] }>;
  /** pdfLaTeX cannot typeset these letters at all. */
  pdflatex: boolean;
  /** The letters, for the message. */
  chars: string[];
}

/** The warning the log parser writes for a font with missing letters. */
export const MISSING_PREFIX = 'Missing characters: ';
const MISSING_ENTRY = /^Missing characters: (.+) in font (.+)$/;
const UNICODE_ERROR = /Unicode character (\S+) \(U\+[0-9A-F]+\)/;

/** The role of a font from its name in the log: lmmono10-regular, lmsans10, cmmi10, latinmodern-math. */
export function fontRole(font: string): FontRole {
  const f = font.toLowerCase();
  if (/math|^cm(mi|sy|ex)\d|^lmmath|^eu[fmrs]|^ms[ab]m/.test(f)) return 'math';
  // ec-lmtt10, lmmono10, cmtt; LH Cyrillic fonts: latt1000 (mono), lass1000 (sans), larm1000 (roman).
  if (/mono|typewriter|cmtt|lmtt|^la(tt|tc|vt)\d|courier|consol/.test(f)) return 'mono';
  if (/sans|cmss|lmss|^la(ss|sx|si|sb)\d|helvet|arial|heros|adventor|calibri|verdana|tahoma|segoe|roboto|lato|inter\b|montserrat|myriad|futura|gill/.test(f)) return 'sans';
  return 'main';
}

/** The log message for one font (the letters, then the font). */
export function missingMessage(font: string, chars: string[]): string {
  const shown = chars.slice(0, 12).join(' ');
  return `${MISSING_PREFIX}${shown}${chars.length > 12 ? ` (+${chars.length - 12})` : ''} in font ${font}`;
}

/** The font problem of a compile, or null when every letter was typeset. */
export function fontProblem(entries: LogEntry[]): FontProblem | null {
  const fonts: FontProblem['fonts'] = [];
  const all = new Set<string>();
  let pdflatex = false;
  for (const e of entries) {
    const m = MISSING_ENTRY.exec(e.message);
    if (m) {
      const chars = m[1]!.replace(/ \(\+\d+\)$/, '').split(' ').filter(Boolean);
      chars.forEach((c) => all.add(c));
      fonts.push({ font: m[2]!, role: fontRole(m[2]!), chars });
      continue;
    }
    const u = UNICODE_ERROR.exec(e.message);
    if (u && e.level === 'error') {
      pdflatex = true;
      all.add(u[1]!);
    }
  }
  if (fonts.length === 0 && !pdflatex) return null;
  return { fonts, pdflatex, chars: [...all] };
}

/** Fonts that have Latin, Cyrillic and the Uzbek ʻ ʼ (installed in the compiler image). */
export const FALLBACK_FONTS: Record<Exclude<FontRole, 'math'>, string> = {
  main: 'Noto Serif',
  sans: 'Noto Sans',
  mono: 'DejaVu Sans Mono',
};

const COMMAND: Record<Exclude<FontRole, 'math'>, string> = {
  main: '\\setmainfont',
  sans: '\\setsansfont',
  mono: '\\setmonofont',
};

const OKINA_TUTUQ = new Set(['ʻ', 'ʼ']);
/** The Uzbek ʻ (oʻ, gʻ) and ʼ (maʼno) for pdfLaTeX, drawn as ‘ and ’ of the current font. */
export const PDFTEX_OKINA = [
  '% Oʻzbek ʻ va ʼ harflari pdfLaTeX uchun (Oversells «Tuzatish»).',
  '% The Uzbek letters ʻ and ʼ for pdfLaTeX (added by Oversells).',
  '\\DeclareUnicodeCharacter{02BB}{\\textquoteleft}',
  '\\DeclareUnicodeCharacter{02BC}{\\textquoteright}',
].join('\n');

/**
 * The same for XeLaTeX/LuaLaTeX fonts without ʻ ʼ (TeX Gyre, many design
 * fonts): the letters are printed as ‘ and ’ of the font, so the design stays.
 */
export const UNICODE_OKINA = [
  '% Oʻzbek ʻ va ʼ harflari shriftda yoʻq: ‘ va ’ bilan chiqadi (Oversells «Tuzatish»).',
  '% The font lacks the Uzbek ʻ and ʼ: they print as ‘ and ’ (added by Oversells).',
  '\\usepackage{newunicodechar}',
  '\\newunicodechar{ʻ}{‘}',
  '\\newunicodechar{ʼ}{’}',
].join('\n');

/** pdfLaTeX font setup that only gets in the way under XeLaTeX/LuaLaTeX (8-bit T1/T2A fonts without Cyrillic glyphs for them). */
const LEGACY_LINE = /^([ \t]*)(\\usepackage(\[[^\]]*\])?\{(inputenc|fontenc|lmodern)\}.*)$/gm;

/**
 * The repair: XeLaTeX instead of pdfLaTeX, and fonts with these letters set
 * right before \begin{document} (after any \setmainfont, lmodern or design
 * package that chose the old ones). A document that had no fontspec gets all
 * three families (fontspec's defaults are Latin Modern) and its pdfLaTeX font
 * lines (inputenc, fontenc with T1/T2A, lmodern) commented out; otherwise only
 * the families whose fonts lack letters change, so a design's fonts stay.
 * Letters in formulas cannot be fixed by a font: `mathOnly` says to use \text{...}.
 */
export function fixFonts(
  text: string,
  problem: FontProblem,
  compiler: Compiler,
): { text: string | null; compiler: Compiler | null; mathOnly: boolean } {
  const begin = text.search(/^[ \t]*\\begin\{document\}/m);
  // pdfLaTeX that only lacks the Uzbek ʻ ʼ keeps its fonts and design: two declarations teach it the letters.
  if (compiler === 'pdflatex' && problem.pdflatex && problem.fonts.length === 0 && problem.chars.every((c) => OKINA_TUTUQ.has(c))) {
    if (begin === -1 || text.includes('{02BB}')) return { text: null, compiler: null, mathOnly: false };
    return { text: `${text.slice(0, begin)}${PDFTEX_OKINA}\n${text.slice(begin)}`, compiler: null, mathOnly: false };
  }
  // A Unicode engine whose fonts only lack ʻ ʼ: map them to ‘ ’ instead of changing the fonts.
  if (
    compiler !== 'pdflatex' &&
    !problem.pdflatex &&
    problem.fonts.some((f) => f.role !== 'math') &&
    problem.chars.length > 0 &&
    problem.chars.every((c) => OKINA_TUTUQ.has(c))
  ) {
    if (begin === -1 || text.includes('\\newunicodechar{ʻ}')) return { text: null, compiler: null, mathOnly: false };
    return { text: `${text.slice(0, begin)}${UNICODE_OKINA}\n${text.slice(begin)}`, compiler: null, mathOnly: false };
  }
  const roles = new Set(problem.fonts.map((f) => f.role).filter((r): r is Exclude<FontRole, 'math'> => r !== 'math'));
  const newCompiler = compiler === 'pdflatex' && problem.pdflatex ? 'xelatex' : null;
  const preamble = begin === -1 ? text : text.slice(0, begin);
  const hadFontspec = /^[^%\n]*\\usepackage(\[[^\]]*\])?\{[^}]*\bfontspec\b[^}]*\}/m.test(preamble);
  const mathOnly = !newCompiler && roles.size === 0 && problem.fonts.some((f) => f.role === 'math');
  if (mathOnly || begin === -1 || (roles.size === 0 && !newCompiler)) return { text: null, compiler: newCompiler, mathOnly };

  const set: Array<Exclude<FontRole, 'math'>> = hadFontspec ? (['main', 'sans', 'mono'] as const).filter((r) => roles.has(r)) : ['main', 'sans', 'mono'];
  if (set.length === 0) return { text: null, compiler: newCompiler, mathOnly: false };
  let head = preamble;
  if (!hadFontspec) {
    head = head.replace(LEGACY_LINE, (_all, indent: string, line: string) => `${indent}% ${line} % pdfLaTeX uchun; XeLaTeX da fontspec`);
  }
  const lines = [
    '% Kirill va oʻzbek harflari bor shriftlar (Oversells «Tuzatish»).',
    '% Fonts with Cyrillic and Uzbek letters (added by Oversells).',
    ...(hadFontspec ? [] : ['\\usepackage{fontspec}']),
    ...set.map((r) => `${COMMAND[r]}{${FALLBACK_FONTS[r]}}`),
  ];
  return { text: `${head}${lines.join('\n')}\n${text.slice(begin)}`, compiler: newCompiler, mathOnly: false };
}

/**
 * A font the document names that is not installed: fontspec stops with
 * "The font "Times New Roman" cannot be found" (a Windows/Mac font) or
 * "Font ...=[texgyreheros-regular.otf]/OT ... not loadable". The fix replaces
 * the font command (\setmainfont, \newfontfamily\x, \babelfont{rm}, ... with
 * its options, over several lines) by one with an installed font of the same
 * look; the old command stays as a comment.
 */
export function missingFontName(message: string): string | null {
  const m = /The font "([^"]+)" cannot be found/.exec(message);
  if (m) return m[1]!;
  const f = /^!?\s*Font [^=]+=\s*["[]?([^\]"/:]+?)(?:\.(?:otf|ttf|ttc|pfb))?(?:[\]":/].*)? at .*not loadable/.exec(message);
  return f ? f[1]! : null;
}

/** An installed font with Latin, Cyrillic and ʻ ʼ that looks like `font`. */
export function substituteFont(font: string): string {
  const role = fontRole(font);
  return role === 'math' ? FALLBACK_FONTS.main : FALLBACK_FONTS[role];
}

const squash = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');
const FONT_COMMAND = /\\(setmainfont|setsansfont|setmonofont|newfontfamily\s*\\[A-Za-z@]+|newfontface\s*\\[A-Za-z@]+|babelfont\s*(?:\[[^\]]*\]\s*)?\{[a-z]+\}|fontspec)(?![A-Za-z@])/g;

/** The end of a balanced {...} or [...] group that starts at `i` (after spaces and line breaks), or -1. */
function groupEnd(text: string, i: number, open: string, close: string): { start: number; end: number } | null {
  let j = i;
  while (j < text.length && /\s/.test(text[j]!)) j++;
  if (text[j] !== open) return null;
  let depth = 0;
  for (let k = j; k < text.length; k++) {
    const c = text[k];
    if (c === '\\') k++;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return { start: j, end: k + 1 };
  }
  return null;
}

/**
 * The edit that swaps the command naming `font` (as the log names it:
 * "texgyreheros-regular" for \setmainfont{texgyreheros}[UprightFont=*-regular])
 * for one with `replacement`, or null when the text has no such command.
 */
export function replaceFontCommand(text: string, font: string, replacement: string): { at: number; remove: number; insert: string } | null {
  const want = squash(font);
  for (const m of text.matchAll(FONT_COMMAND)) {
    const at = m.index!;
    const lineStart = text.lastIndexOf('\n', at) + 1;
    if (/(^|[^\\])%/.test(text.slice(lineStart, at))) continue;
    let pos = at + m[0].length;
    const before = groupEnd(text, pos, '[', ']');
    if (before) pos = before.end;
    const name = groupEnd(text, pos, '{', '}');
    if (!name) continue;
    pos = name.end;
    const after = groupEnd(text, pos, '[', ']');
    if (after) pos = after.end;
    const named = squash(text.slice(name.start + 1, name.end - 1));
    if (!named || !(want.startsWith(named) || named.startsWith(want))) continue;
    const head = m[0].replace(/\s+/g, '');
    const old = text.slice(at, pos).split('\n').map((l) => `% ${l}`).join('\n');
    const rest = text.slice(pos, text.indexOf('\n', pos) === -1 ? text.length : text.indexOf('\n', pos));
    const tail = /^\s*(%.*)?$/.test(rest) ? '' : '\n';
    return { at, remove: pos - at, insert: `${old}\n${head}{${replacement}}${tail}` };
  }
  return null;
}
