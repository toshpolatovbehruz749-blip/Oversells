import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseLatexLog, projectRelative } from '../../src/compile/log-parser.js';

const fixture = (name: string) =>
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures', name), 'utf8');

describe('parseLatexLog (real pdflatex log)', () => {
  const entries = parseLatexLog(fixture('errors.log'));
  const errors = entries.filter((e) => e.level === 'error');

  it('finds file:line errors in included files', () => {
    expect(errors[0]).toMatchObject({
      message: 'Undefined control sequence.',
      file: 'bolimlar/ch1.tex',
      line: 3,
    });
    expect(errors[0]!.context).toContain('l.3 \\undefinedmacro');
    expect(errors[1]).toMatchObject({
      message: expect.stringContaining('\\begin{itemize} on input line 4 ended by \\end{enumerate}'),
      file: 'bolimlar/ch1.tex',
      line: 6,
    });
    expect(errors[1]!.context).not.toContain('See the LaTeX manual');
  });

  it('reports classic "!" errors', () => {
    expect(errors.map((e) => e.message)).toEqual(
      expect.arrayContaining(['File ended while scanning use of \\frac .', 'Emergency stop.']),
    );
  });

  it('extracts warnings with file and line', () => {
    const warnings = entries.filter((e) => e.level === 'warning');
    expect(warnings).toEqual([
      expect.objectContaining({ file: 'main.tex', line: 5, message: expect.stringContaining("Reference `sec:missing'") }),
      expect.objectContaining({ file: 'main.tex', line: 5, message: expect.stringContaining("Citation `knuth'") }),
    ]);
  });

  it('reports bad boxes in the right file despite parentheses in help text', () => {
    const boxes = entries.filter((e) => e.level === 'typesetting');
    expect(boxes).toEqual([
      expect.objectContaining({ file: 'main.tex', line: 9, message: expect.stringMatching(/^Overfull \\hbox/) }),
    ]);
  });

  it('orders errors before warnings before typesetting', () => {
    const levels = entries.map((e) => e.level);
    expect(levels).toEqual([...levels].sort((a, b) => ['error', 'warning', 'typesetting'].indexOf(a) - ['error', 'warning', 'typesetting'].indexOf(b)));
  });
});

describe('parseLatexLog (synthetic)', () => {
  it('handles multi-line package warnings', () => {
    const log = [
      '(./main.tex',
      'Package hyperref Warning: Token not allowed in a PDF string (Unicode):',
      '(hyperref)                removing `math shift\' on input line 12.',
      '',
      ')',
    ].join('\n');
    expect(parseLatexLog(log)).toEqual([
      {
        level: 'warning',
        message: "Package hyperref Warning: Token not allowed in a PDF string (Unicode): removing `math shift' on input line 12.",
        file: 'main.tex',
        line: 12,
        context: '',
      },
    ]);
  });

  it('marks errors in system files without a project file', () => {
    const log = '/usr/share/texlive/texmf-dist/tex/latex/foo/foo.sty:10: Package foo Error: bad option.';
    expect(parseLatexLog(log)[0]).toMatchObject({ level: 'error', file: null, line: 10 });
  });

  it('deduplicates repeated entries and handles CRLF', () => {
    const log = './main.tex:3: Undefined control sequence.\r\nl.3 \\foo\r\n\r\n./main.tex:3: Undefined control sequence.\r\nl.3 \\foo\r\n';
    expect(parseLatexLog(log)).toHaveLength(1);
  });

  it('returns nothing for a clean log', () => {
    expect(parseLatexLog('This is XeTeX\n(./main.tex [1] )\nOutput written on main.xdv')).toEqual([]);
  });
});

describe('projectRelative', () => {
  it('maps log paths to project paths', () => {
    expect(projectRelative('./a/b.tex')).toBe('a/b.tex');
    expect(projectRelative('/work/a.tex')).toBe('a.tex');
    expect(projectRelative('/usr/share/x.sty')).toBeNull();
    expect(projectRelative('main.tex')).toBe('main.tex');
  });
});
