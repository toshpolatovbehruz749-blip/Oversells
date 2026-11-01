import { describe, expect, it } from 'vitest';
import {
  PageDesignError,
  applyCharacterStyle,
  applyParagraphStyle,
  defaultPageDesign,
  escapeLatex,
  generatePageDesignPackage,
  normalizePageDesign,
  readPageDesign,
  resolveParagraphStyle,
  withPageDesignPackage,
  type PageDesignSpec,
} from '../src/page-design.js';
import { transliterateLatex } from '../src/transliterate.js';

const spec = (): PageDesignSpec => defaultPageDesign('Kitob');

describe('page design model', () => {
  it('accepts the default design and keeps it through sahifa.sty', () => {
    const sty = generatePageDesignPackage(spec());
    expect(readPageDesign(sty)).toEqual(normalizePageDesign(spec()));
  });

  it('rejects bad ids, unknown references, duplicates and loops', () => {
    const bad = (change: (s: PageDesignSpec) => void) => {
      const s = spec();
      change(s);
      return () => normalizePageDesign(s);
    };
    expect(bad((s) => (s.paragraphStyles[0]!.id = 'Iqtibos'))).toThrow(PageDesignError);
    expect(bad((s) => (s.paragraphStyles[0]!.id = 'sheʼr'))).toThrow(PageDesignError);
    expect(bad((s) => (s.defaultMaster = 'yoq'))).toThrow(/defaultMaster/);
    expect(bad((s) => (s.chapterMaster = 'yoq'))).toThrow(/chapterMaster/);
    expect(bad((s) => s.characterStyles.push({ id: 'urgu', name: 'Yana' }))).toThrow(/twice/);
    expect(bad((s) => (s.paragraphStyles[0]!.basedOn = 'yoq'))).toThrow(/no style/);
    expect(
      bad((s) => {
        s.paragraphStyles[0]!.basedOn = 'izoh';
        s.paragraphStyles[2]!.basedOn = 'iqtibos';
      }),
    ).toThrow(/loop/);
    expect(bad((s) => (s.paragraphStyles[0]!.font = 'X}\\input{/etc/passwd'))).toThrow(PageDesignError);
    expect(bad((s) => (s.paragraphStyles[0]!.font = '../yashirin.otf'))).toThrow(PageDesignError);
    expect(bad((s) => (s.paragraphStyles[0]!.color = 'red'))).toThrow(/RRGGBB/);
    expect(bad((s) => (s.paragraphStyles[0]!.size = 500))).toThrow(/size/);
    expect(bad((s) => (s.masters = []))).toThrow(/master/);
  });

  it('inherits through basedOn, but not the heading level', () => {
    const s = spec();
    s.paragraphStyles.push({ id: 'qizil', name: 'Qizil iqtibos', basedOn: 'iqtibos', color: 'AA0000' });
    const r = resolveParagraphStyle(normalizePageDesign(s), 'qizil');
    expect(r).toMatchObject({ id: 'qizil', name: 'Qizil iqtibos', italic: true, leftIndent: 10, color: 'AA0000' });
  });

  it('a broken model in the file reads as none', () => {
    expect(readPageDesign('% oversells-sahifa: {"version":1')).toBeNull();
    expect(readPageDesign('\\ProvidesPackage{sahifa}')).toBeNull();
  });
});

