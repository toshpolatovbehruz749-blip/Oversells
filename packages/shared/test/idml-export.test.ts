import { describe, expect, it } from 'vitest';
import {
  defaultPageDesign,
  estimatePages,
  formulaText,
  idmlToLatex,
  latexToBlocks,
  pageSetupFromLatex,
  parseXml,
  projectToIdml,
  type PageDesignSpec,
} from '../src/index.js';

const MAIN = String.raw`\documentclass[11pt,twoside]{book}
\usepackage[paperwidth=145mm,paperheight=200mm,inner=18mm,outer=14mm,top=16mm,bottom=20mm]{geometry}
\usepackage{fontspec}
\setmainfont{Noto Serif}
\usepackage{sahifa}
\begin{document}
\chapter{Qishloq tongi}
Tong otar-otmas % izoh, ko'rinmaydi
qishloq uygʻondi --- \textbf{qalin} va \emph{kursiv} soʻz, 50\% \& narsa.\footnote{Izoh matni.}

\begin{uslub}{iqtibos}
Oʻz yurtingni sevmoq.
\end{uslub}

Formula $a^2+b^2=c^2$ va \matnuslubi{urgu}{muhim soʻz}.
\section{Daryo boʻyida}
\begin{itemize}
\item birinchi
\item ikkinchi
\end{itemize}
\rasmramka[en=60mm]{rasmlar/daryo.png}{Daryo manzarasi}
\input{boblar/ikki}
\end{document}
`;
const IKKI = String.raw`\chapter{Ikkinchi bob}
\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}
Oxirgi xatboshi.`;
const read = (p: string) => (p === 'boblar/ikki.tex' ? IKKI : null);

const design = (): PageDesignSpec => {
  const d = defaultPageDesign('Ona yurt');
  d.paragraphStyles = [
    { id: 'iqtibos', name: 'Iqtibos', italic: true, leftIndent: 10, size: 10, leading: 13, color: '1F3A5F' },
    { id: 'sarlavha', name: 'Bob sarlavhasi', heading: 1, size: 20, bold: true, align: 'center' },
  ];
  d.characterStyles = [{ id: 'urgu', name: 'Urgʻu', italic: true, color: 'C0392B' }];
  return d;
};

describe('LaTeX to paragraphs', () => {
  const r = latexToBlocks(MAIN, read);

  it('finds headings, styles, lists, pictures and the files it inputs', () => {
    expect(r.chapters).toBe(true);
    const kinds = r.blocks.map((b) => (b.kind === 'heading' ? `h${b.level}` : b.kind === 'style' ? `style:${b.style}` : b.kind));
    expect(kinds).toEqual(['h1', 'body', 'style:iqtibos', 'body', 'h2', 'list', 'list', 'body', 'caption', 'h1', 'body', 'body']);
    expect(r.pictures).toEqual(['rasmlar/daryo.png']);
    expect(r.formulas).toBe(1);
    expect(r.drawings).toBe(1);
  });

  it('keeps the text with its marks, and drops comments', () => {
    const body = r.blocks[1]!;
    const text = body.runs.map((x) => (x.type === 'text' ? x.text : x.type === 'footnote' ? '[fn]' : '')).join('');
    expect(text).toBe('Tong otar-otmas qishloq uygʻondi — qalin va kursiv soʻz, 50% & narsa.[fn]');
    expect(body.runs).toContainEqual({ type: 'text', text: 'qalin', bold: true });
    expect(body.runs).toContainEqual({ type: 'text', text: 'kursiv', italic: true });
    const fn = body.runs.find((x) => x.type === 'footnote');
    expect(fn).toMatchObject({ paragraphs: [{ runs: [{ type: 'text', text: 'Izoh matni.' }] }] });
    const formula = r.blocks[3]!.runs;
    expect(formula).toContainEqual({ type: 'text', text: 'a²+b²=c²', formula: true });
    expect(formula).toContainEqual({ type: 'text', text: 'muhim soʻz', charStyle: 'urgu' });
    expect(r.blocks[5]!.runs[0]).toMatchObject({ text: '•\tbirinchi' });
    expect(r.blocks[7]!.runs[0]).toEqual({ type: 'picture', file: 'rasmlar/daryo.png', widthMm: 60 });
  });

  it('reads the page setup from the preamble', () => {
    expect(pageSetupFromLatex(MAIN)).toMatchObject({ widthMm: 145, heightMm: 200, inner: 18, outer: 14, top: 16, bottom: 20, facing: true, fontSize: 11, mainFont: 'Noto Serif' });
    expect(pageSetupFromLatex('\\documentclass[a5paper]{article}\\begin{document}x')).toMatchObject({ widthMm: 148, heightMm: 210, facing: false, fontSize: 10 });
  });
});

