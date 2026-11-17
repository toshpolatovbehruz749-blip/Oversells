import { describe, expect, it } from 'vitest';
import { PageDesignError, defaultPageDesign, mergeStyleInDesign, mergeStyleInText } from '../src/index.js';

describe('merging styles', () => {
  it('changes the uses in the text, exactly that id', () => {
    const tex = '\\begin{uslub}{quote}\nA\n\\end{uslub}\n\\begin{uslub}{quote2}B\\end{uslub} \\matnuslubi{quote}{x} \\begin{uslub} {quote}C\\end{uslub}';
    expect(mergeStyleInText(tex, 'paragraph', 'quote', 'iqtibos')).toEqual({
      text: '\\begin{uslub}{iqtibos}\nA\n\\end{uslub}\n\\begin{uslub}{quote2}B\\end{uslub} \\matnuslubi{quote}{x} \\begin{uslub} {iqtibos}C\\end{uslub}',
      count: 2,
    });
    expect(mergeStyleInText(tex, 'character', 'quote', 'urgu').text).toContain('\\matnuslubi{urgu}{x}');
  });

  it('removes the style from the design and moves what was based on it', () => {
    const d = defaultPageDesign('K');
    d.paragraphStyles.push({ id: 'quote', name: 'Quote', italic: true }, { id: 'quotesmall', name: 'Quote small', basedOn: 'quote', size: 9 });
    const target = d.paragraphStyles.find((p) => !p.heading && p.id !== 'quote' && p.id !== 'quotesmall')!.id;
    const m = mergeStyleInDesign(d, 'paragraph', 'quote', target);
    expect(m.paragraphStyles.some((p) => p.id === 'quote')).toBe(false);
    expect(m.paragraphStyles.find((p) => p.id === 'quotesmall')!.basedOn).toBe(target);
    expect(() => mergeStyleInDesign(d, 'paragraph', 'quote', 'quote')).toThrow(PageDesignError);
    expect(() => mergeStyleInDesign(d, 'paragraph', 'nope', target)).toThrow(PageDesignError);
  });
});
