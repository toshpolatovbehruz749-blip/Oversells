import { describe, expect, it } from 'vitest';
import { normalizeUzbekLatin, scriptOf, tokenize } from './tokenize';
import { dictionaryFor } from './dictionaries';

const words = (text: string) => tokenize(text).map((t) => t.word);

describe('LaTeX-aware tokenizer', () => {
  it('finds prose words with Uzbek apostrophes and Cyrillic', () => {
    expect(words('Oʻzbek tilida gʻalaba va maʼlumot. Ўзбек тили — қалам.')).toEqual([
      'Oʻzbek', 'tilida', 'gʻalaba', 'va', 'maʼlumot', 'Ўзбек', 'тили', 'қалам',
    ]);
    expect(words("o'quvchi g‘alaba")).toEqual(["o'quvchi", 'g‘alaba']);
  });

  it('reports exact offsets', () => {
    const text = 'Salom \\textbf{dunyo}!';
    const t = tokenize(text);
    expect(t.map((x) => text.slice(x.from, x.to))).toEqual(['Salom', 'dunyo']);
  });

  it('skips command names, comments and non-prose arguments', () => {
    expect(
      words(
        [
          '\\documentclass[12pt,a4paper]{article}',
          '\\usepackage{amsmath} % izoh matni',
          '\\section{Kvadrat tenglama}\\label{sec:kvadrat}',
          'Qarang: \\ref{eq:ildiz} va \\cite{alimov}.',
          '\\includegraphics[width=0.5\\linewidth]{rasmlar/chizma}',
          '\\setmainfont{Noto Serif}',
        ].join('\n'),
      ),
    ).toEqual(['Kvadrat', 'tenglama', 'Qarang', 'va']);
  });

  it('skips inline and display math', () => {
    expect(words('Agar $D = b^2 - 4ac$ boʻlsa, \\(x_1\\) va \\[x_2 = \\frac{a}{b}\\] hamda $$y$$ tamom')).toEqual([
      'Agar', 'boʻlsa', 'va', 'hamda', 'tamom',
    ]);
  });

  it('skips math, drawing and verbatim environments but not their surroundings', () => {
    const text = [
      'Oldin',
      '\\begin{equation}\\label{x} matnsiz \\end{equation}',
      '\\begin{tikzpicture}\\node at (0,0) {nuqta};\\end{tikzpicture}',
      '\\begin{verbatim} kod qatori \\end{verbatim}',
      '\\begin{itemize}\\item birinchi\\end{itemize}',
      'Keyin \\verb|inline code| oxiri',
    ].join('\n');
    expect(words(text)).toEqual(['Oldin', 'birinchi', 'Keyin', 'oxiri']);
  });

  it('ignores escaped characters, numbers and single letters', () => {
    expect(words('50\\% chegirma, 2-sinf, x va y, A4 qogʻoz')).toEqual(['chegirma', 'sinf', 'va', 'qogʻoz']);
  });
});

describe('dictionary routing', () => {
  it('normalises Uzbek Latin apostrophes', () => {
    expect(normalizeUzbekLatin("o'quvchi g‘alaba ma'lumot")).toBe('oʻquvchi gʻalaba maʼlumot');
  });

  it('chooses the dictionary by project language and script', () => {
    expect(scriptOf('kitob')).toBe('latin');
    expect(scriptOf('китоб')).toBe('cyrillic');
    expect(dictionaryFor('uz-latn', 'latin')).toBe('uz-latn');
    expect(dictionaryFor('uz-latn', 'cyrillic')).toBe('uz-cyrl');
    expect(dictionaryFor('ru', 'latin')).toBe('en');
    expect(dictionaryFor('en', 'cyrillic')).toBe('ru');
    expect(dictionaryFor('off', 'latin')).toBeNull();
  });
});
