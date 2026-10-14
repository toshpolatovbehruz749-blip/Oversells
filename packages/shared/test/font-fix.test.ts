import { describe, expect, it } from 'vitest';
import { fixFonts, fontProblem, fontRole, missingMessage } from '../src/font-fix.js';
import type { LogEntry } from '../src/types.js';

const warn = (message: string): LogEntry => ({ level: 'warning', message, file: 'main.tex', line: null, context: '' });
const err = (message: string): LogEntry => ({ level: 'error', message, file: 'main.tex', line: 3, context: '' });

const DOC = '\\documentclass{article}\n\\usepackage{lmodern}\n\\begin{document}\nУЎК 51\n\\end{document}\n';

describe('font problems', () => {
  it('knows the role of a font from its name', () => {
    expect(fontRole('lmroman10-regular')).toBe('main');
    expect(fontRole('lmsans10-regular')).toBe('sans');
    expect(fontRole('lmmono10-regular')).toBe('mono');
    expect(fontRole('cmmi10')).toBe('math');
    expect(fontRole('latinmodern-math')).toBe('math');
    expect(fontRole('TimesNewRoman')).toBe('main');
  });

  it('reads the missing letters from the log entries', () => {
    const p = fontProblem([warn(missingMessage('lmroman10-regular', ['У', 'Ў', 'К'])), warn(missingMessage('lmmono10-regular', ['К']))]);
    expect(p).toEqual({
      fonts: [
        { font: 'lmroman10-regular', role: 'main', chars: ['У', 'Ў', 'К'] },
        { font: 'lmmono10-regular', role: 'mono', chars: ['К'] },
      ],
      pdflatex: false,
      chars: ['У', 'Ў', 'К'],
    });
    expect(fontProblem([warn('LaTeX Warning: Reference undefined')])).toBeNull();
  });

  it('sets fonts with these letters before \\begin{document}', () => {
    const p = fontProblem([warn(missingMessage('lmroman10-regular', ['У'])), warn(missingMessage('lmmono10-regular', ['К']))])!;
    const r = fixFonts(DOC, p, 'xelatex');
    expect(r.compiler).toBeNull();
    expect(r.text).toContain('\\usepackage{fontspec}\n\\setmainfont{Noto Serif}\n\\setmonofont{DejaVu Sans Mono}\n\\begin{document}');
    expect(r.text).not.toContain('setsansfont');
  });

  it('moves a pdfLaTeX document to XeLaTeX with a font', () => {
    const p = fontProblem([err('LaTeX Error: Unicode character У (U+0423)')])!;
    expect(p.pdflatex).toBe(true);
    const r = fixFonts(DOC, p, 'pdflatex');
    expect(r.compiler).toBe('xelatex');
    expect(r.text).toContain('\\setmainfont{Noto Serif}\n\\begin{document}');
  });

  it('only advises \\text{} for letters in formulas', () => {
    const p = fontProblem([warn(missingMessage('cmmi10', ['Ў']))])!;
    expect(fixFonts(DOC, p, 'xelatex')).toEqual({ text: null, compiler: null, mathOnly: true });
  });
});
