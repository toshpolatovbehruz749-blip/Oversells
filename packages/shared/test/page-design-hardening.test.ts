import { describe, expect, it } from 'vitest';
import {
  acceptAiProposal,
  defaultPageDesign,
  defaultCover,
  generateCover,
  generatePageDesignPackage,
  idmlToLatex,
  normalizePageDesign,
  pdfTextToLatex,
  readCover,
  readPageDesign,
  setFrameKeys,
  type PageDesignSpec,
} from '../src/index.js';
import { IDML_SAMPLE } from './fixtures/idml-sample.js';

/** The sample IDML with some of its text replaced. */
const idml = (...swaps: [string, string][]) => {
  const out = { ...IDML_SAMPLE };
  for (const [from, to] of swaps) {
    const key = Object.keys(out).find((k) => out[k]!.includes(from));
    if (!key) throw new Error(`not in the sample: ${from}`);
    out[key] = out[key]!.replace(from, to);
  }
  return out;
};
/** Lines of TeX that are not comments. */
const live = (tex: string) => tex.split('\n').filter((l) => l.trim() && !l.trimStart().startsWith('%'));

describe('IDML import of odd files', () => {
  it('keeps font and picture names inside their comment lines', () => {
    const r = idmlToLatex(
      idml(
        ['<AppliedFont type="string">Minion Pro</AppliedFont>', '<AppliedFont type="string">Minion&#10;\\immediate\\write18{id}</AppliedFont>'],
        ['Rasmlar/tog%E2%80%98.jpg', 'x%0A%5Cinput%7B%2Fetc%2Fpasswd%7D'],
      ),
      'Kitob',
    );
    expect(live(r.mainTex).join('\n')).not.toMatch(/write18|\/etc\/passwd/);
    expect(r.mainTex).toContain('% Shrift: Minion \\immediate\\write18{id}');
  });

  it('reads names that are not valid UTF-8 escapes instead of failing', () => {
    const r = idmlToLatex(idml(['Rasmlar/tog%E2%80%98.jpg', 'Rasmlar/tog%FF.jpg'], ['Self="ParagraphStyle/Bob boshi" Name="Bob boshi"', 'Self="ParagraphStyle/Bob%E0%A4" Name="Bob%E0%A4"']), 'Kitob');
    expect(r.warnings).toContainEqual({ kind: 'picture', name: 'tog%FF.jpg' });
  });

  it('clamps wide margins to what a page design allows', () => {
    const r = idmlToLatex(idml(['Left="56.69"', 'Left="260"']), 'Kitob');
    expect(r.design.page?.inner).toBe(80);
  });

  it('drops a based-on link that would close a loop', () => {
    const r = idmlToLatex(
      idml(['<ParagraphStyle Self="ParagraphStyle/Asosiy matn" Name="Asosiy matn" PointSize="10.5" FirstLineIndent="14.173" Justification="LeftJustified" SpaceAfter="0">\n      <Properties><BasedOn type="object">ParagraphStyle/$ID/NormalParagraphStyle</BasedOn>',
        '<ParagraphStyle Self="ParagraphStyle/Asosiy matn" Name="Asosiy matn" PointSize="10.5" FirstLineIndent="14.173" Justification="LeftJustified" SpaceAfter="0">\n      <Properties><BasedOn type="object">ParagraphStyle/Iqtibos</BasedOn>']),
      'Kitob',
    );
    const p = Object.fromEntries(r.design.paragraphStyles.map((s) => [s.name, s]));
    // One of the two links stays; the import does not fail.
    expect([p['Iqtibos']!.basedOn, p['Asosiy matn']!.basedOn].filter(Boolean)).toHaveLength(1);
  });

  it('leaves out a forced line break at the start or end of a paragraph', () => {
    const r = idmlToLatex(idml(['<Content>Ikkinchi xatboshi&#x2028;yangi qatordan.</Content>', '<Content>&#x2028;Ikkinchi xatboshi&#x2028;yangi qatordan.&#x2028;</Content>']), 'Kitob');
    expect(r.mainTex).toContain('\nIkkinchi xatboshi\\\\ yangi qatordan.\n\\end{uslub}');
  });
});

