/**
 * Finds the words to spell-check in LaTeX source. Skips:
 *  - comments (`% ...`), command names (`\section`), and the arguments of
 *    commands whose arguments are not prose (labels, references, packages,
 *    file names, lengths, colours, ...);
 *  - math: `$...$`, `$$...$$`, `\(...\)`, `\[...\]` and math environments;
 *  - environments whose content is code or drawing (verbatim, tikzpicture, ...);
 *  - environment names in `\begin{...}` / `\end{...}`.
 * Apostrophes inside words are kept (Uzbek oʻ, gʻ, ʼ and their ASCII forms).
 */

export interface Token {
  word: string;
  from: number;
  to: number;
}

/** Commands whose following {…} (and […]) arguments are never prose. */
const NON_PROSE_ARGS = new Set([
  'label', 'ref', 'eqref', 'pageref', 'autoref', 'cref', 'Cref', 'nameref', 'cite', 'citep', 'citet', 'nocite',
  'usepackage', 'RequirePackage', 'documentclass', 'input', 'include', 'includeonly', 'includegraphics',
  'bibliography', 'bibliographystyle', 'addbibresource', 'url', 'href', 'begin', 'end', 'newcommand',
  'renewcommand', 'providecommand', 'newenvironment', 'renewenvironment', 'DeclareMathOperator',
  'setmainfont', 'setsansfont', 'setmonofont', 'newfontfamily', 'setmathfont', 'babelprovide',
  'selectlanguage', 'foreignlanguage', 'setlocalecaption', 'pgfplotsset', 'usetikzlibrary', 'usepgfplotslibrary',
  'tikzset', 'hspace', 'vspace', 'setlength', 'addtolength', 'setcounter', 'addtocounter', 'color',
  'textcolor', 'colorbox', 'definecolor', 'newtheorem', 'theoremstyle', 'pagestyle', 'thispagestyle',
  'captionsetup', 'geometry', 'hypersetup', 'newcounter', 'numberwithin', 'graphicspath', 'lhead', 'rhead',
  'chead', 'lfoot', 'rfoot', 'cfoot', 'fancyhead', 'fancyfoot', 'rule', 'raisebox', 'makebox', 'framebox',
  'parbox', 'resizebox', 'scalebox', 'node', 'draw', 'fill', 'path', 'coordinate', 'addplot', 'pointpoints',
  'hqword', 'hpword', 'hsword', 'htword', 'vqword', 'vpword', 'vsword', 'vtword', 'bibitem', 'linespread',
  'fontsize', 'fontspec', 'texttt', 'verb', 'lstinline', 'mintinline',
]);

/** Environments whose whole content is skipped (code, drawings, math). */
const SKIPPED_ENVS = new Set([
  'verbatim', 'Verbatim', 'lstlisting', 'minted', 'comment', 'tikzpicture', 'axis', 'pgfpicture',
  'equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'flalign',
  'flalign*', 'alignat', 'alignat*', 'eqnarray', 'eqnarray*', 'math', 'displaymath', 'filecontents',
]);

const LETTER = /[\p{L}\p{M}]/u;
const APOSTROPHES = new Set(["'", '’', '‘', 'ʻ', 'ʼ', '`']);

/** Index after the closing brace matching the `{` at `start` (or end of text). */
function skipGroup(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return i + 1;
  }
  return text.length;
}

function skipSpaces(text: string, i: number): number {
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  return i;
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i]!;

    if (c === '%') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? n : nl + 1;
      continue;
    }

    if (c === '$') {
      // $$...$$ or $...$
      const double = text[i + 1] === '$';
      const end = text.indexOf(double ? '$$' : '$', i + (double ? 2 : 1));
      i = end === -1 ? n : end + (double ? 2 : 1);
      continue;
    }

    if (c === '\\') {
      const next = text[i + 1] ?? '';
      if (next === '(' || next === '[') {
        const end = text.indexOf(next === '(' ? '\\)' : '\\]', i + 2);
        i = end === -1 ? n : end + 2;
        continue;
      }
      const m = /^\\([A-Za-z@]+\*?)/.exec(text.slice(i, i + 64));
      if (!m) {
        i += 2; // escaped character such as \% or \\
        continue;
      }
      const name = m[1]!;
      i += m[0].length;

      if (name === 'verb' || name === 'lstinline') {
        const delim = text[i];
        if (delim && delim !== '{') {
          const end = text.indexOf(delim, i + 1);
          i = end === -1 ? n : end + 1;
          continue;
        }
      }

      if (name === 'begin') {
        const j = skipSpaces(text, i);
        const env = /^\{([^}]*)\}/.exec(text.slice(j, j + 64));
        if (env && SKIPPED_ENVS.has(env[1]!)) {
          const endTag = `\\end{${env[1]}}`;
          const end = text.indexOf(endTag, j);
          i = end === -1 ? n : end + endTag.length;
          continue;
        }
      }

      if (NON_PROSE_ARGS.has(name.replace(/\*$/, ''))) {
        // Skip all directly following [...] and {...} arguments.
        for (;;) {
          const j = skipSpaces(text, i);
          if (text[j] === '[') i = skipGroup(text, j, '[', ']');
          else if (text[j] === '{') i = skipGroup(text, j, '{', '}');
          else break;
        }
      } else {
        // Optional arguments of other commands are options too (e.g. \section[short] is rare).
        const j = skipSpaces(text, i);
        if (text[j] === '[' && /^\[[^\]\n]*=/.test(text.slice(j, j + 200))) i = skipGroup(text, j, '[', ']');
      }
      continue;
    }

    if (LETTER.test(c)) {
      const from = i;
      let j = i + 1;
      while (j < n) {
        const d = text[j]!;
        if (LETTER.test(d)) j++;
        else if (APOSTROPHES.has(d) && j + 1 < n && LETTER.test(text[j + 1]!)) j += 2;
        else if (APOSTROPHES.has(d) && /[oOgG]/.test(text[j - 1]!)) j++; // oʻ / gʻ at a word end
        else break;
      }
      // A trailing apostrophe after o/g belongs to the word only when it is a modifier letter.
      let to = j;
      while (to > from + 1 && (text[to - 1] === "'" || text[to - 1] === '`' || text[to - 1] === '’')) to--;
      const word = text.slice(from, to);
      if ([...word].length >= 2 && !/\d/.test(word)) tokens.push({ word, from, to });
      i = j;
      continue;
    }

    i++;
  }
  return tokens;
}

/** Canonical form of Uzbek Latin apostrophes for dictionary lookup (oʻ gʻ with ʻ, others ʼ). */
export function normalizeUzbekLatin(word: string): string {
  return word.replace(/([oOgG])['’‘`ʼ]/g, '$1ʻ').replace(/['’‘`]/g, 'ʼ');
}

export type Script = 'latin' | 'cyrillic' | 'other';

export function scriptOf(word: string): Script {
  if (/[Ѐ-ӿ]/.test(word)) return 'cyrillic';
  if (/[A-Za-zÀ-ɏ]/.test(word)) return 'latin';
  return 'other';
}
