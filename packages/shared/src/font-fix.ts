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
  if (/sans|cmss|lmss|^la(ss|sx|si|sb)\d|helvet|arial/.test(f)) return 'sans';
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
