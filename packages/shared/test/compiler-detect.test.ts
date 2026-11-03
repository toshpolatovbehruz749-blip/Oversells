import { describe, expect, it } from 'vitest';
import { compilerFits, detectCompiler } from '../src/compiler-detect.js';

const doc = (preamble: string) => `\\documentclass{book}\n${preamble}\n\\begin{document}\nMatn \\usepackage{fontspec}\n\\end{document}\n`;

describe('detectCompiler', () => {
  it('recognises pdfLaTeX books (inputenc, fontenc, Type 1 fonts)', () => {
    expect(detectCompiler(doc('\\RequirePackage[utf8]{inputenc}\n\\RequirePackage[T1]{fontenc}\n\\RequirePackage{mathpazo}'))).toEqual({
      need: 'pdflatex',
      compiler: 'pdflatex',
      reason: 'inputenc',
    });
    expect(detectCompiler(doc('\\usepackage[T2A,T1]{fontenc}\n\\usepackage[russian]{babel}'))?.compiler).toBe('pdflatex');
    expect(detectCompiler(doc('\\usepackage{amsmath,mathptmx}'))?.reason).toBe('mathptmx');
  });

  it('recognises XeLaTeX/LuaLaTeX documents, also with pdfLaTeX branches (pandoc)', () => {
    expect(detectCompiler(doc('\\usepackage{fontspec}\n\\setmainfont{Noto Serif}'))).toMatchObject({ need: 'unicode', compiler: 'xelatex' });
    expect(detectCompiler(doc('\\ifPDFTeX\n\\usepackage[T1]{fontenc}\n\\else\n\\usepackage{unicode-math}\n\\fi'))?.need).toBe('unicode');
    expect(detectCompiler(doc('\\usepackage{fontspec}\n\\usepackage{luacode}'))).toMatchObject({ need: 'lualatex', compiler: 'lualatex' });
  });

  it('follows a magic comment first and ignores commented-out packages and the body', () => {
    expect(detectCompiler(`% !TEX program = lualatex\n${doc('\\usepackage[T1]{fontenc}')}`)?.compiler).toBe('lualatex');
    expect(detectCompiler(doc('% \\usepackage[utf8]{inputenc}\n\\usepackage{amsmath}'))).toBeNull();
  });

  it('says which compilers fit', () => {
    const pdf = detectCompiler(doc('\\usepackage[T1]{fontenc}'));
    const uni = detectCompiler(doc('\\usepackage{fontspec}'));
    expect(compilerFits('xelatex', pdf)).toBe(false);
    expect(compilerFits('pdflatex', pdf)).toBe(true);
    expect(compilerFits('lualatex', uni)).toBe(true);
    expect(compilerFits('pdflatex', uni)).toBe(false);
    expect(compilerFits('pdflatex', null)).toBe(true);
  });
});
