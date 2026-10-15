import type { LogEntry } from './types.js';

/**
 * Plain-language help for LaTeX errors and warnings (shown in the user's
 * language by the web app: the `help.<id>` messages), with a one-click fix
 * where the fix is certain. Works offline; the AI explanation is an extra.
 */

export type QuickFix =
  /** \usepackage{pkg} into the main file's preamble. */
  | { kind: 'package'; pkg: string }
  /** A line into the main file's preamble. */
  | { kind: 'preamble'; line: string }
  /** In the entry's file and line, the first `find` becomes `replace`. */
  | { kind: 'replace'; find: string; replace: string }
  /** \end{document} at the end of the main file. */
  | { kind: 'endDocument' };

export interface ErrorHelp {
  /** Message id: help.<id> in the web app's translations. */
  id: string;
  /** Values for the message ({{cmd}}, {{pkg}}, ...). */
  params: Record<string, string>;
  fix?: QuickFix;
}

/** Commands and the package that defines them. */
const COMMAND_PACKAGES: Record<string, string> = {
  includegraphics: 'graphicx', graphicspath: 'graphicx', scalebox: 'graphicx', resizebox: 'graphicx', rotatebox: 'graphicx',
  textcolor: 'xcolor', color: 'xcolor', colorbox: 'xcolor', definecolor: 'xcolor', rowcolor: 'xcolor', cellcolor: 'xcolor',
  href: 'hyperref', url: 'hyperref', hypersetup: 'hyperref', autoref: 'hyperref',
  mathbb: 'amssymb', mathfrak: 'amssymb', varnothing: 'amssymb', leqslant: 'amssymb', geqslant: 'amssymb', square: 'amssymb',
  blacktriangleright: 'amssymb', checkmark: 'amssymb', therefore: 'amssymb', because: 'amssymb', nleq: 'amssymb',
  text: 'amsmath', dfrac: 'amsmath', tfrac: 'amsmath', binom: 'amsmath', cfrac: 'amsmath', eqref: 'amsmath',
  DeclareMathOperator: 'amsmath', operatorname: 'amsmath', boxed: 'amsmath', xrightarrow: 'amsmath', intertext: 'amsmath',
  iint: 'amsmath', iiint: 'amsmath', overset: 'amsmath', underset: 'amsmath', tag: 'amsmath', numberwithin: 'amsmath',
  SI: 'siunitx', si: 'siunitx', num: 'siunitx', qty: 'siunitx', unit: 'siunitx',
  tikz: 'tikz', usetikzlibrary: 'tikz', tikzset: 'tikz', pgfmathsetmacro: 'tikz', foreach: 'tikz',
  pgfplotsset: 'pgfplots', addplot: 'pgfplots',
  multirow: 'multirow', toprule: 'booktabs', midrule: 'booktabs', bottomrule: 'booktabs', cmidrule: 'booktabs',
  qrcode: 'qrcode', ce: 'mhchem', degree: 'gensymb', celsius: 'gensymb', sout: 'ulem', uline: 'ulem', uwave: 'ulem',
  cancel: 'cancel', bcancel: 'cancel', cancelto: 'cancel', lstinline: 'listings', lstset: 'listings',
  newtcolorbox: 'tcolorbox', tcbset: 'tcolorbox', tcbuselibrary: 'tcolorbox',
  fancyhead: 'fancyhdr', fancyfoot: 'fancyhdr', fancyhf: 'fancyhdr', fancypagestyle: 'fancyhdr',
  titleformat: 'titlesec', titlespacing: 'titlesec', setlist: 'enumitem', newlist: 'enumitem',
  geometry: 'geometry', newgeometry: 'geometry', restoregeometry: 'geometry', onehalfspacing: 'setspace', doublespacing: 'setspace',
  setstretch: 'setspace', captionof: 'caption', captionsetup: 'caption', subcaption: 'subcaption', makecell: 'makecell',
  hl: 'soul', ul: 'soul', st: 'soul', needspace: 'needspace', ifthenelse: 'ifthen', xspace: 'xspace', lipsum: 'lipsum',
  pagecolor: 'xcolor', newfontfamily: 'fontspec', setmainfont: 'fontspec', setsansfont: 'fontspec', setmonofont: 'fontspec',
  coloneqq: 'mathtools', mathclap: 'mathtools', DeclarePairedDelimiter: 'mathtools', bm: 'bm', euro: 'eurosym',
  printindex: 'imakeidx', makeindex: 'imakeidx', columnbreak: 'multicol', AddToShipoutPictureBG: 'eso-pic',
  NewDocumentCommand: 'xparse', ifdefempty: 'etoolbox', AtEndEnvironment: 'etoolbox',
};

