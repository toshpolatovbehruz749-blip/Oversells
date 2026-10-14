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

  it('gives a document without fontspec all three families and comments out its pdfLaTeX font lines', () => {
    const doc = [
      '\\documentclass[10pt,twoside]{book}',
      '\\usepackage[utf8]{inputenc}',
      '\\usepackage[T2A,T1]{fontenc}',
      '\\usepackage{lmodern}',
      '\\usepackage[russian]{babel}',
      '\\begin{document}',
      'УЎК 51',
      '\\end{document}',
    ].join('\n');
    const p = fontProblem([warn(missingMessage('larm1000', ['У', 'Ў'])), warn(missingMessage('larm1440', ['Б']))])!;
    expect(p.fonts.map((f) => f.role)).toEqual(['main', 'main']);
    const r = fixFonts(doc, p, 'xelatex');
    expect(r.compiler).toBeNull();
    expect(r.text).toContain('% \\usepackage[utf8]{inputenc} % pdfLaTeX uchun');
    expect(r.text).toContain('% \\usepackage[T2A,T1]{fontenc}');
    expect(r.text).toContain('% \\usepackage{lmodern}');
    expect(r.text).toContain('\\usepackage[russian]{babel}\n');
    expect(r.text).toContain(
      '\\usepackage{fontspec}\n\\setmainfont{Noto Serif}\n\\setsansfont{Noto Sans}\n\\setmonofont{DejaVu Sans Mono}\n\\begin{document}',
    );
  });

  it('changes only the families that lack letters when fontspec is already loaded', () => {
    const doc = '\\documentclass{article}\n\\usepackage{fontspec}\n\\setmainfont{Inter}\n\\usepackage{dizayn}\n\\begin{document}\nКод\n\\end{document}\n';
    const p = fontProblem([warn(missingMessage('lmmono10-regular', ['К']))])!;
    const r = fixFonts(doc, p, 'xelatex');
    expect(r.text).toContain('\\usepackage{dizayn}\n% Kirill');
    expect(r.text).toContain('\\setmonofont{DejaVu Sans Mono}\n\\begin{document}');
    expect(r.text).not.toContain('setmainfont{Noto');
    expect(r.text!.match(/usepackage\{fontspec\}/g)).toHaveLength(1);
  });

  it('knows the LH Cyrillic fonts of pdfLaTeX preambles', () => {
    expect(fontRole('lass1000')).toBe('sans');
    expect(fontRole('latt1000')).toBe('mono');
    expect(fontRole('ec-lmss10')).toBe('sans');
  });

  it('moves a pdfLaTeX document to XeLaTeX with a font', () => {
    const p = fontProblem([err('LaTeX Error: Unicode character У (U+0423)')])!;
    expect(p.pdflatex).toBe(true);
    const r = fixFonts(DOC, p, 'pdflatex');
    expect(r.compiler).toBe('xelatex');
    expect(r.text).toContain('\\setmonofont{DejaVu Sans Mono}\n\\begin{document}');
    expect(r.text).toContain('% \\usepackage{lmodern}');
  });

  it('only advises \\text{} for letters in formulas', () => {
    const p = fontProblem([warn(missingMessage('cmmi10', ['Ў']))])!;
    expect(fixFonts(DOC, p, 'xelatex')).toEqual({ text: null, compiler: null, mathOnly: true });
  });
});