describe('the model inside sahifa.sty and muqova.tex', () => {
  it('survives emoji at a line boundary and keeps U+2028 out of the TeX lines', () => {
    const d = defaultPageDesign(`${'a'.repeat(77)}📖 kitob\u2028ikki`);
    const sty = generatePageDesignPackage(d);
    expect(readPageDesign(sty)!.title).toBe(d.title);
    expect(sty).not.toContain('\u2028');
  });

  it('reads files saved with Windows line ends', () => {
    const d = defaultPageDesign('Roman');
    d.paragraphStyles.push({ id: 'maqol', name: 'Maqol – oʻzbekcha', italic: true });
    const sty = generatePageDesignPackage(d).replace(/\n/g, '\r\n');
    expect(readPageDesign(sty)?.paragraphStyles.map((s) => s.id)).toContain('maqol');
    const cover = { ...defaultCover('Kitob 📖'), pages: 200 };
    expect(readCover(generateCover(cover).replace(/\n/g, '\r\n'))?.title).toBe('Kitob 📖');
  });

  it('refuses absolute paths for pictures and fonts', () => {
    const d = defaultPageDesign('Roman');
    expect(() => normalizePageDesign({ ...d, masters: [{ ...d.masters[0]!, background: [{ kind: 'image', file: '/etc/x.png', x: 0, y: 0, w: 10, h: 10 }] }] })).toThrow();
    expect(() => normalizePageDesign({ ...d, paragraphStyles: [{ id: 'a', name: 'A', font: '/etc/fonts/x.ttf' }] })).toThrow();
  });

  it('sets up ʻ and ʼ for pdfLaTeX and lets a character style span paragraphs', () => {
    const sty = generatePageDesignPackage(defaultPageDesign('Oʻzbek tili'));
    expect(sty).toContain('\\DeclareUnicodeCharacter{02BB}');
    expect(sty).toContain('\\NewDocumentCommand\\matnuslubi{m+m}');
  });
});

describe('dragging a frame in visual mode', () => {
  const fixed = { fixedOnly: true };
  const text = ['\\rasmramka{a.png}{A}', '', '\\rasmramka[joy=sahifa,x=10mm,y=20mm]{b.png}{B}', 'Matn.'].join('\n');

  it('changes the fixed frame of that line', () => {
    expect(setFrameKeys(text, 3, { x: '50mm' }, fixed)).toContain('\\rasmramka[joy=sahifa,x=50mm,y=20mm]{b.png}{B}');
  });

  it('never moves a frame in the text flow, even when the line points at it', () => {
    expect(setFrameKeys(text, 1, { x: '50mm' }, fixed)).toBeNull();
    // Lines added above since the compile: the old line number now points at the flow frame.
    expect(setFrameKeys(`\n\n${text}`, 3, { x: '50mm' }, fixed)).toBeNull();
  });

  it('moves the text box, not a picture in the flow inside it', () => {
    const box = ['\\begin{matnquti}[x=5mm,y=5mm,en=60mm]', '\\rasmramka{c.png}{}', '\\end{matnquti}'].join('\n');
    expect(setFrameKeys(box, 3, { x: '30mm' }, fixed)).toContain('\\begin{matnquti}[x=30mm,y=5mm,en=60mm]');
  });
});

describe('accepting an AI proposal', () => {
  it('keeps the styles and masters the text may use, and the masters’ backgrounds', () => {
    const current: PageDesignSpec = defaultPageDesign('Roman');
    current.paragraphStyles.push({ id: 'sherqator', name: 'Sheʼr qatori', italic: true });
    current.masters[0]!.background = [{ kind: 'rect', x: 0, y: 0, w: 20, h: 20, color: 'EEEEEE' }];
    current.masters.push({ ...current.masters[0]!, id: 'ilova', name: 'Ilova', background: undefined });
    const proposed = defaultPageDesign('Roman');
    proposed.paragraphStyles = [{ id: 'asosiy', name: 'Asosiy', size: 12 }];
    const next = acceptAiProposal(current, proposed);
    expect(next.paragraphStyles[0]).toMatchObject({ id: 'asosiy', size: 12 });
    expect(next.paragraphStyles.map((s) => s.id)).toContain('sherqator');
    expect(next.masters.map((m) => m.id)).toContain('ilova');
    expect(next.masters.find((m) => m.id === current.masters[0]!.id)!.background).toHaveLength(1);
  });
});

describe('PDF text import', () => {
  it('keeps the file name in its comment line', () => {
    const tex = pdfTextToLatex('Salom dunyo.\n', 'kitob\n\\input{/etc/passwd}').mainTex;
    expect(live(tex).join('\n')).not.toContain('/etc/passwd');
  });
});
