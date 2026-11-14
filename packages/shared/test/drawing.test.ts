import { describe, expect, it } from 'vitest';
import { drawingSource, drawingToTikz, EMPTY_DRAWING, findDrawing, normalizeDrawing, evalExpr, exprToPgf, functionPieces, parseExpr } from '../src/drawing.js';

const f = (s: string, x: number) => evalExpr(parseExpr(s), x);

describe('parseExpr / evalExpr', () => {
  it('reads what teachers type', () => {
    expect(f('2x^2 - 3x + 1', 2)).toBe(3);
    expect(f('y = x²', 3)).toBe(9);
    expect(f('3(x+1)', 1)).toBe(6);
    expect(f('sin(pi/2)', 0)).toBeCloseTo(1);
    expect(f('2sin x', Math.PI / 2)).toBeCloseTo(2);
    expect(f('sin 2x', Math.PI / 4)).toBeCloseTo(1);
    expect(f('|x-3|', 1)).toBe(2);
    expect(f('2|x|+1', -3)).toBe(7);
    expect(f('e^-x', 0)).toBe(1);
    expect(f('-x^2', 3)).toBe(-9);
    expect(f('2^x^2', 1)).toBe(2);
    expect(f('√(x+1)', 3)).toBe(2);
    expect(f('1/x', 0)).toBeNaN();
    expect(f('x^(1/3)', -8)).toBeCloseTo(-2);
    expect(f('sqrt(x)', -1)).toBeNaN();
    expect(f('0,5x', 4)).toBe(2);
  });
  it('rejects nonsense', () => {
    expect(() => parseExpr('2x +')).toThrow();
    expect(() => parseExpr('foo(x)')).toThrow();
    expect(() => parseExpr('(x')).toThrow();
  });
});

describe('exprToPgf', () => {
  it('writes pgfmath with radians', () => {
    expect(exprToPgf(parseExpr('2x^2-3x+1'))).toBe('2*\\x^2-3*\\x+1');
    expect(exprToPgf(parseExpr('sin(2x)'))).toBe('sin(2*\\x r)');
    expect(exprToPgf(parseExpr('x-(x+1)'))).toBe('\\x-(\\x+1)');
    expect(exprToPgf(parseExpr('(x+1)/(x-1)'))).toBe('(\\x+1)/(\\x-1)');
    expect(exprToPgf(parseExpr('-x^2'))).toBe('-(\\x^2)');
    expect(exprToPgf(parseExpr('e^x'))).toBe('e^\\x');
  });
});

describe('functionPieces', () => {
  it('splits 1/x at zero', () => {
    const pieces = functionPieces(parseExpr('1/x'), -5, 5, -4, 4);
    expect(pieces.length).toBe(2);
    expect(pieces[0]![1]).toBeLessThan(0);
    expect(pieces[1]![0]).toBeGreaterThan(0);
  });
  it('keeps sqrt to its domain', () => {
    const pieces = functionPieces(parseExpr('sqrt(x)'), -5, 5, -4, 4);
    expect(pieces).toEqual([[0, 5]]);
  });
});

describe('drawingToTikz', () => {
  it('writes a picture with axes, shapes and a graph', () => {
    const tikz = drawingToTikz({
      ...EMPTY_DRAWING,
      shapes: [
        { kind: 'point', at: { x: 1, y: 2 }, label: 'A', style: { color: 'black' } },
        { kind: 'segment', from: { x: 0, y: 0 }, to: { x: 1, y: 2 }, arrow: true, style: { color: 'red' } },
        { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1.5 }], closed: true, style: { color: 'blue', fill: true } },
        { kind: 'circle', center: { x: -2, y: -1 }, r: 1.25, style: { color: 'green', dashed: true } },
        { kind: 'function', expr: 'x^2/2', from: -5, to: 5, style: { color: 'blue' } },
      ],
    });
    expect(tikz).toContain('\\begin{tikzpicture}[scale=0.8, >=stealth');
    expect(tikz).toContain('\\fill (1,2) circle (1.6pt) node[above right] {$A$};');
    expect(tikz).toContain('\\draw[->, red!75!black] (0,0) -- (1,2);');
    expect(tikz).toContain('\\draw[blue!70!black, fill=blue!15] (0,0) -- (2,0) -- (1,1.5) -- cycle;');
    expect(tikz).toContain('\\draw[green!50!black, dashed] (-2,-1) circle (1.25);');
    expect(tikz).toContain('plot (\\x, {\\x^2/2});');
    expect(tikz).toContain('\\clip (-5,-4) rectangle (5,4);');
    expect(tikz.trim().endsWith('\\end{tikzpicture}')).toBe(true);
  });
});

describe('drawings in the source', () => {
  it('finds a drawing around the cursor and reads it back', () => {
    const d = { ...EMPTY_DRAWING, shapes: [{ kind: 'point' as const, at: { x: 1, y: 1 }, label: 'A', style: { color: 'red' as const } }] };
    const before = 'Matn\n\\begin{center}\n';
    const text = `${before}${drawingSource(d)}\n\\end{center}\nKeyin`;
    const inside = text.indexOf('circle');
    const found = findDrawing(text, inside);
    expect(found?.drawing).toEqual(d);
    expect(found?.from).toBe(before.length);
    expect(text.slice(found!.from, found!.to)).toBe(drawingSource(d));
    expect(findDrawing(text, 2)).toBeNull();
    expect(findDrawing(text, text.length - 2)).toBeNull();
  });
  it('ignores broken comments', () => {
    expect(findDrawing('% oversells-drawing: {oops\n\\begin{tikzpicture}\\end{tikzpicture}', 30)).toBeNull();
    expect(normalizeDrawing({ shapes: [{ kind: 'bad' }], xmin: 1, xmax: 0 })).toBeNull();
  });
});
