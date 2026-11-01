import { describe, expect, it } from 'vitest';
import { PageDesignError, defaultPageDesign, generatePageDesignPackage, normalizePageDesign, readPageDesign } from '../src/index.js';

const withBackground = () => {
  const d = defaultPageDesign('Kitob');
  d.masters[0]!.background = [
    { kind: 'rect', x: 0, y: 0, w: 12, h: 297, color: 'e8d9b5', mirror: true },
    { kind: 'line', x: 20, y: 15, w: 170, h: 0, color: '8A5A2B', thickness: 1.2 },
    { kind: 'image', x: 160, y: 260, w: 30, h: 30, file: 'rasmlar/quyosh.png', transparency: 0.5 },
  ];
  d.chapterEndOrnament = 'fleuron';
  return d;
};

describe('master backgrounds and chapter ornaments', () => {
  it('keeps them in the model', () => {
    const sty = generatePageDesignPackage(withBackground());
    const back = readPageDesign(sty)!;
    expect(back.masters[0]!.background).toHaveLength(3);
    expect(back.chapterEndOrnament).toBe('fleuron');
  });

  it('draws them under the pages of their master, mirrored on left-hand pages', () => {
    const sty = generatePageDesignPackage(withBackground());
    const id = withBackground().masters[0]!.id;
    expect(sty).toContain(`\\definecolor{sahifa@bg@${id}@1}{HTML}{E8D9B5}`);
    expect(sty).toContain(`\\ifsahifa@evenpage \\fill[sahifa@bg@${id}@1] (\\paperwidth-12mm,0mm) rectangle ++(12mm,-297mm);\\else \\fill[sahifa@bg@${id}@1] (0mm,0mm)`);
    expect(sty).toContain('line width=1.2pt');
    expect(sty).toContain('opacity=0.5] at (160mm,-260mm) {\\sahifa@cover{rasmlar/quyosh.png}{30mm}{30mm}}');
    expect(sty).toContain('\\AddToShipoutPictureBG');
    // \sahifausta remembers the master; blank pages skip the background.
    expect(sty).toContain('\\gdef\\sahifa@master{#1}');
    expect(sty).toContain('\\thispagestyle{empty}\\sahifa@blankbg\\clearpage');
    expect(sty).toContain('\\newcommand\\bobbezagi');
    expect(sty).toContain('\\RequirePackage{pifont}');
    expect(sty).toContain('\\AddToHook{cmd/chapter/before}');
  });

  it('adds nothing when there is none', () => {
    const sty = generatePageDesignPackage(defaultPageDesign('Kitob'));
    expect(sty).not.toContain('sahifa@bg@');
    expect(sty).not.toContain('bobbezagi');
  });

  it('refuses bad elements', () => {
    const bad = (b: object) => () => {
      const d = defaultPageDesign('K') as unknown as { masters: { background: object[] }[] };
      d.masters[0]!.background = [b];
      normalizePageDesign(d);
    };
    expect(bad({ kind: 'circle', x: 0, y: 0, w: 1, h: 1 })).toThrow(PageDesignError);
    expect(bad({ kind: 'image', x: 0, y: 0, w: 1, h: 1, file: '../secret.png' })).toThrow(PageDesignError);
    expect(bad({ kind: 'image', x: 0, y: 0, w: 1, h: 1, file: 'a}\\input{x}.png' })).toThrow(PageDesignError);
    expect(bad({ kind: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'red' })).toThrow(PageDesignError);
    expect(() => normalizePageDesign({ ...defaultPageDesign('K'), chapterEndOrnament: 'heart' })).toThrow(PageDesignError);
  });

  it('has the picture grid for albums and catalogues', () => {
    const sty = generatePageDesignPackage(defaultPageDesign('Albom'));
    expect(sty).toContain('\\NewDocumentEnvironment{rasmtori}{O{0.7}m}');
    expect(sty).toContain('\\NewDocumentCommand\\torrasm{m+m}');
  });
});
