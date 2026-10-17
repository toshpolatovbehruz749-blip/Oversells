import { describe, expect, it } from 'vitest';
import { applyFixes, findFixes, segments } from './fix';

const doc = (body: string, preamble = '') =>
  `\\documentclass{article}\n${preamble}\\begin{document}\n${body}\n\\end{document}\n`;
const fix = (body: string, preamble = '') => {
  const text = doc(body, preamble);
  return applyFixes(text, findFixes(text)).replace(doc('', preamble).replace('\n\n\\end{document}\n', '\n'), '').replace(/\n\\end\{document\}\n$/, '');
};

describe('typography fixes', () => {
  it('turns typed apostrophes into the Uzbek letters oʻ gʻ and the tutuq belgisi', () => {
    expect(fix("O'zbekiston bog'i, to'g'ri, bog' va tog'.")).toBe('Oʻzbekiston bogʻi, toʻgʻri, bogʻ va togʻ.');
    expect(fix('o‘qituvchi o’quvchi o`yin')).toBe('oʻqituvchi oʻquvchi oʻyin');
    expect(fix("ma'no san'at ta'lim")).toBe('maʼno sanʼat taʼlim');
    expect(fix("ма'но санъат")).toBe('маъно санъат');
    // Already right: nothing to do.
    expect(findFixes(doc('oʻzbek maʼno'))).toEqual([]);
  });

  it('leaves LaTeX quotes, code, keys and the preamble alone', () => {
    expect(fix("``so'z'' va 'qo'shtirnoq'")).toBe("``soʻz'' va 'qoʻshtirnoq'");
    expect(fix("\\label{o'q} \\ref{fig:g'} \\includegraphics{rasm/o'q.png}")).toBe("\\label{o'q} \\ref{fig:g'} \\includegraphics{rasm/o'q.png}");
    expect(fix("% bu yerda o'zgartirmang: o'q\nmatn")).toBe("% bu yerda o'zgartirmang: o'q\nmatn");
    expect(fix("\\begin{verbatim}\nto'g'ri ... a - b\n\\end{verbatim}")).toBe("\\begin{verbatim}\nto'g'ri ... a - b\n\\end{verbatim}");
    expect(findFixes(doc('x', "\\title{O'zbek tili}\n"))).toEqual([]);
  });

  it('fixes quotes, dashes, ellipses and spaces in prose', () => {
    expect(fix('U "Algebra" kitobini oldi.')).toBe('U «Algebra» kitobini oldi.');
    expect(fix('Bilim - kuch.')).toBe('Bilim~--- kuch.');
    expect(fix('Bilim --- kuch.')).toBe('Bilim --- kuch.');
    expect(fix('Va hokazo...')).toBe('Va hokazo…');
    expect(fix('Bir  ikki ,uch .')).toBe('Bir ikki, uch.');
    expect(fix('olma,nok')).toBe('olma, nok');
    expect(fix('3,14 soni')).toBe('3,14 soni');
  });

  it('fixes formulas: function names, multiplication and relations', () => {
    expect(fix('$sin x + cos(x) = 1$')).toBe('$\\sin x + \\cos(x) = 1$');
    expect(fix('$\\sin x + log_2 8$')).toBe('$\\sin x + \\log_2 8$');
    expect(fix('$tg x$')).toBe('$\\operatorname{tg} x$');
    expect(fix('$tg x$', '\\usepackage{dizayn}\n')).toBe('$\\tg x$');
    expect(fix('\\[ 2*3 = 6,\\ a <= b,\\ x->0,\\ a*b \\]')).toBe('\\[ 2\\cdot3 = 6,\\ a \\leq b,\\ x\\to0,\\ a\\cdot b \\]');
    expect(fix('\\begin{equation} lim_{n->\\infty} a_n \\end{equation}')).toBe('\\begin{equation} \\lim_{n\\to\\infty} a_n \\end{equation}');
    // Text in formulas and words in prose stay.
    expect(fix('$\\text{sin emas}$ va sinf')).toBe('$\\text{sin emas}$ va sinf');
    expect(fix('$a^*$')).toBe('$a^*$');
  });

  it('splits the body into prose and maths', () => {
    const text = doc('a $b$ c \\[d\\] e');
    const parts = segments(text).map((s) => [text.slice(s.from, s.to).trim(), s.math]);
    expect(parts).toEqual([
      ['a', false],
      ['b', true],
      ['c', false],
      ['d', true],
      ['e', false],
    ]);
  });
});