describe('IDML export', () => {
  const picture = (p: string) => (p === 'rasmlar/daryo.png' ? { uri: 'file:Links/daryo.png', widthPx: 1200, heightPx: 800, ppi: 300, format: 'png' as const } : null);
  const r = projectToIdml({ title: 'Ona yurt', mainTex: MAIN, readFile: read, design: design(), pages: 12, picture });

  it('writes well-formed parts that the designmap lists', () => {
    expect(r.parts.mimetype).toBe('application/vnd.adobe.indesign-idml-package');
    for (const [path, xml] of Object.entries(r.parts)) if (path.endsWith('.xml')) expect(() => parseXml(xml), path).not.toThrow();
    const dm = r.parts['designmap.xml']!;
    for (const src of dm.matchAll(/src="([^"]+)"/g)) expect(r.parts[src[1]!], src[1]).toBeDefined();
    expect(r.pages).toBeGreaterThanOrEqual(12);
    expect(r.warnings).toEqual(expect.arrayContaining([{ kind: 'formulas', count: 1 }, { kind: 'drawings', count: 1 }]));
  });

  it('threads one story through a frame on every page', () => {
    const spreads = Object.entries(r.parts).filter(([p]) => p.startsWith('Spreads/')).map(([, x]) => x).join('');
    const frames = [...spreads.matchAll(/<TextFrame Self="([^"]+)" ParentStory="([^"]+)" PreviousTextFrame="([^"]+)" NextTextFrame="([^"]+)"/g)];
    expect(frames).toHaveLength(r.pages);
    expect(new Set(frames.map((f) => f[2])).size).toBe(1);
    expect(frames[0]![3]).toBe('n');
    expect(frames.at(-1)![4]).toBe('n');
    for (let i = 1; i < frames.length; i++) expect(frames[i]![3]).toBe(frames[i - 1]![1]);
    expect(r.parts['Resources/Preferences.xml']).toContain('PagesPerDocument="1"');
  });

  it('puts running heads with a page number and the chapter variable on the masters', () => {
    const masters = Object.entries(r.parts).filter(([p]) => p.startsWith('MasterSpreads/'));
    expect(masters).toHaveLength(design().masters.length);
    const stories = Object.values(r.parts).join('');
    expect(stories).toContain('<?ACE 18?>');
    expect(r.parts['designmap.xml']).toContain('VariableType="MatchParagraphStyleType"');
  });

  it('links the picture with its size from the pixels and ppi', () => {
    const story = Object.entries(r.parts).find(([p, x]) => p.startsWith('Stories/') && x.includes('<Rectangle'))![1];
    expect(story).toContain('LinkResourceURI="file:Links/daryo.png"');
    // 1200 px at 300 ppi = 288 pt wide; the frame is 60 mm = 170.08 pt.
    expect(story).toMatch(/Right="288" Bottom="192"/);
    expect(story).toMatch(/ItemTransform="0\.59\d* 0 0 0\.59\d* 0 0"/);
  });

  it('comes back through the IDML import with its text, styles and page', () => {
    const back = idmlToLatex(r.parts, 'Ona yurt');
    const tex = back.mainTex;
    expect(tex).toContain('\\section{Qishloq tongi}');
    expect(tex).toContain('\\subsection{Daryo boʻyida}');
    expect(tex).toContain('qalin');
    expect(tex).toContain('\\footnote{Izoh matni.}');
    expect(tex).toContain('Oxirgi xatboshi.');
    // Running heads are not body text.
    expect(tex).not.toMatch(/Ona yurt\s*\n\n.*Qishloq tongi[\s\S]*Ona yurt$/);
    const styles = Object.fromEntries(back.design.paragraphStyles.map((s) => [s.name, s]));
    expect(styles['Iqtibos']).toMatchObject({ italic: true, leftIndent: 10, size: 10, leading: 13, color: '1F3A5F' });
    expect(styles['Sarlavha 1']).toMatchObject({ heading: 1, size: 20, bold: true, align: 'center' });
    expect(back.design.characterStyles).toContainEqual(expect.objectContaining({ name: 'Urgʻu', italic: true, color: 'C0392B' }));
    expect(tex).toMatch(/\\begin\{uslub\}\{iqtibos\}\nOʻz yurtingni sevmoq\.\n\\end\{uslub\}/);
    expect(tex).toContain('paperwidth=145mm,paperheight=200mm');
    expect(back.design.page).toMatchObject({ inner: 18, outer: 14, top: 16, bottom: 20 });
    expect(back.warnings).toContainEqual({ kind: 'picture', name: 'daryo.png' });
  });

  it('notes a picture that is not in the project', () => {
    const r2 = projectToIdml({ title: 'X', mainTex: MAIN, readFile: read });
    expect(r2.warnings).toContainEqual({ kind: 'missingPicture', name: 'rasmlar/daryo.png' });
  });
});

