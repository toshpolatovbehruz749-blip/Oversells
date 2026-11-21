import { describe, expect, it } from 'vitest';
import { applyCharacterStyle, defaultPageDesign, findSelectionInSource, generatePageDesignPackage, projectToIdml, readPageDesign } from '../src/index.js';

const SRC = [
  '\\section{Bob}', // 1
  'Qishloq tongi juda goʻzal edi.', // 2
  '% Qishloq tongi juda goʻzal edi.', // 3
  'Bolalar daryo boʻyiga', // 4
  'yugurishdi va u~yerda baliqchilar', // 5
  'bilan suhbatlashishdi.', // 6
  '', // 7
  'Qishloq tongi juda goʻzal edi.', // 8
].join('\n');

describe('text selected on the PDF, found in the source', () => {
  it('finds it across line breaks, ~ and another apostrophe', () => {
    const at = findSelectionInSource(SRC, 5, "boʼyiga yugurishdi va u yerda");
    expect(SRC.slice(at!.from, at!.to)).toBe('boʻyiga\nyugurishdi va u~yerda');
  });

  it('mends words broken at the end of a PDF line and ligatures', () => {
    const at = findSelectionInSource(SRC, 6, 'suhbat-\nlashishdi');
    expect(SRC.slice(at!.from, at!.to)).toBe('suhbatlashishdi');
    expect(findSelectionInSource('office va fil', 1, 'ﬁl')).toEqual({ from: 10, to: 13 });
  });

  it('takes the match nearest to the SyncTeX line, never one in a comment', () => {
    const near8 = findSelectionInSource(SRC, 8, 'tongi juda');
    expect(SRC.slice(0, near8!.from).split('\n').length).toBe(8);
    const near2 = findSelectionInSource(SRC, 3, 'tongi juda');
    expect(SRC.slice(0, near2!.from).split('\n').length).toBe(2);
    expect(findSelectionInSource(SRC, 4, 'yoʻq soʻz')).toBeNull();
  });

  it('gives a range the character style wraps', () => {
    const at = findSelectionInSource(SRC, 2, 'juda goʻzal')!;
    const edits = applyCharacterStyle(SRC, at.from, at.to, 'urgu');
    let out = SRC;
    for (const e of [...edits].sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
    expect(out.split('\n')[1]).toBe('Qishloq tongi \\matnuslubi{urgu}{juda goʻzal} edi.');
  });
});


describe('spread frames and the baseline grid in sahifa.sty', () => {
  it('draws a fixed frame across the gutter in two parts', () => {
    const sty = generatePageDesignPackage(defaultPageDesign('Kitob'));
    expect(sty).toContain('\\newcommand\\sahifa@frameat[9]');
    expect(sty).toContain('\\sahifa@ifspreadfrom');
    // Without snapping, nothing of the grid is set up.
    expect(sty).not.toContain('\\sahifa@gridalign');
  });

  it('snaps spaces, leadings, headings and pictures when asked, and keeps the setting', () => {
    const d = defaultPageDesign('Kitob');
    d.baselineSnap = true;
    d.paragraphStyles = [
      { id: 'iqtibos', name: 'Iqtibos', size: 9, leading: 10.5, spaceBefore: 5, spaceAfter: 7 },
      { id: 'sarlavha', name: 'Sarlavha', heading: 1, size: 17, spaceBefore: 7 },
    ];
    const sty = generatePageDesignPackage(d);
    expect(sty).toContain('\\@namedef{sahifa@pb@iqtibos}{\\addvspace{\\sahifa@snap{5pt}}}');
    expect(sty).toContain('\\fontsize{9pt}{\\sahifa@snapup{10.5pt}}');
    // titlesec gets numbers worked out at \begin{document}, and lines the text up after a heading.
    expect(sty).toMatch(/\\AtBeginDocument\{\\edef\\sahifa@tmp\{\\noexpand\\titlespacing\*\{\\noexpand\\section\}\{0mm\}\{\\the\\sahifa@snap\{7pt\}\}/);
    expect(sty).toContain('\\sahifa@gridalign');
    expect(readPageDesign(sty)?.baselineSnap).toBe(true);
    // InDesign gets its own baseline grid.
    const idml = projectToIdml({ title: 'K', mainTex: '\\documentclass{article}\\begin{document}x\\end{document}', design: d }).parts;
    expect(idml['Resources/Preferences.xml']).toContain('<GridPreference BaselineStart=');
    expect(idml['Resources/Styles.xml']).toContain('AlignToBaseline="true"');
  });
});
