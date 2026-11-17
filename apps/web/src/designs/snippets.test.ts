import { describe, expect, it } from 'vitest';
import { SNIPPETS } from './snippets';
import uz from '../i18n/uz';
import ru from '../i18n/ru';
import en from '../i18n/en';

describe('design snippets', () => {
  it('have unique ids and titles in every language', () => {
    expect(new Set(SNIPPETS.map((s) => s.id)).size).toBe(SNIPPETS.length);
    for (const dict of [uz, ru, en]) {
      const items = (dict as unknown as { snippets: { item: Record<string, string> } }).snippets.item;
      for (const s of SNIPPETS) expect(items[s.id], s.id).toBeTruthy();
    }
  });

  it('end with a newline and keep environments balanced', () => {
    for (const s of SNIPPETS) {
      expect(s.code.endsWith('\n'), s.id).toBe(true);
      const begins = s.code.match(/\\begin\{([^}]+)\}/g) ?? [];
      const ends = s.code.match(/\\end\{([^}]+)\}/g) ?? [];
      expect(begins.map((b) => b.slice(7)).sort(), s.id).toEqual(ends.map((e) => e.slice(5)).sort());
    }
  });

  it('design translations have the same keys in all languages', () => {
    const keys = (o: object, prefix = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
    const pick = (d: unknown) => keys({ designs: (d as { designs: object }).designs, snippets: (d as { snippets: object }).snippets }).sort();
    expect(pick(ru)).toEqual(pick(uz));
    expect(pick(en)).toEqual(pick(uz));
  });
});
