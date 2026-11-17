import { describe, expect, it } from 'vitest';
import { generatePageDesignPackage, pageDesignFromAi } from '../src/index.js';
import { AI_PAGE_DESIGN_ANSWER } from './fixtures/ai-page-design.js';

describe('page design from an AI answer', () => {
  const r = pageDesignFromAi(AI_PAGE_DESIGN_ANSWER, 'Loyiha');

  it('cleans ids, clamps sizes and drops what is not valid', () => {
    expect(r.name).toBe('Iliq bolalar kitobi');
    expect(r.design.title).toBe('Quyoshcha');
    const [body, h1, h2] = r.design.paragraphStyles;
    expect(body).toMatchObject({ id: 'asosiymatn', size: 14, leading: 20, align: 'left', dropCap: 3 });
    expect(h1).toMatchObject({ id: 'sarlavha', heading: 1, color: 'C0392B', bold: true });
    // Headings get no drop cap; a duplicate id gets a number; nonsense is dropped or clamped.
    expect(h1!.dropCap).toBeUndefined();
    expect(h2).toMatchObject({ id: 'sarlavha2', heading: 2, size: 48 });
    expect(h2!.align).toBeUndefined();
    expect(h2!.color).toBeUndefined();
    expect(r.design.characterStyles[0]).toMatchObject({ id: 'urgu', italic: true, color: '2E86C1' });
  });

  it('builds the masters and book rules asked for', () => {
    expect(r.design.masters.map((m) => m.id)).toEqual(['asosiy', 'bobboshi']);
    expect(r.design.masters[0]!.odd.head.center.kind).toBe('chapter');
    expect(r.design.page).toEqual({ inner: 20, outer: 18, top: 8, bottom: 22 });
    expect(r.design).toMatchObject({ chapterOpensRight: true, chapterHeadOrnament: 'fleuron', microtype: true });
    expect(r.design.chapterEndOrnament).toBeUndefined();
    expect(generatePageDesignPackage(r.design)).toContain('\\ding{167}');
  });

  it('refuses what is not an answer', () => {
    expect(() => pageDesignFromAi('text', 'x')).toThrow();
    expect(pageDesignFromAi({}, 'Kitob').design.title).toBe('Kitob');
  });
});
