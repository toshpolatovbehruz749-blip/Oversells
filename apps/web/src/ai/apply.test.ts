import { describe, expect, it } from 'vitest';
import { locateExcerpt, minimalEdit, preambleInsertion } from './apply';

describe('AI edit helpers', () => {
  const text = 'a\nb\nc\nd\ne';

  it('finds the excerpt at its line, or uniquely elsewhere', () => {
    expect(locateExcerpt(text, 2, 'b\nc')).toBe(2);
    expect(locateExcerpt('x\n' + text, 2, 'b\nc')).toBe(4); // a line was added above
    expect(locateExcerpt(text, 1, 'b\nX')).toBeNull();
    expect(locateExcerpt('b\nb', 5, 'b')).toBeNull(); // ambiguous
    expect(locateExcerpt(text, 1, text)).toBe(0);
  });

  it('computes a minimal edit', () => {
    expect(minimalEdit('$\\frac{1}{2$ va', '$\\frac{1}{2}$ va')).toEqual({ at: 11, remove: 0, insert: '}' });
    expect(minimalEdit('abc', 'abc')).toEqual({ at: 3, remove: 0, insert: '' });
    expect(minimalEdit('aXc', 'aYYc')).toEqual({ at: 1, remove: 1, insert: 'YY' });
    expect(minimalEdit('aa', 'a')).toEqual({ at: 1, remove: 1, insert: '' });
  });

  it('adds missing preamble lines before \\begin{document}', () => {
    const doc = '\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\nx\n\\end{document}';
    expect(preambleInsertion(doc, ['\\usepackage{tikz}', '\\usetikzlibrary{calc}'])).toEqual({
      at: doc.indexOf('\\begin{document}'),
      remove: 0,
      insert: '\\usetikzlibrary{calc}\n',
    });
    expect(preambleInsertion(doc, ['\\usepackage{tikz}'])).toBeNull();
    expect(preambleInsertion('no document', ['\\usepackage{x}'])).toBeNull();
  });
});