/** Environments and their packages. */
const ENVIRONMENT_PACKAGES: Record<string, string> = {
  align: 'amsmath', 'align*': 'amsmath', gather: 'amsmath', 'gather*': 'amsmath', multline: 'amsmath', 'multline*': 'amsmath',
  'equation*': 'amsmath', alignat: 'amsmath', 'alignat*': 'amsmath', flalign: 'amsmath', cases: 'amsmath', pmatrix: 'amsmath',
  bmatrix: 'amsmath', vmatrix: 'amsmath', Vmatrix: 'amsmath', matrix: 'amsmath', split: 'amsmath', aligned: 'amsmath',
  gathered: 'amsmath', smallmatrix: 'amsmath', subequations: 'amsmath', proof: 'amsthm',
  tikzpicture: 'tikz', scope: 'tikz', axis: 'pgfplots', semilogyaxis: 'pgfplots', loglogaxis: 'pgfplots', polaraxis: 'pgfplots',
  tcolorbox: 'tcolorbox', multicols: 'multicol', 'multicols*': 'multicol', tabularx: 'tabularx', longtable: 'longtable',
  lstlisting: 'listings', minted: 'minted', wrapfigure: 'wrapfig', subfigure: 'subcaption', landscape: 'pdflscape',
  spacing: 'setspace', adjustbox: 'adjustbox', circuitikz: 'circuitikz', forest: 'forest', mdframed: 'mdframed', framed: 'framed',
  'tabular*': 'array', tblr: 'tabularray', comment: 'comment', CJK: 'CJK', otherlanguage: 'babel',
};

/** Declarations for Uzbek/Russian function names that LaTeX does not have. */
const MATH_OPERATORS: Record<string, string> = {
  tg: 'tg', ctg: 'ctg', arctg: 'arctg', arcctg: 'arcctg', cosec: 'cosec', sh: 'sh', ch: 'ch', th: 'th', cth: 'cth', lg: 'lg',
};

/** Commands people mistype, for "did you mean". */
const COMMON = [
  'frac', 'dfrac', 'sqrt', 'begin', 'end', 'section', 'subsection', 'chapter', 'textbf', 'textit', 'emph', 'underline', 'item',
  'label', 'ref', 'cite', 'includegraphics', 'caption', 'centering', 'left', 'right', 'cdot', 'times', 'div', 'leq', 'geq',
  'neq', 'infty', 'int', 'sum', 'prod', 'lim', 'sin', 'cos', 'tan', 'log', 'ln', 'alpha', 'beta', 'gamma', 'delta', 'pi',
  'theta', 'lambda', 'sigma', 'omega', 'varphi', 'epsilon', 'mathbb', 'mathrm', 'text', 'quad', 'qquad', 'hline', 'vspace',
  'hspace', 'newpage', 'clearpage', 'noindent', 'textwidth', 'linewidth', 'usepackage', 'documentclass', 'maketitle',
  'tableofcontents', 'footnote', 'overline', 'vec', 'hat', 'angle', 'triangle', 'parallel', 'perp', 'approx', 'equiv',
  'pm', 'mp', 'circ', 'ldots', 'cdots', 'rightarrow', 'Rightarrow', 'leftrightarrow', 'Leftrightarrow', 'subset', 'in',
  'notin', 'cup', 'cap', 'emptyset', 'forall', 'exists', 'partial', 'nabla', 'displaystyle', 'textcolor', 'small', 'large',
  'Large', 'huge', 'bigskip', 'medskip', 'smallskip', 'newcommand', 'renewcommand', 'paragraph', 'tabular', 'multicolumn',
];

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      // Swapped neighbours (frca -> frac) count as one.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/** The known command a typo most likely meant (one unique best match). */
export function closestCommand(name: string): string | null {
  if (name.length < 2) return null;
  const limit = name.length >= 6 ? 2 : 1;
  let best: string | null = null;
  let bestD = limit + 1;
  let tie = false;
  for (const c of COMMON) {
    const dd = distance(name, c);
    if (dd < bestD) {
      best = c;
      bestD = dd;
      tie = false;
    } else if (dd === bestD) tie = true;
  }
  return best && !tie ? best : null;
}

