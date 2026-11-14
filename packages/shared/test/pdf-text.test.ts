import { describe, expect, it } from 'vitest';
import { pdfPageSize, pdfTextToLatex } from '../src/index.js';

/** pdftotext -layout output of a small two-sided book (as the compiler image's poppler writes it). */
const TEXT = [
  'BIRINCHI BOB',
  '',
  '1-bob. Qishloq',
  'Qishloq tongi juda goʻzal edi. Bolalar daryo boʻyiga yugurishdi',
  'va u yerda baliqchilar bilan suhbatlashishdi. Ular oʻzaro bir-',
  'biriga hikoyalar aytib berishdi, kechgacha oʻynashdi. Bu kun-',
  'lar hech qachon unutilmaydi.',
  '   Ikkinchi xatboshi: 50% hosil, & boshqa narsalar',
  '',
  '                              1',
  '\f                     Ona yurt qissasi',
  '',
  'davom etadi va tugaydi.',
  '   Yangi betdagi matn davom etadi va bu yerda ham yetarli-',
  'cha uzun jumlalar bor.',
  '',
  '                            2',
  '\f                      Ona yurt qissasi',
  '',
  'Uchinchi bet matni.',
  '',
  '                            3',
  '\f',
].join('\n');

describe('PDF text import', () => {
  const r = pdfTextToLatex(TEXT, 'Ona yurt', pdfPageSize('Page size:       419.528 x 595.276 pts (A5)\n'));
  const body = r.mainTex.split('\\begin{document}')[1]!;

  it('finds headings and paragraphs, and drops running heads and page numbers', () => {
    expect(body).toContain('\\section*{BIRINCHI BOB}');
    expect(body).toContain('\\section*{1-bob. Qishloq}');
    expect(body).not.toContain('Ona yurt qissasi');
    expect(body).not.toMatch(/^\s*[123]\s*$/m);
    expect(r).toMatchObject({ headings: 2, paragraphs: 4 });
  });

  it('mends words broken at the line end, keeps doubled words, escapes', () => {
    expect(body).toContain('Ular oʻzaro bir-biriga hikoyalar');
    expect(body).toContain('Bu kunlar hech qachon');
    expect(body).toContain('yetarlicha uzun');
    expect(body).toContain('50\\% hosil, \\& boshqa');
  });

  it('keeps a paragraph open over the page break unless it ended', () => {
    expect(body).toContain('boshqa narsalar davom etadi va tugaydi.');
  });

  it('takes the page size over', () => {
    expect(r.mainTex).toContain('paperwidth=148mm,paperheight=210mm');
    expect(pdfTextToLatex('', 'x').mainTex).toContain('no text layer');
  });
});
