import { describe, expect, it } from 'vitest';
import {
  checkProjectPath,
  fileKindOf,
  isValidProjectPath,
  joinProjectPath,
  sanitizeFileName,
} from '../src/paths.js';

describe('checkProjectPath', () => {
  it.each(['main.tex', 'chapters/ch1.tex', 'images/fig-1_a.PNG', 'a/b/c/d/refs.bib', 'fonts/MyFont.otf'])(
    'accepts %s',
    (p) => {
      expect(checkProjectPath(p)).toEqual({ ok: true, path: p });
    },
  );

  it.each([
    ['', 'empty'],
    ['../main.tex', 'traversal'],
    ['a/../../etc/passwd.tex', 'traversal'],
    ['./main.tex', 'traversal'],
    ['/etc/passwd.tex', 'absolute'],
    ['C:/Windows/x.tex', 'absolute'],
    ['a\\b.tex', 'backslash'],
    ['..\\..\\x.tex', 'backslash'],
    ['a//b.tex', 'empty_segment'],
    ['dir/', 'empty_segment'],
    ['main\u0000.tex', 'control_char'],
    ['main\n.tex', 'control_char'],
    ['.latexmkrc', 'reserved'],
    ['sub/latexmkrc', 'reserved'],
    ['.hidden.tex', 'invalid_segment'],
    ['my file.tex', 'invalid_segment'],
    ['oʻquvchi.tex', 'invalid_segment'],
    ['файл.tex', 'invalid_segment'],
    ['script.sh', 'extension'],
    ['image.svg', 'extension'],
    ['Makefile', 'extension'],
    [`${'a'.repeat(101)}.tex`, 'invalid_segment'],
    [`${'a/'.repeat(8)}x.tex`, 'too_deep'],
    [`${'abc/'.repeat(70)}x.tex`, 'too_long'],
  ])('rejects %j (%s)', (p, code) => {
    expect(checkProjectPath(p)).toEqual({ ok: false, code });
  });

  it('rejects non-strings', () => {
    expect(isValidProjectPath(undefined)).toBe(false);
    expect(isValidProjectPath(42)).toBe(false);
  });

  it('allows folders without extension when asked', () => {
    expect(checkProjectPath('chapters/part1', false).ok).toBe(true);
    expect(checkProjectPath('chapters/../x', false).ok).toBe(false);
  });
});

describe('fileKindOf', () => {
  it('classifies by extension', () => {
    expect(fileKindOf('a.tex')).toBe('text');
    expect(fileKindOf('refs.BIB')).toBe('text');
    expect(fileKindOf('fig.png')).toBe('binary');
    expect(fileKindOf('x.exe')).toBeNull();
    expect(fileKindOf('noext')).toBeNull();
  });
});

describe('sanitizeFileName', () => {
  it.each([
    ['Расм 1.PNG', 'Rasm_1.png'],
    ['Ўқувчи ғалаба ҳисоб.tex', 'Oquvchi_galaba_hisob.tex'],
    ['oʻquvchi gʻalaba.tex', 'oquvchi_galaba.tex'],
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\me\\Docs\\chapter 1.tex', 'chapter_1.tex'],
    ['.latexmkrc', 'file_latexmkrc'],
    ['...tex', 'tex'],
    ['..hidden.tex', 'hidden.tex'],
    ['café crème.tex', 'cafe_creme.tex'],
    ['a<>:"|?*.tex', 'a.tex'],
    ['', 'file'],
  ])('%j -> %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('produces valid paths for allowed types', () => {
    for (const name of ['Расм 1.PNG', 'oʻquvchi gʻalaba.tex', 'café crème.tex']) {
      expect(checkProjectPath(sanitizeFileName(name)).ok).toBe(true);
    }
  });

  it('keeps names short', () => {
    expect(sanitizeFileName(`${'x'.repeat(300)}.tex`).length).toBeLessThanOrEqual(100);
  });
});

describe('joinProjectPath', () => {
  it('joins folder and name', () => {
    expect(joinProjectPath('', 'a.tex')).toBe('a.tex');
    expect(joinProjectPath('ch/', 'a.tex')).toBe('ch/a.tex');
  });
});
