import { describe, expect, it } from 'vitest';
import { CoverError, PAPERS, coverGeometry, defaultCover, generateCover, normalizeCover, pagesFromLog, readCover } from '../src/index.js';

describe('cover (muqova)', () => {
  it('works out the spine from the pages and the paper', () => {
    const c = { ...defaultCover('Kitob'), pages: 240, paper: 'ofset-80' };
    // 120 sheets × 0.1 mm + 0.5 mm of cover card.
    expect(coverGeometry(c).spine).toBe(12.5);
    expect(coverGeometry({ ...c, thickness: 0.05 }).spine).toBe(6.5);
    // An odd page count still takes a whole sheet.
    expect(coverGeometry({ ...c, pages: 241 }).spine).toBe(12.6);
    const g = coverGeometry(c);
    // A5: back + spine + front + 2 × 3 mm bleed + 2 × 12 mm for the marks.
    expect(g.page.w).toBeCloseTo(148 * 2 + 12.5 + 6 + 24, 5);
    expect(g.front - g.spineX).toBe(12.5);
  });

  it('knows the bindings and warns where they do not fit', () => {
    const c = defaultCover('K');
    expect(coverGeometry({ ...c, binding: 'skoba', pages: 48 })).toMatchObject({ spine: 0, warnings: [] });
    expect(coverGeometry({ ...c, binding: 'skoba', pages: 70 }).warnings).toEqual(['staplePages', 'stapleTooThick']);
    expect(coverGeometry({ ...c, pages: 24 }).warnings).toEqual(['gluedTooThin', 'spineTooThin']);
    const hard = coverGeometry({ ...c, binding: 'qattiq', pages: 200 });
    expect(hard).toMatchObject({ hinge: 7, edge: 15, panel: { w: 151, h: 216 } });
    expect(hard.spine).toBe(15);
  });

  it('has the papers people use, all thicknesses sensible', () => {
    const kinds = new Set(PAPERS.map((p) => p.kind));
    expect([...kinds]).toEqual(['gazeta', 'ofset', 'borYaltiroq', 'borXira', 'kitob']);
    for (const p of PAPERS) expect(p.thickness).toBeGreaterThan(0.05), expect(p.thickness).toBeLessThan(0.2);
  });

  it('keeps the model in muqova.tex and escapes the text', () => {
    const c = { ...defaultCover('50% & {boshqa}'), author: 'A_B', back: 'Birinchi.\n\nIkkinchi #1.', isbn: '978-9943-01-234-9', frontImage: 'rasmlar/old.jpg' };
    const tex = generateCover(c);
    expect(readCover(tex)).toEqual(normalizeCover(c));
    expect(tex).toContain('50\\% \\& \\{boshqa\\}');
    expect(tex).toContain('Birinchi.\\par Ikkinchi \\#1.');
    expect(tex).toContain('\\muqova@fill{rasmlar/old.jpg}');
    expect(tex).toContain('ISBN 978-9943-01-234-9');
    expect(readCover('\\documentclass{article}')).toBeNull();
  });

  it('refuses bad input', () => {
    const bad = (patch: object) => () => normalizeCover({ ...defaultCover('K'), ...patch });
    expect(bad({ paper: 'papirus-1' })).toThrow(CoverError);
    expect(bad({ binding: 'spiral' })).toThrow(CoverError);
    expect(bad({ pages: 2 })).toThrow(CoverError);
    expect(bad({ frontImage: '../x.png' })).toThrow(CoverError);
    expect(bad({ isbn: '978-9943-01-234-0' })).toThrow(CoverError);
    expect(bad({ format: 'custom' })).toThrow(CoverError);
    expect(normalizeCover({ ...defaultCover('K'), format: 'custom', width: 200, height: 200 }).width).toBe(200);
  });

  it('reads the page count from the log', () => {
    expect(pagesFromLog('Output written on main.xdv (3 pages)\nOutput written on main.pdf (212 pages, 1 bytes).')).toBe(212);
    expect(pagesFromLog('Output written on main.pdf (1 page, 1 bytes).')).toBe(1);
    expect(pagesFromLog('nothing')).toBeNull();
  });
});
