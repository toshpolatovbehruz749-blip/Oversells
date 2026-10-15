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
