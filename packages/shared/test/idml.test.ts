import { describe, expect, it } from 'vitest';
import { IdmlError, idmlToLatex, parseXml, readPageDesign } from '../src/index.js';
import { IDML_SAMPLE } from './fixtures/idml-sample.js';

describe('IDML import', () => {
  const r = idmlToLatex(IDML_SAMPLE, 'Ona yurt');

  it('reads XML with entities, CDATA and self-closing tags', () => {
    const x = parseXml('<?xml version="1.0"?><a k="1 &amp; 2"><b/><c>x &lt; y<![CDATA[<z>]]></c><!-- no --></a>');
    const a = x.children[0] as { attrs: Record<string, string>; children: unknown[] };
    expect(a.attrs.k).toBe('1 & 2');
    expect(JSON.stringify(a.children)).toContain('x < y');
    expect(JSON.stringify(a.children)).toContain('<z>');
  });

  it('takes the styles over with their properties', () => {
    const p = Object.fromEntries(r.design.paragraphStyles.map((s) => [s.name, s]));
    expect(p['Asosiy matn']).toMatchObject({ size: 10.5, leading: 14, indent: 5, align: 'justify' });
    expect(p['Iqtibos']).toMatchObject({ italic: true, leftIndent: 10, spaceBefore: 6, color: '1F3A5F', basedOn: p['Asosiy matn']!.id });
    expect(p['Bob boshi']!.dropCap).toBe(3);
    expect(p['Sarlavha 1']).toMatchObject({ heading: 1, size: 20, bold: true, align: 'center', keepWithNext: true });
    expect(p['Sarlavha 2']!.heading).toBe(2);
    expect(r.design.characterStyles).toEqual([expect.objectContaining({ name: 'Urg‘u', italic: true, color: 'FF0000' })]);
    // No IDML built-in styles.
    expect(r.design.paragraphStyles.some((s) => /NormalParagraphStyle|No paragraph/.test(s.name))).toBe(false);
  });

  it('writes the text in frame order, with styles, footnotes and line breaks', () => {
    const tex = r.mainTex;
    const id = (name: string) => r.design.paragraphStyles.find((s) => s.name === name)!.id;
    const urgu = r.design.characterStyles[0]!.id;
    expect(tex).toContain('\\section{Birinchi bob}');
    expect(tex).toContain(`\\begin{uslub}{${id('Bob boshi')}}\nQishloq tongi 50\\% \\& shabada.\n\\end{uslub}`);
    expect(tex).toContain(`Oddiy matn va \\matnuslubi{${urgu}}{muhim soʻz}\\textbf{ qalin}, izohi bilan\\footnote{Izoh matni.}.`);
    expect(tex).toContain('Ikkinchi xatboshi\\\\ yangi qatordan.');
    expect(tex).toContain('Katak bir');
    // Story u100 has the first frame on the spread, although designmap lists u200 first.
    expect(tex.indexOf('Birinchi bob')).toBeLessThan(tex.indexOf('\\subsection{Ikkinchi ramka}'));
  });

  it('sets the page and margins and lists what it could not take over', () => {
    expect(r.mainTex).toContain('\\documentclass[11pt,twoside]{article}');
    expect(r.mainTex).toContain('paperwidth=148mm,paperheight=210mm');
    expect(r.design.page).toEqual({ inner: 20, outer: 15, top: 15, bottom: 20 });
    expect(r.warnings).toEqual(
      expect.arrayContaining([
        { kind: 'font', name: 'Minion Pro' },
        { kind: 'picture', name: 'tog‘.jpg' },
        { kind: 'table', count: 1 },
      ]),
    );
    expect(r.mainTex).toContain('% Rasm (IDML ichida emas, alohida yuklang): tog‘.jpg');
    expect(readPageDesign(r.sahifaSty)).toEqual(r.design);
  });

  it('refuses other files', () => {
    expect(() => idmlToLatex({ 'word/document.xml': '<w:document/>' }, 'x')).toThrow(IdmlError);
  });
});
