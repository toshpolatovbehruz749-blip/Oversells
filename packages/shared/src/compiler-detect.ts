import type { Compiler } from './types.js';

/**
 * Which engine a LaTeX document was written for, read from its preamble.
 *
 * Documents from Overleaf or older books often use pdfLaTeX font setup
 * (inputenc, fontenc with T1/T2A, mathpazo, helvet, ...). Compiled with
 * XeLaTeX, those 8-bit fonts lose every Cyrillic letter and ʻ; compiled with
 * pdfLaTeX they work. Documents with fontspec need XeLaTeX or LuaLaTeX, and a
 * few need LuaLaTeX itself. A "% !TEX program = ..." line decides first.
 */

export type EngineNeed = 'pdflatex' | 'unicode' | 'lualatex';

export interface CompilerHint {
  need: EngineNeed;
  /** The compiler to switch to. */
  compiler: Compiler;
  /** What in the preamble shows it (a package or command name, for the message). */
  reason: string;
}

/** Type 1 font packages and 8-bit encodings: pdfLaTeX documents. */
const PDFTEX_PACKAGES = [
  'inputenc', 'fontenc', 'mathpazo', 'helvet', 'times', 'mathptmx', 'newtxtext', 'newtxmath', 'txfonts', 'pxfonts',
  'kpfonts', 'fourier', 'charter', 'bookman', 'avant', 'courier', 'palatino', 'newpxtext', 'newpxmath', 'tgtermes',
  'tgpagella', 'tgheros', 'tgbonum', 'tgschola', 'cmbright', 'eulervm', 'mathdesign', 'fouriernc', 'utopia', 'cyrillic',
];
/** Packages that only work with XeLaTeX or LuaLaTeX. */
const UNICODE_PACKAGES = ['fontspec', 'unicode-math', 'polyglossia', 'xeCJK', 'mathspec', 'xltxtra', 'xunicode', 'luatexja', 'luacode', 'luatexbase', 'luaotfload', 'lua-ul', 'luamplib', 'lua-visual-debug'];
const LUA_PACKAGES = new Set(['luatexja', 'luacode', 'luatexbase', 'luaotfload', 'lua-ul', 'luamplib', 'lua-visual-debug']);
const MAGIC = /^%\s*!\s*TeX\s+(?:TS-)?program\s*=\s*(pdflatex|xelatex|lualatex)\b/im;

function stripComments(text: string): string {
  return text.replace(/(^|[^\\])%.*$/gm, '$1');
}

/** The packages a preamble loads (\usepackage and \RequirePackage, comma lists). */
export function loadedPackages(preamble: string): string[] {
  const out: string[] = [];
  for (const m of stripComments(preamble).matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)) {
    for (const p of m[1]!.split(',')) if (p.trim()) out.push(p.trim());
  }
  return out;
}

/** The engine the document asks for, or null when any engine will do. */
export function detectCompiler(text: string): CompilerHint | null {
  const begin = text.search(/\\begin\s*\{document\}/);
  const preamble = begin === -1 ? text : text.slice(0, begin);
  const magic = MAGIC.exec(preamble);
  if (magic) {
    const c = magic[1]!.toLowerCase() as Compiler;
    return { need: c === 'pdflatex' ? 'pdflatex' : c === 'lualatex' ? 'lualatex' : 'unicode', compiler: c, reason: '% !TEX program' };
  }
  const code = stripComments(preamble);
  const packages = loadedPackages(preamble);
  const lua = packages.find((p) => LUA_PACKAGES.has(p)) ?? (/\\directlua\b/.test(code) ? '\\directlua' : undefined);
  if (lua) return { need: 'lualatex', compiler: 'lualatex', reason: lua };
  const unicode =
    packages.find((p) => UNICODE_PACKAGES.includes(p)) ?? /\\(setmainfont|setsansfont|newfontfamily|babelfont)\b/.exec(code)?.[0];
  if (unicode) return { need: 'unicode', compiler: 'xelatex', reason: unicode };
  const pdftex = packages.find((p) => PDFTEX_PACKAGES.includes(p));
  if (pdftex) return { need: 'pdflatex', compiler: 'pdflatex', reason: pdftex };
  return null;
}

/** Whether a project's compiler suits the document. */
export function compilerFits(compiler: Compiler, hint: CompilerHint | null): boolean {
  if (!hint) return true;
  if (hint.need === 'pdflatex') return compiler === 'pdflatex';
  if (hint.need === 'lualatex') return compiler === 'lualatex';
  return compiler === 'xelatex' || compiler === 'lualatex';
}
