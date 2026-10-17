import { describe, expect, it } from 'vitest';
import { chapterCommands, chapterPreview, previewPath } from '../src/chapter-preview.js';
import { MATHPRO } from './fixtures-mathpro.js';

const BOOK = [
  '\\documentclass{book}', // 1
  '\\newcommand\\foo{x}', // 2
  '\\begin{document}', // 3
  '\\frontmatter', // 4
  '\\tableofcontents', // 5
  '\\mainmatter', // 6
  '\\chapter{Sonlar}', // 7
  'Birinchi bob matni.', // 8
  '\\chapter*{Kirish}', // 9
  'Yulduzli bob.', // 10
  '\\chapter[Qisqa]{Kasrlar va \\textbf{ulushlar}}', // 11
  'Uchinchi bob.', // 12
  '\\input{bolimlar/kasr}', // 13
  '\\setlength{\\parskip}{1em}', // 14
  '\\chapter{Tenglamalar}', // 15
  'Toʻrtinchi bob.', // 16
  '\\end{document}', // 17
].join('\n');

describe('chapterPreview', () => {
  it('keeps the chapter around the cursor, line numbers and the chapter number', () => {
    const p = chapterPreview(BOOK, 12)!;
    expect(p).toMatchObject({ label: 'Kasrlar va ulushlar', from: 11, to: 14 });
    const lines = p.text.split('\n');
    expect(lines).toHaveLength(17);
    // One numbered chapter before it (the starred one does not count).
    expect(lines[2]).toBe('\\begin{document}\\setcounter{chapter}{1}');
    expect(lines[3]).toBe('\\frontmatter');
    expect(lines[4]).toBe('');
    expect(lines[5]).toBe('\\mainmatter');
    expect(lines[7]).toBe('');
    expect(lines.slice(10, 14)).toEqual(['\\chapter[Qisqa]{Kasrlar va \\textbf{ulushlar}}', 'Uchinchi bob.', '\\input{bolimlar/kasr}', '\\setlength{\\parskip}{1em}']);
    expect(lines[15]).toBe('');
    expect(lines[16]).toBe('\\end{document}');
  });

  it('treats the front matter as a chapter and refuses lines outside the body', () => {
    expect(chapterPreview(BOOK, 5)).toMatchObject({ from: 4, to: 6, label: '' });
    expect(chapterPreview(BOOK, 1)).toBeNull();
    expect(chapterPreview(BOOK, 17)).toBeNull();
  });

  it('uses sections in a document without chapters', () => {
    const art = '\\documentclass{article}\n\\begin{document}\n\\section{A}\na\n\\section{B}\nb\n\\end{document}';
    const p = chapterPreview(art, 6)!;
    expect(p.text).toBe('\\documentclass{article}\n\\begin{document}\\setcounter{section}{1}\n\n\n\\section{B}\nb\n\\end{document}');
  });

  it('finds the topics of an article workbook (\\mavzu: a new page and a contents line)', () => {
    const work = [
      '\\documentclass{article}', // 1
      '\\newcommand\\mavzu[2]{\\clearpage', // 2
      '  \\markboth{#1-mavzu. #2}{}\\addcontentsline{toc}{section}{#1. #2}', // 3
      '  {\\bfseries #2}}', // 4
      '\\newcommand\\daraja[1]{\\par\\textbf{#1}}', // 5
      '\\begin{document}', // 6
      '\\tableofcontents', // 7
      '\\mavzu{1}{Sonlar}', // 8
      '\\section*{Savollar}', // 9
      '\\mavzu{2}{Qoʻshish}', // 10
      '\\daraja{Oson}', // 11
      '\\end{document}', // 12
    ].join('\n');
    const preamble = work.split('\\begin{document}')[0]!;
    expect(chapterCommands(preamble, true).map((c) => c.name)).toEqual(['mavzu']);
    // In a book with chapters (mathpro.sty) such a command is a section inside a chapter.
    expect(chapterCommands(MATHPRO, true).map((c) => c.name)).toEqual(['mavzu']);
    const p = chapterPreview(work, 11)!;
    expect([p.from, p.to, p.label]).toEqual([10, 11, '2. Qoʻshish']);
    expect(p.text.split('\n').slice(6, 9)).toEqual(['', '', '']);
  });

  it('keeps definitions of the body over several lines, but not settings inside pictures', () => {
    const work = [
      '\\documentclass{article}', // 1
      '\\newcommand\\mavzu[1]{\\clearpage\\section*{#1}\\addcontentsline{toc}{section}{#1}}', // 2
      '\\begin{document}', // 3
      '\\mavzu{Sonlar}', // 4
      '\\newcommand\\SonJuft[2]{\\draw (0,0) -- (1,1);', // 5
      '  \\node at (0,0) {#1};}', // 6
      '\\begin{tikzpicture}', // 7
      '\\colorlet{plc}{red}\\fill[plc] (0,0) circle (1);', // 8
      '\\end{tikzpicture}', // 9
      '\\renewcommand\\arraystretch{1.6}\\begin{tabular}{l}', // 10
      'a \\\\', // 11
      '\\end{tabular}', // 12
      '\\mavzu{Qoʻshish}', // 13
      '\\SonJuft{1}{2}', // 14
      '\\end{document}', // 15
    ].join('\n');
    const kept = chapterPreview(work, 14)!.text.split('\n');
    expect(kept.slice(4, 6)).toEqual(['\\newcommand\\SonJuft[2]{\\draw (0,0) -- (1,1);', '  \\node at (0,0) {#1};}']);
    expect(kept.slice(6, 12)).toEqual(['', '', '', '', '', '']);
  });

  it('finds the chapters of a book design (mathpro.sty: \\bob)', () => {
    const text = MATHPRO;
    const preamble = text.slice(0, text.indexOf('\\begin{document}'));
    const cmds = chapterCommands(preamble).map((c) => `${c.name}:${c.counter}`);
    expect(cmds).toContain('bob:bob');
    expect(cmds).not.toContain(expect.stringMatching(/^(mavzu|sahifasarlavha|muqova):/));
    const at = text.split('\n').findIndex((l: string) => l.startsWith('\\savol')) + 1;
    const p = chapterPreview(text, at)!;
    expect(p.label).toBe('Koʻrsatkichli va logarifmik funksiyalar');
    expect(p.text).not.toContain('\\muqova\n');
    expect(p.text).toContain('\\mavzu{Koʻrsatkichli funksiya. Koʻrsatkichli tenglamalar}');
    expect(p.text.split('\n')).toHaveLength(text.split('\n').length);
    // The second \bob: one before it.
    expect(p.text).toContain('\\begin{document}\\setcounter{bob}{1}');
    expect(p.text).not.toContain('{Sonlar}');
  });

  it('names the preview file next to the main file', () => {
    expect(previewPath('main.tex')).toBe('main-bob.tex');
    expect(previewPath('kitob/asosiy.tex')).toBe('kitob/asosiy-bob.tex');
  });
});
