import { describe, expect, it } from 'vitest';
import { blankPagesNeeded, buildPreflight, withBlankPages } from '../src/preflight.js';

// Real poppler output of a test book (6 pages).
const info = 'Creator:         TeX\nProducer:        LuaTeX-1.17.0\nPages:           6\nPage size:       496.06 x 581.1 pts\n';
const fonts = `name                                 type              encoding         emb sub uni object ID
------------------------------------ ----------------- ---------------- --- --- --- ---------
HLYIQL+LCIRCLE10                     Type 1            Builtin          yes yes no       9  0
BCIDEU+NotoSerif-Regular             CID TrueType      Identity-H       yes yes yes     10  0
Helvetica                            Type 1            Custom           no  no  no      12  0
`;
const images = `page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio
--------------------------------------------------------------------------------------------
   2     0 image    1600   900  rgb     3   8  image  no         4  0   519   519 6834B 0.2%
   2     1 smask    1600   900  gray    1   8  image  no         5  0   519   519 6834B 0.2%
   3     2 image     800  1400  cmyk    4   8  jpeg   no        14  0   452   452 6890B 0.2%
   4     3 image    1600   900  rgb     3   8  image  no         4  0   111   111 6834B 0.2%
   5     4 image     800  1400  cmyk    4   8  jpeg   no        14  0   210   230 6890B 0.2%
`;
const pageText = '1 1229\n2 1529\n3 829\n4 0\n5 0\n6 0\n';

describe('preflight', () => {
  const report = buildPreflight({
    info,
    fonts,
    images,
    pageText,
    overfull: [
      { file: 'bob1.tex', line: 12, message: 'Overfull \\hbox (12.5pt too wide) in paragraph at lines 12--14' },
      { file: 'bob1.tex', line: 30, message: 'Overfull \\hbox (0.4pt too wide) in paragraph at lines 30--31' },
    ],
    multiple: 16,
  });
  const check = (id: string) => report.checks.find((c) => c.id === id)!;

  it('reads the page count and finds fonts that are not embedded', () => {
    expect(report.pages).toBe(6);
    expect(check('fonts')).toMatchObject({ status: 'error', items: [{ text: 'Helvetica' }] });
  });

  it('rates pictures by the dpi they print at, and finds RGB ones', () => {
    expect(check('image-dpi')).toMatchObject({
      status: 'error',
      items: [
        { page: 4, text: '1600×900 px, 111 dpi' },
        { page: 5, text: '800×1400 px, 210 dpi' },
      ],
    });
    expect(check('image-color').items.map((i) => i.page)).toEqual([2, 4]);
  });

  it('asks for blank pages to a printing sheet and offers the fix', () => {
    expect(check('page-count')).toMatchObject({ status: 'warning', items: [{ text: '6 → 16' }], fix: { kind: 'blankPages', count: 10 } });
    expect(blankPagesNeeded(256, 16)).toBe(0);
    expect(blankPagesNeeded(250, 32)).toBe(6);
  });

  it('lists visible overfull lines and pages with neither text nor pictures', () => {
    expect(check('overfull')).toMatchObject({ status: 'warning', items: [{ file: 'bob1.tex', line: 12, text: '12.5pt' }] });
    // Pages 4 and 5 hold full-page pictures.
    expect(check('empty-pages').items).toEqual([{ page: 6, text: '' }]);
  });

  it('is all green for a clean book', () => {
    const clean = buildPreflight({ info: 'Pages: 32\n', fonts: fonts.split('\n').slice(0, 4).join('\n'), images: '', pageText: '1 10\n', overfull: [], multiple: 16 });
    expect(clean.checks.every((c) => c.status === 'ok')).toBe(true);
  });

  it('adds blank pages before \\end{document}', () => {
    const main = '\\begin{document}\nMatn\n\\end{document}\n';
    expect(withBlankPages(main, 2)).toBe(
      '\\begin{document}\nMatn\n% Preflight: bet soni bosma taboqqa karrali boʻlishi uchun\n\\bosbet\n\\bosbet\n\\end{document}\n',
    );
    expect(withBlankPages(main, 0)).toBeNull();
    expect(withBlankPages('no end', 3)).toBeNull();
  });

  it('finds pages with a line or two, and pictures to the edge without bleed', () => {
    const base = { fonts: '', images: '', overfull: [], multiple: 16 as const };
    const r = buildPreflight({ ...base, info: 'Pages: 3\nPage size:       419.528 x 595.276 pts (A5)\n', pageText: '1 900 30\n2 40 3\n3 0 0\n' });
    expect(r.checks.find((c) => c.id === 'short-pages')).toMatchObject({ status: 'warning', items: [{ page: 2, text: '3' }] });
    // No pictures to the edge: nothing to say about bleed.
    expect(r.checks.find((c) => c.id === 'bleed')!.status).toBe('ok');
    const paper = { w: 419.53, h: 595.28 };
    const noRoom = buildPreflight({ ...base, info: 'Pages: 1\nPage size:       419.528 x 595.276 pts (A5)\n', pageText: '1 900 30\n', bleedPictures: true, paper });
    expect(noRoom.checks.find((c) => c.id === 'bleed')!.status).toBe('error');
    // With crop marks the PDF page is larger than the trimmed page.
    const marks = buildPreflight({ ...base, info: 'Pages: 1\nPage size:       504.567 x 680.315 pts\n', pageText: '1 900 30\n', bleedPictures: true, paper });
    expect(marks.checks.find((c) => c.id === 'bleed')!.status).toBe('ok');
    // Old two-column page lists still work.
    expect(buildPreflight({ ...base, info: 'Pages: 1\n', pageText: '1 40\n' }).checks.find((c) => c.id === 'short-pages')!.status).toBe('ok');
  });
});
