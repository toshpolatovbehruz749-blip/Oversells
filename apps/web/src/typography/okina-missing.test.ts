import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { latinWords, restoreOkina } from './okina-missing';

const words = new Set(
  readFileSync(new URL('../../public/dict/uz-latn.dic', import.meta.url), 'utf8')
    .split('\n')
    .slice(1)
    .map((l) => l.split('/')[0]!.trim().toLowerCase())
    .filter(Boolean),
);
const fix = (w: string) => restoreOkina(w, (l) => words.has(l));

describe('restoreOkina', () => {
  it('puts back the ʻ that was not typed', () => {
    expect(fix('Korsatkichli')).toBe('Koʻrsatkichli');
    expect(fix('korsatkich')).toBe('koʻrsatkich');
    expect(fix('togri')).toBe('toʻgʻri');
    expect(fix('notogri')).toBe('notoʻgʻri');
    expect(fix('sozlar')).toBe('soʻzlar');
    expect(fix('Ozbekiston')).toBe('Oʻzbekiston');
    expect(fix('OZBEKISTON')).toBe('OʻZBEKISTON');
    expect(fix('oqituvchi')).toBe('oʻqituvchi');
    expect(fix('kop')).toBe('koʻp');
  });

  it('leaves correct words, other languages and words with an apostrophe alone', () => {
    for (const w of ['Logarifmik', 'funksiyalar', 'Takrorlash', 'testi', 'Sertifikat', 'uslubidagi', 'tenglamalar', 'xossalari', 'va', 'uning', 'Google', 'logo', 'algorithm', 'program', 'yoki', 'bilan', 'Koʻrsatkichli', "o'qish"]) {
      expect(fix(w), w).toBeNull();
    }
  });
});

describe('latinWords', () => {
  it('skips command names and keeps apostrophes in words', () => {
    expect(latinWords("\\section{Korsatkichli} o'qish x2").map((w) => w.word)).toEqual(['Korsatkichli', "o'qish"]);
  });
});
