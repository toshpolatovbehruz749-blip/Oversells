import { describe, expect, it } from 'vitest';
import { fixFonts, fontProblem, fontRole, missingFontName, missingMessage, replaceFontCommand, substituteFont } from '../src/font-fix.js';
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

  it('adds the sans font when only the main font was set (contents and headings in \\sffamily)', () => {
    const doc = '\\documentclass{book}\n\\usepackage{fontspec}\n\\setmainfont{Noto Serif}\n\\usepackage[russian]{babel}\n\\begin{document}\n\\tableofcontents\n\\end{document}\n';
    const p = fontProblem([warn(missingMessage('lmsans10-bold', ['Н', 'а'])), warn(missingMessage('lmsans9-regular', ['Д']))])!;
    const r = fixFonts(doc, p, 'xelatex');
    expect(r.text).toContain('\\setsansfont{Noto Sans}\n\\begin{document}');
    expect(r.text!.match(/setmainfont/g)).toHaveLength(1);
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

  it('teaches pdfLaTeX the Uzbek ʻ and ʼ and keeps its fonts when only they are missing', () => {
    const doc = '\\documentclass{book}\n\\usepackage[T1]{fontenc}\n\\usepackage{mathpazo}\n\\usepackage[scaled=.92]{helvet}\n\\begin{document}\nKoʻrsatkichli maʼno\n\\end{document}\n';
    const p = fontProblem([err('LaTeX Error: Unicode character ʻ (U+02BB)'), err('LaTeX Error: Unicode character ʼ (U+02BC)')])!;
    const r = fixFonts(doc, p, 'pdflatex');
    expect(r.compiler).toBeNull();
    expect(r.text).toContain('\\usepackage{mathpazo}\n\\usepackage[scaled=.92]{helvet}\n% Oʻzbek');
    expect(r.text).toContain('\\DeclareUnicodeCharacter{02BB}{\\textquoteleft}\n\\DeclareUnicodeCharacter{02BC}{\\textquoteright}\n\\begin{document}');
    expect(r.text).not.toContain('fontspec');
    // Once is enough.
    expect(fixFonts(r.text!, p, 'pdflatex').text).toBeNull();
  });

  it('keeps a XeLaTeX/LuaLaTeX design font that only lacks ʻ ʼ (TeX Gyre) and prints them as ‘ ’', () => {
    const doc = '\\documentclass{article}\n\\usepackage{fontspec}\n\\setmainfont{texgyreheros}[Extension=.otf,UprightFont=*-regular]\n\\begin{document}\nQoʻshish\n\\end{document}\n';
    const p = fontProblem([warn(missingMessage('[texgyreheros-bold.otf]/OT', ['ʻ', 'ʼ']))])!;
    for (const compiler of ['xelatex', 'lualatex'] as const) {
      const r = fixFonts(doc, p, compiler);
      expect(r.compiler).toBeNull();
      expect(r.text).toContain('\\newunicodechar{ʻ}{‘}\n\\newunicodechar{ʼ}{’}\n\\begin{document}');
      expect(r.text).toContain('\\setmainfont{texgyreheros}');
      expect(r.text).not.toContain('Noto');
      expect(fixFonts(r.text!, p, compiler).text).toBeNull();
    }
  });

  it('only advises \\text{} for letters in formulas', () => {
    const p = fontProblem([warn(missingMessage('cmmi10', ['Ў']))])!;
    expect(fixFonts(DOC, p, 'xelatex')).toEqual({ text: null, compiler: null, mathOnly: true });
  });
});

describe('missing fonts', () => {
  const book = [
    '\\documentclass{article}',
    '\\usepackage{fontspec}',
    '\\setmainfont{texgyreheros}[Extension=.otf,UprightFont=*-regular,BoldFont=*-bold,',
    '  ItalicFont=*-italic,BoldItalicFont=*-bolditalic]',
    '\\usepackage[uzbek,provide=*]{babel}',
    '\\begin{document}',
  ].join('\n');

  it('reads the font from fontspec and from xetex errors', () => {
    expect(missingFontName('Package fontspec Error: The font "texgyreheros-regular" cannot be found.')).toBe('texgyreheros-regular');
    expect(missingFontName('Package fontspec Error: The font "Times New Roman" cannot be found.')).toBe('Times New Roman');
    expect(
      missingFontName('Font TU/texgyreheros(0)/m/n/12=[texgyreheros-regular.otf]/OT at 12.0pt not loadable: Metric (TFM) file or installed font not found.'),
    ).toBe('texgyreheros-regular');
    expect(missingFontName('Undefined control sequence.')).toBeNull();
  });

  it('picks a font of the same look', () => {
    expect(substituteFont('texgyreheros-regular')).toBe('Noto Sans');
    expect(substituteFont('Arial')).toBe('Noto Sans');
    expect(substituteFont('Times New Roman')).toBe('Noto Serif');
    expect(substituteFont('Courier New')).toBe('DejaVu Sans Mono');
  });

  it('replaces a font command over several lines and keeps the old one as a comment', () => {
    const edit = replaceFontCommand(book, 'texgyreheros-bold', 'Noto Sans')!;
    const fixed = book.slice(0, edit.at) + edit.insert + book.slice(edit.at + edit.remove);
    expect(fixed).toContain('% \\setmainfont{texgyreheros}[Extension=.otf');
    expect(fixed).toContain('%   ItalicFont=*-italic,BoldItalicFont=*-bolditalic]\n\\setmainfont{Noto Sans}\n\\usepackage[uzbek');
    expect(replaceFontCommand(fixed, 'texgyreheros-bold', 'Noto Sans')).toBeNull();
  });

  it('handles \\newfontfamily, names with spaces and commented lines', () => {
    const text = '% \\setmainfont{Arial}\n\\newfontfamily\\sarlavha{Times New Roman}[Scale=1.1] \\setsansfont{Inter}\n';
    const edit = replaceFontCommand(text, 'Times New Roman', 'Noto Serif')!;
    const fixed = text.slice(0, edit.at) + edit.insert + text.slice(edit.at + edit.remove);
    expect(fixed).toBe('% \\setmainfont{Arial}\n% \\newfontfamily\\sarlavha{Times New Roman}[Scale=1.1]\n\\newfontfamily\\sarlavha{Noto Serif}\n \\setsansfont{Inter}\n');
    expect(replaceFontCommand(text, 'Arial', 'Noto Sans')).toBeNull();
  });
});
