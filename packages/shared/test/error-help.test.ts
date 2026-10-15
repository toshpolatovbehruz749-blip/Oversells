import { describe, expect, it } from 'vitest';
import { closestCommand, explainError, replaceInLine } from '../src/error-help.js';
import type { LogEntry } from '../src/types.js';

// Messages and contexts as the log parser reads them from real pdfLaTeX/XeLaTeX logs.
const entry = (message: string, context = '', level: LogEntry['level'] = 'error'): LogEntry => ({ level, message, file: 'main.tex', line: 3, context });

describe('explainError', () => {
  it('finds the package of an undefined command, a typo, or an Uzbek function name', () => {
    expect(explainError(entry('Undefined control sequence.', 'l.3 Rasm: \\includegraphics\n{a.png}'))).toEqual({
      id: 'needsPackage',
      params: { cmd: 'includegraphics', pkg: 'graphicx' },
      fix: { kind: 'package', pkg: 'graphicx' },
    });
    expect(explainError(entry('Undefined control sequence.', 'l.4 Formula: $\\frca\n{1}{2}$'))?.fix).toEqual({ kind: 'replace', find: '\\frca', replace: '\\frac' });
    expect(explainError(entry('Undefined control sequence.', 'l.4 Formula: $\\frac{1}{2}$ va $\\tg\n x$'))?.fix).toEqual({
      kind: 'preamble',
      line: '\\providecommand{\\tg}{\\operatorname{tg}}',
    });
    expect(explainError(entry('Undefined control sequence.', 'l.9 \\mycommand'))).toEqual({ id: 'undefined', params: { cmd: 'mycommand' } });
  });

  it('knows environments, mismatched ends and the real cause of an emergency stop', () => {
    expect(explainError(entry('LaTeX Error: Environment align undefined.'))?.fix).toEqual({ kind: 'package', pkg: 'amsmath' });
    expect(explainError(entry('LaTeX Error: \\begin{itemize} on input line 9 ended by \\end{enumerate}.'))).toEqual({
      id: 'envMismatch',
      params: { begin: 'itemize', line: '9', end: 'enumerate' },
    });
    expect(explainError(entry('LaTeX Error: \\begin{document} ended by \\end{align}.'))?.id).toBe('endWithoutBegin');
    expect(explainError(entry('Emergency stop.', '*** (job aborted, no legal \\end found)'))?.fix).toEqual({ kind: 'endDocument' });
    expect(explainError(entry('Emergency stop.', 'l.14 \\input{yoq}'))).toEqual({ id: 'emergency', params: {} });
    expect(explainError(entry("LaTeX Error: File `yoq.tex' not found."))?.id).toBe('fileMissing');
    expect(explainError(entry("LaTeX Error: File `qrcodex.sty' not found."))?.id).toBe('packageMissing');
  });

  it('offers safe replacements for special characters and redefinitions', () => {
    expect(explainError(entry('Misplaced alignment tab character &.'))?.fix).toEqual({ kind: 'replace', find: '&', replace: '\\&' });
    expect(explainError(entry("You can't use `macro parameter character #' in horizontal mode."))?.fix).toEqual({ kind: 'replace', find: '#', replace: '\\#' });
    expect(explainError(entry('LaTeX Error: Command \\section already defined.'))?.fix).toEqual({ kind: 'replace', find: '\\newcommand', replace: '\\renewcommand' });
    expect(explainError(entry('Missing $ inserted.'))?.id).toBe('missingDollar');
    expect(explainError(entry('LaTeX Warning: Reference `fig1\' on page 2 undefined on input line 5.', '', 'warning'))).toEqual({
      id: 'refUndefined',
      params: { label: 'fig1' },
    });
    expect(explainError(entry('Something unknown'))).toBeNull();
  });
});

describe('helpers', () => {
  it('suggests the command a typo meant, only when it is clear', () => {
    expect(closestCommand('frca')).toBe('frac');
    expect(closestCommand('sqtr')).toBe('sqrt');
    expect(closestCommand('beign')).toBe('begin');
    expect(closestCommand('includegrapics')).toBe('includegraphics');
    expect(closestCommand('qwertyuiop')).toBeNull();
  });

  it('replaces the first unescaped occurrence in a line', () => {
    expect(replaceInLine('Narx 5 \\& 6 & 7', '&', '\\&')).toBe('Narx 5 \\& 6 \\& 7');
    expect(replaceInLine('\\newcommand{\\section}{x}', '\\newcommand', '\\renewcommand')).toBe('\\renewcommand{\\section}{x}');
    expect(replaceInLine('$\\frca{1}{2}$', '\\frca', '\\frac')).toBe('$\\frac{1}{2}$');
    expect(replaceInLine('\\fracx \\frac', '\\frac', '\\dfrac')).toBe('\\fracx \\dfrac');
    expect(replaceInLine('abc', '#', '\\#')).toBeNull();
  });
});
