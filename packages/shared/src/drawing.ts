/**
 * Drawings made with the mouse ("Chizish") and their TikZ code.
 *
 * Coordinates are in drawing units (1 unit = 1 cm before `scale`), y up.
 * Function graphs are written as TikZ plots of a pgfmath expression, split
 * into the pieces where the function is defined and stays near the picture
 * (so 1/x or tan x have no vertical lines), and clipped to the picture.
 */

// --- expressions ------------------------------------------------------------------------

export type Expr =
  | { t: 'num'; v: number }
  | { t: 'x' }
  | { t: 'const'; name: 'pi' | 'e' }
  | { t: 'neg'; a: Expr }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Expr; b: Expr }
  | { t: 'fn'; name: FnName; a: Expr };

const FNS = ['sin', 'cos', 'tan', 'cot', 'sqrt', 'abs', 'ln', 'log', 'exp'] as const;
type FnName = (typeof FNS)[number];

/**
 * Parses what a teacher types for y = f(x): 2x^2 - 3x + 1, sin(2x), sqrt(x+1),
 * 1/x, |x|, e^x, x³. Implicit multiplication (2x, 3(x+1), 2sin x) is allowed;
 * a function without brackets takes the next factor (sin 2x = sin(2x)).
 */
export function parseExpr(input: string): Expr {
  const src = input
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[·×]/g, '*')
    .replace(/[−–]/g, '-')
    .replace(/÷/g, '/')
    .replace(/π/g, 'pi')
    .replace(/√/g, 'sqrt')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/,/g, '.')
    .replace(/^\s*y\s*=/, '');
  let i = 0;
  const peek = () => {
    while (src[i] === ' ') i++;
    return src[i];
  };
  const fail = (): never => {
    throw new Error(`Cannot read the expression at position ${i + 1}`);
  };
  const expect = (c: string) => {
    if (peek() !== c) fail();
    i++;
  };

  const sum = (): Expr => {
    let a = product();
    for (let c = peek(); c === '+' || c === '-'; c = peek()) {
      i++;
      a = { t: 'bin', op: c, a, b: product() };
    }
    return a;
  };
  // Inside |...| a bar closes the absolute value instead of starting one (2|x| is 2*|x|).
  let bars = 0;
  const startsFactor = (c: string | undefined) => !!c && (/[0-9.a-z(]/.test(c) || (c === '|' && bars === 0));
  const product = (): Expr => {
    let a = unary();
    for (;;) {
      const c = peek();
      if (c === '*' || c === '/') {
        i++;
        a = { t: 'bin', op: c, a, b: unary() };
      } else if (startsFactor(c)) {
        a = { t: 'bin', op: '*', a, b: power() };
      } else return a;
    }
  };
  const unary = (): Expr => {
    if (peek() === '-') {
      i++;
      return { t: 'neg', a: unary() };
    }
    if (peek() === '+') {
      i++;
      return unary();
    }
    return power();
  };
  const power = (): Expr => {
    const a = atom();
    if (peek() === '^') {
      i++;
      // Right associative, and -x in an exponent: e^-x.
      return { t: 'bin', op: '^', a, b: peek() === '-' ? (i++, { t: 'neg', a: power() }) : power() };
    }
    return a;
  };
  const atom = (): Expr => {
    const c = peek();
    if (c === undefined) return fail();
    if (c === '(') {
      i++;
      const e = sum();
      expect(')');
      return e;
    }
    if (c === '|') {
      i++;
      bars++;
      const e = sum();
      bars--;
      expect('|');
      return { t: 'fn', name: 'abs', a: e };
    }
    const num = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
    if (num) {
      i += num[0].length;
      return { t: 'num', v: Number(num[0]) };
    }
    const word = /^[a-z]+/.exec(src.slice(i))?.[0];
    if (!word) return fail();
    const fn = FNS.find((f) => word.startsWith(f));
    if (fn) {
      i += fn.length;
      // sin^2 x is not supported; sin x, sin(x), sin 2x are.
      return { t: 'fn', name: fn, a: peek() === '(' ? atom() : product() };
    }
    if (word.startsWith('pi')) {
      i += 2;
      return { t: 'const', name: 'pi' };
    }
    if (word[0] === 'x') {
      i++;
      return { t: 'x' };
    }
    if (word[0] === 'e') {
      i++;
      return { t: 'const', name: 'e' };
    }
    return fail();
  };

  const e = sum();
  if (peek() !== undefined) fail();
  return e;
}