describe('sahifa.sty', () => {
  it('writes masters, the chapter page, styles and rules', () => {
    const s = spec();
    s.chapterOpensRight = true;
    s.masters[0]!.numbering = 'roman';
    const sty = generatePageDesignPackage(s);
    expect(sty).toContain('\\fancypagestyle{sahifa@asosiy}');
    expect(sty).toContain('\\fancyhead[CO]{\\leftmark}');
    expect(sty).toContain('\\fancyhead[RO]{\\thepage}');
    expect(sty).toContain('\\fancyhead[LE]{\\thepage}');
    expect(sty).toContain('\\fancyhead[CE]{\\sahifa@title}');
    expect(sty).toContain('\\fancypagestyle{plain}');
    expect(sty).toContain('\\pagestyle{sahifa@asosiy}');
    expect(sty).toContain('\\@namedef{sahifa@numbering@asosiy}{roman}');
    expect(sty).toContain('\\@openrighttrue');
    expect(sty).toContain('\\renewcommand\\cleardoublepage');
    expect(sty).toContain('\\widowpenalty=10000');
    expect(sty).toContain('\\@namedef{sahifa@p@iqtibos}{\\itshape\\advance\\leftskip 10mm}');
    expect(sty).toContain('\\@namedef{sahifa@c@atama}{\\bfseries}');
    expect(sty).toContain('\\NewDocumentEnvironment{uslub}{m}');
    expect(sty).toContain('\\NewDocumentCommand\\matnuslubi{mm}');
    expect(sty).not.toContain('titlesec');
  });

  it('escapes the user text of running heads and the title', () => {
    expect(escapeLatex('50% $a_#1 {x} \\ ^ ~ &')).toBe(
      '50\\% \\$a\\_\\#1 \\{x\\} \\textbackslash{} \\textasciicircum{} \\textasciitilde{} \\&',
    );
    const s = spec();
    s.title = 'A & B';
    s.masters[0]!.odd.foot.center = { kind: 'text', text: '100% tayyor' };
    const sty = generatePageDesignPackage(s);
    expect(sty).toContain('\\newcommand\\sahifa@title{A \\& B}');
    expect(sty).toContain('\\fancyfoot[CO]{100\\% tayyor}');
  });

  it('formats headings with titlesec and fonts with fontspec (letters-only macro names)', () => {
    const s = spec();
    s.paragraphStyles.push(
      { id: 'sarlavha', name: 'Sarlavha 1', heading: 1, size: 22, font: 'Noto Sans', color: '2A4D6E', align: 'center' },
      { id: 'maxsus', name: 'Maxsus', font: 'fonts/Kitob Shrift.otf', tracking: 50 },
    );
    const sty = generatePageDesignPackage(s);
    expect(sty).toContain('\\RequirePackage{titlesec}');
    expect(sty).toContain('\\titleformat{\\chapter}[hang]');
    expect(sty).toContain('\\titleformat{\\section}[hang]');
    expect(sty).toContain('\\newfontfamily\\sahifa@font@a{Noto Sans}');
    expect(sty).toContain('\\newfontfamily\\sahifa@font@b{Kitob Shrift.otf}[Path=./fonts/]');
    expect(sty).toContain('\\addfontfeature{LetterSpace=5}');
    expect(sty).not.toMatch(/\\sahifa@font@[a-z]*[0-9]/);
  });
});

describe('the main file', () => {
  it('loads sahifa once, before \\begin{document}', () => {
    const main = '\\documentclass{book}\n\\usepackage{dizayn}\n\\begin{document}\nMatn\n\\end{document}\n';
    const once = withPageDesignPackage(main)!;
    expect(once).toContain('\\usepackage{dizayn}\n\\usepackage{sahifa}');
    expect(withPageDesignPackage(once)).toBeNull();
    expect(withPageDesignPackage('% \\usepackage{sahifa}\n\\begin{document}\n')).toContain('\n\\usepackage{sahifa}');
    expect(withPageDesignPackage('no body')).toBeNull();
  });
});