describe('formulas as text', () => {
  it('turns what has a plain form into characters and keeps the rest', () => {
    expect(formulaText('\\label{eq:a} x_{1,2} = \\frac{-b \\pm \\sqrt{D}}{2a}')).toBe('x_{1,2} = (-b ± √D)/2a');
    expect(formulaText('\\displaystyle\\int_0^1 x^2\\,dx = \\left. \\frac{x^3}{3}\\right|_0^1')).toBe('∫₀¹ x² dx = x³/3|₀¹');
    expect(formulaText('\\sin^2\\alpha+\\cos^2\\alpha=1')).toBe('sin²α+cos²α=1');
    expect(formulaText('D = b^2 - 4ac \\geq 0')).toBe('D = b² - 4ac ≥ 0');
    expect(formulaText('\\overline{AB}')).toBe('\\overline{AB}');
  });
});

describe('environments with names and titles', () => {
  it('drops a language argument and keeps a theorem title in bold', () => {
    const r = latexToBlocks('\\begin{document}\\begin{otherlanguage}{uzbekcyr}Кирилл матн\\end{otherlanguage}\n\n\\begin{teorema}[Viyet]Yigʻindi\\end{teorema}\\end{document}');
    expect(r.blocks.map((b) => b.runs)).toEqual([
      [{ type: 'text', text: 'Кирилл матн' }],
      [{ type: 'text', text: 'Viyet', bold: true }, { type: 'text', text: '. Yigʻindi' }],
    ]);
  });
});

describe('page estimate', () => {
  it('counts chapters on odd pages and long text', () => {
    const text = (n: number) => ({ kind: 'body' as const, runs: [{ type: 'text' as const, text: 'x'.repeat(n) }] });
    const h1 = { kind: 'heading' as const, level: 1 as const, runs: [{ type: 'text' as const, text: 'Bob' }] };
    const m = { lineChars: 60, lines: 30, chapters: true, oddChapters: true };
    // Two chapters of half a page each: pages 1, then 3 (odd) → 3 pages, with room to spare.
    expect(estimatePages([h1, text(600), h1, text(600)], m)).toBe(Math.ceil(3 * 1.15));
    expect(estimatePages([text(60 * 30 * 4)], m)).toBeGreaterThanOrEqual(4);
  });
});