export function evalExpr(e: Expr, x: number): number {
  switch (e.t) {
    case 'num':
      return e.v;
    case 'x':
      return x;
    case 'const':
      return e.name === 'pi' ? Math.PI : Math.E;
    case 'neg':
      return -evalExpr(e.a, x);
    case 'bin': {
      const a = evalExpr(e.a, x);
      const b = evalExpr(e.b, x);
      if (e.op === '+') return a + b;
      if (e.op === '-') return a - b;
      if (e.op === '*') return a * b;
      if (e.op === '/') return b === 0 ? NaN : a / b;
      // Odd roots of negatives: x^(1/3).
      if (a < 0 && !Number.isInteger(b)) {
        const inv = 1 / b;
        return Number.isInteger(Math.round(inv)) && Math.abs(inv - Math.round(inv)) < 1e-9 && Math.round(inv) % 2 !== 0
          ? -Math.pow(-a, b)
          : NaN;
      }
      return Math.pow(a, b);
    }
    case 'fn': {
      const a = evalExpr(e.a, x);
      switch (e.name) {
        case 'sin':
          return Math.sin(a);
        case 'cos':
          return Math.cos(a);
        case 'tan':
          return Math.tan(a);
        case 'cot':
          return 1 / Math.tan(a);
        case 'sqrt':
          return a < 0 ? NaN : Math.sqrt(a);
        case 'abs':
          return Math.abs(a);
        case 'ln':
          return a <= 0 ? NaN : Math.log(a);
        case 'log':
          return a <= 0 ? NaN : Math.log10(a);
        case 'exp':
          return Math.exp(a);
      }
    }
  }
}

/** pgfmath for TikZ's plot (\x is the variable; trigonometry in radians). */
export function exprToPgf(e: Expr): string {
  const wrap = (s: string) => `(${s})`;
  switch (e.t) {
    case 'num':
      return String(e.v);
    case 'x':
      return '\\x';
    case 'const':
      return e.name === 'pi' ? 'pi' : 'e';
    case 'neg':
      return `-${wrap(exprToPgf(e.a))}`;
    case 'bin': {
      const a = exprToPgf(e.a);
      const b = exprToPgf(e.b);
      const atomic = (x: Expr) => x.t === 'num' || x.t === 'x' || x.t === 'const' || x.t === 'fn';
      const sumLike = (x: Expr) => x.t === 'neg' || (x.t === 'bin' && (x.op === '+' || x.op === '-'));
      if (e.op === '+') return `${a}+${e.b.t === 'neg' ? wrap(b) : b}`;
      if (e.op === '-') return `${a}-${sumLike(e.b) ? wrap(b) : b}`;
      if (e.op === '*') return `${sumLike(e.a) ? wrap(a) : a}*${sumLike(e.b) ? wrap(b) : b}`;
      if (e.op === '/') return `${sumLike(e.a) ? wrap(a) : a}/${atomic(e.b) ? b : wrap(b)}`;
      const l = atomic(e.a) ? a : wrap(a);
      const r = atomic(e.b) ? b : wrap(b);
      // pgfmath's ^ fails for a negative base with a fractional exponent: x^(1/3).
      if (e.a.t !== 'const' && !(e.b.t === 'num' && Number.isInteger(e.b.v))) return `sign(${a})*abs(${a})^${r}`;
      return `${l}^${r}`;
    }
    case 'fn': {
      const a = exprToPgf(e.a);
      switch (e.name) {
        case 'sin':
        case 'cos':
        case 'tan':
        case 'cot':
          return `${e.name}(${a} r)`;
        case 'log':
          return `log10(${a})`;
        default:
          return `${e.name}(${a})`;
      }
    }
  }
}

// --- drawings -------------------------------------------------------------------------

export type Pt = { x: number; y: number };
export type DrawColor = 'black' | 'blue' | 'red' | 'green' | 'orange';
export interface DrawStyle {
  color: DrawColor;
  dashed?: boolean;
  thick?: boolean;
  fill?: boolean;
}

export type Shape =
  | { kind: 'point'; at: Pt; label?: string; style: DrawStyle }
  | { kind: 'segment'; from: Pt; to: Pt; arrow?: boolean; style: DrawStyle }
  | { kind: 'polygon'; points: Pt[]; closed: boolean; style: DrawStyle }
  | { kind: 'circle'; center: Pt; r: number; style: DrawStyle }
  | { kind: 'rect'; from: Pt; to: Pt; style: DrawStyle }
  | { kind: 'text'; at: Pt; text: string; style: DrawStyle }
  | { kind: 'function'; expr: string; from: number; to: number; style: DrawStyle };