describe('applying styles', () => {
  const apply = (text: string, edits: { from: number; to: number; insert: string }[]) => {
    let out = text;
    for (const e of [...edits].sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
    return out;
  };

  it('wraps the paragraphs a selection touches', () => {
    const text = 'Birinchi xatboshi.\n\nIkkinchi xatboshi,\nikki qatorli.\n\nUchinchi.';
    const at = text.indexOf('xatboshi,');
    expect(apply(text, applyParagraphStyle(text, at, at, 'iqtibos'))).toBe(
      'Birinchi xatboshi.\n\n\\begin{uslub}{iqtibos}\nIkkinchi xatboshi,\nikki qatorli.\n\\end{uslub}\n\nUchinchi.',
    );
    const two = apply(text, applyParagraphStyle(text, 2, text.indexOf('ikki'), 'sher'));
    expect(two).toBe('\\begin{uslub}{sher}\nBirinchi xatboshi.\n\nIkkinchi xatboshi,\nikki qatorli.\n\\end{uslub}\n\nUchinchi.');
  });

  it('changes the style of an already styled paragraph', () => {
    const text = 'A\n\n\\begin{uslub}{iqtibos}\nMatn\n\\end{uslub}\n';
    const at = text.indexOf('Matn');
    expect(apply(text, applyParagraphStyle(text, at, at + 2, 'izoh'))).toBe('A\n\n\\begin{uslub}{izoh}\nMatn\n\\end{uslub}\n');
  });

  it('styles only the text of the document, not the preamble', () => {
    const text = '\\documentclass{book}\n\\usepackage{x}\n\n\\begin{document}\nMatn.\n\\end{document}\nKeyin';
    expect(() => applyParagraphStyle(text, 16, 16, 'iqtibos')).toThrow(expect.objectContaining({ code: 'notInBody' }));
    expect(() => applyCharacterStyle(text, text.length - 3, text.length, 'urgu')).toThrow(expect.objectContaining({ code: 'notInBody' }));
    const at = text.indexOf('Matn');
    expect(apply(text, applyParagraphStyle(text, at, at, 'iqtibos'))).toContain('\\begin{document}\n\\begin{uslub}{iqtibos}\nMatn.\n\\end{uslub}\n\\end{document}');
  });

  it('wraps a selection in a character style, and refuses broken selections', () => {
    const text = 'Bu {muhim} soʻz.';
    expect(apply(text, applyCharacterStyle(text, 3, 10, 'urgu'))).toBe('Bu \\matnuslubi{urgu}{{muhim}} soʻz.');
    expect(() => applyCharacterStyle(text, 3, 7, 'urgu')).toThrow(/group/);
    expect(() => applyCharacterStyle(text, 3, 3, 'urgu')).toThrow(PageDesignError);
    expect(() => applyCharacterStyle('a\n\nb', 0, 4, 'urgu')).toThrow(/one paragraph/);
    expect(() => applyCharacterStyle(text, 0, 2, 'Urgu')).toThrow(PageDesignError);
  });
});

describe('Uzbek scripts inside styled text', () => {
  it('converts the text but keeps style and master ids', () => {
    const tex = String.raw`\begin{document}
\sahifausta{boshlanish}
\begin{uslub}{sher}
Shahar choʻl
\end{uslub}
\matnuslubi{xorijiy}{shoshma}
\end{document}`;
    const yangi = transliterateLatex(tex, 'yangi');
    expect(yangi).toContain('\\sahifausta{boshlanish}');
    expect(yangi).toContain('\\begin{uslub}{sher}\nŞahar çöl');
    expect(yangi).toContain('\\matnuslubi{xorijiy}{şoşma}');
    const cyr = transliterateLatex(tex, 'cyrl');
    expect(cyr).toContain('\\begin{uslub}{sher}\nШаҳар чўл');
    expect(cyr).toContain('\\matnuslubi{xorijiy}{шошма}');
  });
});

describe('page, typography and frames', () => {
  it('writes margins, the column gap, microtype and drop caps', () => {
    const s = spec();
    s.page = { inner: 22, outer: 15, top: 20, bottom: 22, columnGap: 6 };
    s.microtype = true;
    s.paragraphStyles.push({ id: 'boshi', name: 'Bob boshi', dropCap: 3 }, { id: 'band', name: 'Band', parSkip: 8 });
    const sty = generatePageDesignPackage(s);
    expect(sty).toContain('\\geometry{inner=22mm,outer=15mm,top=20mm,bottom=22mm}');
    expect(sty).toContain('\\setlength\\columnsep{6mm}');
    expect(sty).toContain('\\NewDocumentEnvironment{ustunlar}{m}');
    expect(sty).toContain('\\RequirePackage{microtype}');
    expect(sty).toContain('\\RequirePackage{lettrine}');
    expect(sty).toContain('\\@namedef{sahifa@pd@boshi}{\\sahifa@dropcap{3}}');
    expect(sty).toContain('\\@namedef{sahifa@pd@iqtibos}{\\ignorespaces}');
    expect(sty).toContain('\\@namedef{sahifa@p@band}{\\parskip=8pt}');
    expect(readPageDesign(sty)).toMatchObject({ page: s.page, microtype: true });
  });

  it('leaves the page alone when nothing is set, and checks the numbers', () => {
    const sty = generatePageDesignPackage(spec());
    expect(sty).not.toContain('\\geometry');
    expect(sty).not.toContain('microtype');
    expect(sty).not.toContain('lettrine');
    expect(() => normalizePageDesign({ ...spec(), page: { inner: 1 } })).toThrow(/inner margin/);
    expect(() => normalizePageDesign({ ...spec(), paragraphStyles: [{ id: 'a', name: 'A', dropCap: 7 }] })).toThrow(/drop cap/);
  });

  it('defines the picture frames', () => {
    const sty = generatePageDesignPackage(spec());
    expect(sty).toContain('\\NewDocumentCommand\\rasmramka{O{}mm}');
    for (const mode of ['oqim', 'oralash', 'sahifa', 'tola']) expect(sty).toContain(`\\def\\sahifa@ram@${mode}#1#2`);
    expect(sty).toContain('\\RequirePackage{zref-abspage}');
  });

  it('frames keep their file name and keys through script conversion; the caption is text', () => {
    const tex = '\\begin{document}\n\\rasmramka[joy=oralash,tomon=chap,en=45mm]{rasmlar/kichik_shakl.png}{Choʻl manzarasi}\n\\begin{ustunlar}{2}\nShahar\n\\end{ustunlar}\n\\end{document}';
    const yangi = transliterateLatex(tex, 'yangi');
    expect(yangi).toContain('\\rasmramka[joy=oralash,tomon=chap,en=45mm]{rasmlar/kichik_shakl.png}{Çöl manzarasi}');
    expect(yangi).toContain('\\begin{ustunlar}{2}\nŞahar');
  });
});