/** The undefined command: TeX shows it at the end of the source excerpt (l.12 ... \foo). */
function undefinedCommand(entry: LogEntry): string | null {
  for (const l of entry.context.split('\n')) {
    const m = /\\([A-Za-z@]+)\*?\s*$/.exec(l.replace(/^l\.\d+\s?/, ''));
    if (m) return m[1]!;
  }
  return null;
}

/** Help for one log entry, or null when there is nothing better to say than the message itself. */
export function explainError(entry: LogEntry): ErrorHelp | null {
  const msg = entry.message.replace(/^!\s*/, '');
  let m: RegExpExecArray | null;

  if (/^Undefined control sequence/.test(msg)) {
    const cmd = undefinedCommand(entry);
    if (!cmd) return { id: 'undefined', params: { cmd: '?' } };
    if (MATH_OPERATORS[cmd]) {
      return { id: 'operator', params: { cmd }, fix: { kind: 'preamble', line: `\\providecommand{\\${cmd}}{\\operatorname{${MATH_OPERATORS[cmd]}}}` } };
    }
    if (cmd === 'chapter') return { id: 'chapterInArticle', params: { cmd } };
    const pkg = COMMAND_PACKAGES[cmd];
    if (pkg) return { id: 'needsPackage', params: { cmd, pkg }, fix: { kind: 'package', pkg } };
    const near = closestCommand(cmd);
    if (near) return { id: 'typo', params: { cmd, near }, fix: { kind: 'replace', find: `\\${cmd}`, replace: `\\${near}` } };
    return { id: 'undefined', params: { cmd } };
  }
  if ((m = /Environment (\S+) undefined/.exec(msg))) {
    const env = m[1]!;
    const pkg = ENVIRONMENT_PACKAGES[env];
    if (pkg) return { id: 'envNeedsPackage', params: { env, pkg }, fix: { kind: 'package', pkg } };
    return { id: 'envUndefined', params: { env } };
  }
  if ((m = /\\begin\{([^}]*)\} on input line (\d+) ended by \\end\{([^}]*)\}/.exec(msg))) {
    return { id: 'envMismatch', params: { begin: m[1]!, line: m[2]!, end: m[3]! } };
  }
  if ((m = /\\begin\{([^}]*)\} ended by \\end\{document\}/.exec(msg))) return { id: 'envUnclosed', params: { env: m[1]! } };
  if ((m = /\\begin\{([^}]*)\} ended by \\end\{([^}]*)\}/.exec(msg))) {
    // \begin{document} ended by \end{align}: the \begin of that environment failed earlier.
    return m[1] === 'document' ? { id: 'endWithoutBegin', params: { env: m[2]! } } : { id: 'envMismatch', params: { begin: m[1]!, line: '?', end: m[2]! } };
  }
  if ((m = /File [`'"]?([^`'"]+?)['"]? not found/.exec(msg))) {
    const file = m[1]!;
    return { id: /\.(sty|cls)$/.test(file) ? 'packageMissing' : 'fileMissing', params: { file } };
  }
  if ((m = /Command \\(\S+) already defined/.exec(msg))) {
    return { id: 'alreadyDefined', params: { cmd: m[1]! }, fix: { kind: 'replace', find: '\\newcommand', replace: '\\renewcommand' } };
  }
  if ((m = /Unicode character (\S+) \(U\+([0-9A-F]+)\)/.exec(msg))) return { id: 'unicode', params: { char: m[1]!, code: m[2]! } };
  if (/^Missing \$ inserted/.test(msg)) return { id: 'missingDollar', params: {} };
  if (/^Extra \}, or forgotten \$/.test(msg)) return { id: 'extraBraceOrDollar', params: {} };
  if (/^Missing \} inserted/.test(msg)) return { id: 'missingBrace', params: {} };
  if (/^Too many \}'s/.test(msg)) return { id: 'tooManyBraces', params: {} };
  if ((m = /^File ended while scanning use of \\(\S+?)\.?$/.exec(msg))) return { id: 'unclosedArgument', params: { cmd: m[1]! } };
  if ((m = /^Paragraph ended before \\(\S+?) was complete/.exec(msg))) return { id: 'paragraphInArgument', params: { cmd: m[1]! } };
  if (/^Misplaced alignment tab character &/.test(msg)) {
    return { id: 'ampersand', params: {}, fix: { kind: 'replace', find: '&', replace: '\\&' } };
  }
  if (/^Extra alignment tab has been changed/.test(msg)) return { id: 'tooManyColumns', params: {} };
  if (/macro parameter character #/.test(msg) || /^Illegal parameter number in definition/.test(msg)) {
    return { id: 'hash', params: {}, fix: { kind: 'replace', find: '#', replace: '\\#' } };
  }
  if (/There's no line here to end/.test(msg)) return { id: 'noLineToEnd', params: {} };
  if (/Something's wrong--perhaps a missing \\item/.test(msg)) return { id: 'missingItem', params: {} };
  if (/^Double (superscript|subscript)/.test(msg)) return { id: 'doubleScript', params: {} };
  if (/^Missing \\right\. inserted/.test(msg)) return { id: 'leftRight', params: {} };
  if (/Can be used only in preamble/.test(msg)) return { id: 'preambleOnly', params: {} };
  if (/Missing \\begin\{document\}/.test(msg)) return { id: 'missingBeginDocument', params: {} };
  if ((m = /Option clash for package (\S+?)\.?$/.exec(msg))) return { id: 'optionClash', params: { pkg: m[1]! } };
  if (/^Dimension too large/.test(msg)) return { id: 'dimensionTooLarge', params: {} };
  if (/Invalid UTF-8 byte/.test(msg)) return { id: 'notUtf8', params: {} };
  if (/Bad math environment delimiter/.test(msg)) return { id: 'mathDelimiter', params: {} };
  if (/Display math should end with \$\$/.test(msg)) return { id: 'displayDollars', params: {} };
  if (/no legal \\end found/.test(`${msg}\n${entry.context}`)) return { id: 'noEnd', params: {}, fix: { kind: 'endDocument' } };
  // Any other emergency stop is the result of an earlier error (a missing \input file, ...).
  if (/^Emergency stop|^==> Fatal error/.test(msg)) return { id: 'emergency', params: {} };
  if (/Lonely \\item/.test(msg)) return { id: 'lonelyItem', params: {} };
  if (/^Undefined color/.test(msg) || (m = /Undefined color [`'"]?([^'"`]+)/.exec(msg))) return { id: 'undefinedColor', params: { color: m?.[1] ?? '' } };
  if (/Illegal unit of measure/.test(msg)) return { id: 'unit', params: {} };
  if (/Missing number, treated as zero/.test(msg)) return { id: 'missingNumber', params: {} };
  if (/Not in outer par mode/.test(msg)) return { id: 'outerPar', params: {} };
  if (/Float\(s\) lost/.test(msg)) return { id: 'floatLost', params: {} };

  // Warnings.
  if ((m = /Reference [`']([^']+)' on page \d+ undefined/.exec(msg))) return { id: 'refUndefined', params: { label: m[1]! } };
  if ((m = /Citation [`']([^']+)' on page \d+ undefined/.exec(msg))) return { id: 'citeUndefined', params: { label: m[1]! } };
  if ((m = /Label [`']([^']+)' multiply defined/.exec(msg))) return { id: 'labelTwice', params: { label: m[1]! } };
  if (/Missing characters: /.test(msg)) return { id: 'missingGlyphs', params: {} };
  if (/^Overfull \\hbox/.test(msg)) return { id: 'overfull', params: {} };
  if (/^Underfull \\hbox/.test(msg)) return { id: 'underfull', params: {} };
  if (/Font shape .* undefined/.test(msg)) return { id: 'fontShape', params: {} };
  return null;
}

/** A fixed line: the first `find` replaced (null when the line does not contain it). */
export function replaceInLine(line: string, find: string, replace: string): string | null {
  // \& and \# are already escaped: find the first unescaped one.
  for (let i = line.indexOf(find); i !== -1; i = line.indexOf(find, i + 1)) {
    if (find.length === 1 && line[i - 1] === '\\') continue;
    if (/^\\[A-Za-z]+$/.test(find) && /[A-Za-z]/.test(line[i + find.length] ?? '')) continue;
    return line.slice(0, i) + replace + line.slice(i + find.length);
  }
  return null;
}