export interface Drawing {
  /** The visible area in units. */
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  axes: boolean;
  grid: boolean;
  /** Size of a unit in cm. */
  scale: number;
  shapes: Shape[];
}

/** TikZ colours (xcolor is loaded by tikz). */
export const DRAW_COLORS: Record<DrawColor, { tikz: string; css: string }> = {
  black: { tikz: 'black', css: '#222' },
  blue: { tikz: 'blue!70!black', css: '#1f4fb3' },
  red: { tikz: 'red!75!black', css: '#c0262b' },
  green: { tikz: 'green!50!black', css: '#1c7f2a' },
  orange: { tikz: 'orange!90!black', css: '#e07400' },
};

const n = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
};
const p = (pt: Pt) => `(${n(pt.x)},${n(pt.y)})`;

function opts(s: DrawStyle, extra: string[] = [], fill = false): string {
  const c = DRAW_COLORS[s.color].tikz;
  const o = [...extra, c === 'black' ? '' : c, s.thick ? 'thick' : '', s.dashed ? 'dashed' : '', fill && s.fill ? `fill=${s.color === 'black' ? 'gray' : s.color}!15` : ''].filter(Boolean);
  return o.length ? `[${o.join(', ')}]` : '';
}

/** Point labels: a name (A, B1, P') in maths, anything else as typed. */
function labelText(s: string): string {
  return /^[A-Za-z]\d*'*$/.test(s) ? `$${s}$` : s;
}

/** The pieces of [from, to] where the function is defined and near the picture. */
export function functionPieces(e: Expr, from: number, to: number, ymin: number, ymax: number, samples = 400): Array<[number, number]> {
  const pieces: Array<[number, number]> = [];
  const span = ymax - ymin;
  const ok = (y: number) => Number.isFinite(y) && y > ymin - span && y < ymax + span;
  let start: number | null = null;
  let prev = from;
  let prevY = NaN;
  for (let k = 0; k <= samples; k++) {
    const x = from + ((to - from) * k) / samples;
    const y = evalExpr(e, x);
    // A jump across the picture (1/x at 0, tan at pi/2) also ends a piece.
    const jump = start !== null && Math.abs(y - prevY) > span;
    if (ok(y) && !jump) {
      if (start === null) start = x;
    } else {
      if (start !== null && prev > start) pieces.push([start, prev]);
      start = ok(y) ? x : null;
    }
    prev = x;
    prevY = y;
  }
  if (start !== null && prev > start) pieces.push([start, prev]);
  return pieces;
}

/** The tikzpicture of a drawing. Throws on a function that cannot be read. */
export function drawingToTikz(d: Drawing): string {
  const out: string[] = [];
  const sc = n(d.scale);
  out.push(`\\begin{tikzpicture}[${sc === '1' ? '' : `scale=${sc}, `}>=stealth, line cap=round, line join=round]`);
  const lo = { x: d.xmin, y: d.ymin };
  const hi = { x: d.xmax, y: d.ymax };
  if (d.grid) out.push(`  \\draw[gray!25, very thin] ${p(lo)} grid ${p(hi)};`);
  if (d.axes) {
    out.push(`  \\draw[->] (${n(d.xmin)},0) -- (${n(d.xmax)},0) node[below left] {$x$};`);
    out.push(`  \\draw[->] (0,${n(d.ymin)}) -- (0,${n(d.ymax)}) node[below left] {$y$};`);
    out.push(`  \\node[below left] at (0,0) {$O$};`);
    const ticks = (a: number, b: number) => {
      const r: number[] = [];
      for (let v = Math.ceil(a); v <= Math.floor(b) - 1; v++) if (v !== 0) r.push(v);
      return r.join(',');
    };
    const tx = ticks(d.xmin, d.xmax);
    const ty = ticks(d.ymin, d.ymax);
    if (tx) out.push(`  \\foreach \\t in {${tx}} \\draw (\\t,2pt) -- (\\t,-2pt) node[below, font=\\scriptsize] {$\\t$};`);
    if (ty) out.push(`  \\foreach \\t in {${ty}} \\draw (2pt,\\t) -- (-2pt,\\t) node[left, font=\\scriptsize] {$\\t$};`);
  }
  for (const s of d.shapes) {
    switch (s.kind) {
      case 'point': {
        const c = DRAW_COLORS[s.style.color].tikz;
        out.push(`  \\fill${c === 'black' ? '' : `[${c}]`} ${p(s.at)} circle (1.6pt)${s.label ? ` node[above right] {${labelText(s.label)}}` : ''};`);
        break;
      }
      case 'segment':
        out.push(`  \\draw${opts(s.style, s.arrow ? ['->'] : [])} ${p(s.from)} -- ${p(s.to)};`);
        break;
      case 'polygon':
        if (s.points.length < 2) break;
        out.push(`  \\draw${opts(s.style, [], s.closed)} ${s.points.map(p).join(' -- ')}${s.closed ? ' -- cycle' : ''};`);
        break;
      case 'circle':
        out.push(`  \\draw${opts(s.style, [], true)} ${p(s.center)} circle (${n(s.r)});`);
        break;
      case 'rect':
        out.push(`  \\draw${opts(s.style, [], true)} ${p(s.from)} rectangle ${p(s.to)};`);
        break;
      case 'text': {
        const c = DRAW_COLORS[s.style.color].tikz;
        out.push(`  \\node${c === 'black' ? '' : `[${c}]`} at ${p(s.at)} {${s.text}};`);
        break;
      }
      case 'function': {
        const e = parseExpr(s.expr);
        const pieces = functionPieces(e, s.from, s.to, d.ymin, d.ymax);
        if (pieces.length === 0) break;
        out.push(`  \\begin{scope}`);
        out.push(`    \\clip ${p(lo)} rectangle ${p(hi)};`);
        const style = opts({ ...s.style, thick: s.style.thick ?? true }, ['smooth', 'samples=150']).slice(1, -1);
        for (const [a, b] of pieces) {
          out.push(`    \\draw[${style}, domain=${n(a)}:${n(b)}] plot (\\x, {${exprToPgf(e)}});`);
        }
        out.push(`  \\end{scope}`);
        break;
      }
    }
  }
  out.push('\\end{tikzpicture}');
  return out.join('\n');
}

