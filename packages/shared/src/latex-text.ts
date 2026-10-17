/**
 * Splits LaTeX into the parts that are prose and the parts that are maths,
 * skipping the preamble, comments, command names, arguments that are names,
 * keys or paths (\\label, \\includegraphics...) and code-like environments.
 * Used by the typing fixes (web) and the Latin/Cyrillic converter.
 */

/** Environments whose content is code or drawing commands, never prose. */
export const RAW_ENVS = new Set(['verbatim', 'Verbatim', 'lstlisting', 'minted', 'comment', 'tikzpicture', 'axis', 'koordinata', 'chizma', 'tabular']);
export const MATH_ENVS = new Set([
  'equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*', 'gather', 'gather*', 'multline', 'multline*',
  'flalign', 'flalign*', 'eqnarray', 'eqnarray*', 'math', 'displaymath',
]);
/** Commands whose (first) braced argument is a name, key, path or code. */
const KEY_ARG_COMMANDS = new Set([
  'label', 'ref', 'eqref', 'pageref', 'cref', 'Cref', 'autoref', 'cite', 'citep', 'citet', 'nocite', 'usepackage',
  'RequirePackage', 'documentclass', 'input', 'include', 'includeonly', 'includegraphics', 'bibliography',
  'bibliographystyle', 'addbibresource', 'url', 'href', 'begin', 'end', 'newcommand', 'renewcommand',
  'providecommand', 'DeclareMathOperator', 'newenvironment', 'renewenvironment', 'setmainfont', 'setsansfont',
  'setmonofont', 'newfontfamily', 'babelprovide', 'selectlanguage', 'foreignlanguage', 'color', 'textcolor',
  'definecolor', 'pagestyle', 'thispagestyle', 'setlength', 'addtolength', 'hspace', 'vspace', 'tikz',
  'usetikzlibrary', 'pgfplotsset', 'tcbset', 'hypersetup', 'geometry', 'operatorname', 'mathrm', 'text',
  'textrm', 'mbox', 'verb', 'lstinline', 'daraja', 'texttt', 'path', 'nolinkurl',
]);
/** Commands whose braced argument is text inside maths (left alone by the formula rules). */
const MATH_TEXT_COMMANDS = new Set(['text', 'textrm', 'textit', 'textbf', 'mbox', 'operatorname', 'mathrm', 'intertext']);

/** Commands whose last braced argument is a formula (\\muhim[title]{formula}). */
const MATH_ARG_COMMANDS = new Set(['muhim', 'ensuremath', 'boxed']);

/** Environments whose arguments right after \\begin are placement or column specifications. */
const SPEC_ENVS = new Set([
  'tabular', 'tabular*', 'tabularx', 'longtable', 'array', 'minipage', 'figure', 'figure*', 'table', 'table*',
  'wrapfigure', 'multicols', 'otherlanguage', 'otherlanguage*', 'tcolorbox', 'enumerate', 'itemize',
]);

export interface Segment {
  from: number;
  to: number;
  math: boolean;
}

/** Splits the document body into prose and maths, skipping everything else. */
export function segments(text: string, opts: { rawEnvs?: Set<string> } = {}): Segment[] {
  const raw = opts.rawEnvs ?? RAW_ENVS;
  const out: Segment[] = [];
  const begin = text.indexOf('\\begin{document}');
  let i = begin === -1 ? 0 : begin + '\\begin{document}'.length;
  const end = text.indexOf('\\end{document}');
  const stop = end === -1 ? text.length : end;
  let segStart = i;
  let math = false;
  let mathClose = '';
  const envStack: string[] = [];

  const flush = (to: number) => {
    if (to > segStart && !envStack.some((e) => raw.has(e))) out.push({ from: segStart, to, math });
  };
  const skipTo = (pos: number, nextMath = math) => {
    flush(i);
    i = pos;
    math = nextMath;
    segStart = i;
  };
  /** End of a balanced {...} starting at `pos` (which holds '{'), or -1. */
  const braceEnd = (pos: number): number => {
    let depth = 0;
    for (let j = pos; j < stop; j++) {
      const c = text[j];
      if (c === '\\') {
        j++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return j + 1;
    }
    return -1;
  };

  while (i < stop) {
    const c = text[i]!;
    if (c === '%') {
      const nl = text.indexOf('\n', i);
      skipTo(nl === -1 ? stop : nl);
      continue;
    }
    if (math && mathClose && text.startsWith(mathClose, i) && !(mathClose === '$' && text[i + 1] === '$')) {
      skipTo(i + mathClose.length, false);
      mathClose = '';
      continue;
    }
    if (c === '$') {
      if (math) {
        i++;
        continue;
      }
      const display = text[i + 1] === '$';
      skipTo(i + (display ? 2 : 1), true);
      mathClose = display ? '$$' : '$';
      continue;
    }
    if (c === '\\') {
      const name = /^\\([A-Za-z@]+\*?|.)/.exec(text.slice(i, i + 40))?.[1] ?? '';
      if (!math && (name === '[' || name === '(')) {
        skipTo(i + 2, true);
        mathClose = name === '[' ? '\\]' : '\\)';
        continue;
      }
      if (name === 'begin' || name === 'end') {
        const m = /^\\(begin|end)\{([^}]*)\}/.exec(text.slice(i, i + 80));
        if (m) {
          const env = m[2]!;
          if (m[1] === 'begin') {
            if (MATH_ENVS.has(env) && !math) {
              envStack.push(env);
              skipTo(i + m[0].length, true);
              mathClose = `\\end{${env}}`;
              continue;
            }
            flush(i);
            envStack.push(env);
          } else {
            flush(i);
            const at = envStack.lastIndexOf(env);
            if (at !== -1) envStack.length = at;
          }
          i += m[0].length;
          // Placement and column specs: \begin{figure}[h], \begin{tabular}{cc}, \begin{minipage}{5cm}.
          if (m[1] === 'begin' && SPEC_ENVS.has(env)) {
            for (;;) {
              let j = i;
              while (text[j] === ' ') j++;
              const close = text[j] === '[' ? text.indexOf(']', j) + 1 : text[j] === '{' ? braceEnd(j) : 0;
              if (close <= 0) break;
              i = close;
            }
          }
          segStart = i;
          continue;
        }
      }
      // Command name: never prose; some arguments are keys or code.
      flush(i);
      i += 1 + name.length;
      if (!math && MATH_ARG_COMMANDS.has(name)) {
        // [title] stays prose; the {formula} is maths.
        let j = i;
        while (text[j] === ' ') j++;
        if (text[j] === '[') {
          const close = text.indexOf(']', j);
          if (close !== -1) {
            out.push({ from: j + 1, to: close, math: false });
            j = close + 1;
          }
        }
        if (text[j] === '{') {
          const close = braceEnd(j);
          if (close !== -1) {
            out.push({ from: j + 1, to: close - 1, math: true });
            i = close;
          }
        }
        segStart = i;
        continue;
      }
      if (KEY_ARG_COMMANDS.has(name.replace(/\*$/, '')) || (math && MATH_TEXT_COMMANDS.has(name))) {
        let j = i;
        while (text[j] === ' ') j++;
        if (text[j] === '[') {
          const close = text.indexOf(']', j);
          if (close !== -1) j = close + 1;
        }
        if (text[j] === '{') {
          const close = braceEnd(j);
          if (close !== -1) i = close;
        }
      }
      segStart = i;
      continue;
    }
    i++;
  }
  flush(stop);
  return out.filter((s) => s.to > s.from);
}