export const EMPTY_DRAWING: Drawing = { xmin: -5, xmax: 5, ymin: -4, ymax: 4, axes: true, grid: true, scale: 0.8, shapes: [] };

// --- drawings in the source -------------------------------------------------------------

/** The comment line that keeps a drawing editable: it precedes its tikzpicture. */
const MARK = '% oversells-drawing: ';
const END = '\\end{tikzpicture}';

/** The comment line and the tikzpicture of a drawing. */
export function drawingSource(d: Drawing): string {
  return `${MARK}${JSON.stringify(d)}\n${drawingToTikz(d)}`;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** A drawing read back from its comment, with defaults for anything odd; null if it is not one. */
export function normalizeDrawing(raw: unknown): Drawing | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Drawing>;
  if (!Array.isArray(r.shapes)) return null;
  const d: Drawing = {
    xmin: num(r.xmin, EMPTY_DRAWING.xmin),
    xmax: num(r.xmax, EMPTY_DRAWING.xmax),
    ymin: num(r.ymin, EMPTY_DRAWING.ymin),
    ymax: num(r.ymax, EMPTY_DRAWING.ymax),
    axes: r.axes !== false,
    grid: r.grid !== false,
    scale: num(r.scale, EMPTY_DRAWING.scale),
    shapes: r.shapes.filter(
      (s): s is Shape =>
        !!s && typeof s === 'object' && ['point', 'segment', 'polygon', 'circle', 'rect', 'text', 'function'].includes((s as Shape).kind) && !!(s as Shape).style && (s as Shape).style.color in DRAW_COLORS,
    ),
  };
  if (d.xmax <= d.xmin || d.ymax <= d.ymin) return null;
  return d;
}

/** The drawing whose tikzpicture contains `pos` (or whose comment line does), with its range. */
export function findDrawing(text: string, pos: number): { from: number; to: number; drawing: Drawing } | null {
  const lineEnd = text.indexOf('\n', pos);
  const at = text.lastIndexOf(MARK, lineEnd === -1 ? text.length : lineEnd);
  if (at === -1) return null;
  const from = text.lastIndexOf('\n', at) + 1;
  if (text.slice(from, at).trim() !== '') return null;
  const jsonEnd = text.indexOf('\n', at);
  const end = text.indexOf(END, at);
  if (jsonEnd === -1 || end === -1 || end < jsonEnd) return null;
  const to = end + END.length;
  if (pos > to) return null;
  try {
    const drawing = normalizeDrawing(JSON.parse(text.slice(at + MARK.length, jsonEnd)));
    return drawing ? { from, to, drawing } : null;
  } catch {
    return null;
  }
}
