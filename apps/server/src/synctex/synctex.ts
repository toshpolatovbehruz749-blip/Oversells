import { gunzipSync } from 'node:zlib';

/**
 * Parser and queries for SyncTeX files (`*.synctex.gz`), the map between the
 * PDF and the TeX sources produced by `-synctex=1`.
 *
 * Coordinates in the file are in TeX scaled points (sp) relative to the TeX
 * origin; we convert them to PDF big points (bp) measured from the top-left
 * corner of the page, the same space PDF.js uses at scale 1:
 *   bp = (sp_value * unit * magnification / 1000 + offset) / 65781.76
 * Results were checked against the `synctex` command line tool (see tests).
 */

const SP_PER_BP = 65781.76;

/** One positioned node: a box, a kern, glue, math or a "current point". */
export interface SyncRecord {
  type: string;
  tag: number;
  line: number;
  page: number;
  /** Position (bp from the top-left corner of the page); y is the baseline. */
  x: number;
  y: number;
  /** Width, height above and depth below the baseline (boxes only). */
  w: number;
  h: number;
  d: number;
  /** Index of the enclosing box record, or -1. */
  parent: number;
}

export interface SyncBox {
  /** Left, top (bp from the top-left corner), width and height. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ForwardResult {
  page: number;
  /** A point to scroll to (start of the first matching record). */
  x: number;
  y: number;
  boxes: SyncBox[];
}

export interface ReverseResult {
  /** Project-relative path of the source file. */
  file: string;
  line: number;
}

const BOX_OPEN = new Set(['[', '(']);
const BOX_CLOSE = new Set([']', ')']);
const WITH_SIZE = new Set(['[', '(', 'h', 'v']);
const OPEN_HBOX = '('.charCodeAt(0);
const H_BOX = 'h'.charCodeAt(0);
const RECORD_RE = /^.(\d+),(\d+)(?:,-?\d+)?:(-?\d+),(-?\d+)(?::(-?\d+)(?:,(-?\d+),(-?\d+))?)?/;

/** Maps a path from the compile container to a project path (null for system files). */
export function projectPathOf(input: string): string | null {
  // Generated files (.aux, .out, .bbl, ...) are not sources the user can open.
  if (!/\.(tex|ltx|sty|cls|tikz|dtx)$/i.test(input)) return null;
  let p = input;
  if (p.startsWith('/work/')) p = p.slice('/work/'.length);
  else if (p.startsWith('/')) return null;
  while (p.startsWith('./')) p = p.slice(2);
  return p;
}

/**
 * Boxes that overlap vertically or nearly touch (a heading's number box,
 * text and rule; consecutive lines) become one highlight.
 */
export function mergeTouching(boxes: SyncBox[], gap = 3): SyncBox[] {
  const sorted = [...boxes].sort((a, b) => a.y - b.y);
  const out: SyncBox[] = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && b.y <= last.y + last.h + gap) {
      const x = Math.min(last.x, b.x);
      const y = Math.min(last.y, b.y);
      last.w = Math.max(last.x + last.w, b.x + b.w) - x;
      last.h = Math.max(last.y + last.h, b.y + b.h) - y;
      last.x = x;
      last.y = y;
    } else out.push({ ...b });
  }
  return out;
}

/** Growable column of numbers. */
class Column<T extends Float64Array | Int32Array | Uint8Array> {
  data: T;
  constructor(private readonly make: (n: number) => T) {
    this.data = make(1 << 14);
  }
  set(i: number, v: number) {
    if (i >= this.data.length) {
      const bigger = this.make(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    this.data[i] = v;
  }
  trim(n: number) {
    this.data = this.data.slice(0, n) as T;
  }
}

/**
 * Parsed SyncTeX data. Records are kept in typed arrays (a 1000-page book has
 * hundreds of thousands of them) in document order, so the records of a page
 * are one contiguous range; an index by input tag serves forward search.
 */
export class SyncTex {
  /** tag -> project path (system files are left out). */
  readonly inputs = new Map<number, string>();
  pageCount = 0;
  /** Number of records. */
  size = 0;

  private type = new Column((n) => new Uint8Array(n));
  private tag = new Column((n) => new Int32Array(n));
  private line = new Column((n) => new Int32Array(n));
  private page = new Column((n) => new Int32Array(n));
  private parent = new Column((n) => new Int32Array(n));
  private x = new Column((n) => new Float64Array(n));
  private y = new Column((n) => new Float64Array(n));
  private w = new Column((n) => new Float64Array(n));
  private h = new Column((n) => new Float64Array(n));
  private d = new Column((n) => new Float64Array(n));
  /** [first, end) record index of each page (index = page number). */
  private pageStart: number[] = [];
  private pageEnd: number[] = [];
  private byTag = new Map<number, number[]>();

  static fromGzip(data: Buffer): SyncTex {
    return SyncTex.parseBuffer(gunzipSync(data));
  }

  static parse(text: string): SyncTex {
    return SyncTex.parseBuffer(Buffer.from(text, 'utf8'));
  }

  /** Approximate memory use in bytes (for caching). */
  get bytes(): number {
    return this.size * 57 + 64 * 1024;
  }

  /** One record as an object. */
  record(i: number): SyncRecord {
    return {
      type: String.fromCharCode(this.type.data[i]!),
      tag: this.tag.data[i]!,
      line: this.line.data[i]!,
      page: this.page.data[i]!,
      x: this.x.data[i]!,
      y: this.y.data[i]!,
      w: this.w.data[i]!,
      h: this.h.data[i]!,
      d: this.d.data[i]!,
      parent: this.parent.data[i]!,
    };
  }

  private static parseBuffer(buf: Buffer): SyncTex {
    const s = new SyncTex();
    let unit = 1;
    let magnification = 1000;
    let xOffset = 0;
    let yOffset = 0;
    let page = 0;
    const stack: number[] = [];
    let inContent = false;

    const toBp = (v: number) => (v * unit * magnification) / 1000 / SP_PER_BP;
    const addInput = (value: string) => {
      const sep = value.indexOf(':');
      const path = projectPathOf(value.slice(sep + 1));
      if (path !== null) s.inputs.set(Number(value.slice(0, sep)), path);
    };

    let pos = 0;
    while (pos < buf.length) {
      let end = buf.indexOf(10, pos);
      if (end === -1) end = buf.length;
      const lineStart = pos;
      pos = end + 1;
      if (end === lineStart) continue;
      const first = buf[lineStart]!;
      // Inputs and preamble lines may hold UTF-8 paths; content lines are ASCII.
      if (!inContent || first === 73 /* I */) {
        const line = buf.toString('utf8', lineStart, end).trimEnd();
        const colon = line.indexOf(':');
        const key = line.slice(0, colon);
        const value = line.slice(colon + 1);
        if (key === 'Input') addInput(value);
        else if (inContent) continue;
        else if (key === 'Unit') unit = Number(value);
        else if (key === 'Magnification') magnification = Number(value) || 1000;
        else if (key === 'X Offset') xOffset = Number(value);
        else if (key === 'Y Offset') yOffset = Number(value);
        else if (key === 'Content') inContent = true;
        continue;
      }
      const type = String.fromCharCode(first);
      if (type === '{') {
        page = Number(buf.toString('latin1', lineStart + 1, end));
        s.pageCount = Math.max(s.pageCount, page);
        s.pageStart[page] = s.size;
        s.pageEnd[page] = s.size;
        stack.length = 0;
        continue;
      }
      if (type === '}' || type === '!' || type === 'P') continue; // page end, byte offsets, postamble
      if (BOX_CLOSE.has(type)) {
        stack.pop();
        continue;
      }
      // <type><tag>,<line>[,<column>]:<x>,<y>[:<W>,<H>,<D>]   (k has :<W> only)
      const m = RECORD_RE.exec(buf.toString('latin1', lineStart, end));
      if (!m) continue;
      const i = s.size++;
      const tag = Number(m[1]);
      s.type.set(i, first);
      s.tag.set(i, tag);
      s.line.set(i, Number(m[2]));
      s.page.set(i, page);
      s.x.set(i, (Number(m[3]) * unit * magnification) / 1000 / SP_PER_BP + xOffset / SP_PER_BP);
      s.y.set(i, (Number(m[4]) * unit * magnification) / 1000 / SP_PER_BP + yOffset / SP_PER_BP);
      s.w.set(i, m[5] !== undefined ? toBp(Number(m[5])) : 0);
      s.h.set(i, m[6] !== undefined && WITH_SIZE.has(type) ? toBp(Number(m[6])) : 0);
      s.d.set(i, m[7] !== undefined && WITH_SIZE.has(type) ? toBp(Number(m[7])) : 0);
      s.parent.set(i, stack.length ? stack[stack.length - 1]! : -1);
      if (page > 0) s.pageEnd[page] = s.size;
      if (BOX_OPEN.has(type)) stack.push(i);
      let list = s.byTag.get(tag);
      if (!list) s.byTag.set(tag, (list = []));
      list.push(i);
    }
    for (const c of [s.type, s.tag, s.line, s.page, s.parent, s.x, s.y, s.w, s.h, s.d]) c.trim(s.size);
    return s;
  }

  private tagsOf(file: string): number[] {
    const tags: number[] = [];
    for (const [tag, path] of this.inputs) if (path === file) tags.push(tag);
    return tags;
  }

  /** [first, end) record range of a page. */
  private rangeOf(page: number): [number, number] {
    return [this.pageStart[page] ?? 0, this.pageEnd[page] ?? 0];
  }

  /**
   * Source -> PDF: where does `line` of `file` appear? Lines without
   * records (blank lines, comments) use the next line that has some.
   */
  forward(file: string, line: number): ForwardResult | null {
    const inFile: number[] = [];
    for (const tag of this.tagsOf(file)) {
      for (const i of this.byTag.get(tag) ?? []) if (this.page.data[i]! > 0) inFile.push(i);
    }
    if (inFile.length === 0) return null;
    const L = this.line.data;
    let target = line;
    let exact = false;
    let later = Infinity;
    let earlier = -Infinity;
    for (const i of inFile) {
      const l = L[i]!;
      if (l === line) exact = true;
      else if (l > line) later = Math.min(later, l);
      else earlier = Math.max(earlier, l);
    }
    if (!exact) target = later !== Infinity ? later : earlier;
    const matches = inFile.filter((i) => L[i] === target);
    let page = Infinity;
    for (const i of matches) page = Math.min(page, this.page.data[i]!);
    const onPage = matches.filter((i) => this.page.data[i] === page).sort((a, b) => a - b);

    const boxes: SyncBox[] = [];
    const seen = new Set<string>();
    for (const i of onPage) {
      const r = this.record(i);
      if (!(r.type === '(' || r.type === 'h') || r.w <= 0 || r.h + r.d <= 0) continue;
      const box = { x: r.x, y: r.y - r.h, w: r.w, h: r.h + r.d };
      const key = `${box.x.toFixed(1)},${box.y.toFixed(1)},${box.w.toFixed(1)},${box.h.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      boxes.push(box);
    }
    // Keep whole lines: drop boxes that lie inside another matching box
    // (e.g. the number inside a section title line).
    const inside = (o: SyncBox, b: SyncBox) =>
      o !== b && o.x >= b.x - 0.01 && o.y >= b.y - 0.01 && o.x + o.w <= b.x + b.w + 0.01 && o.y + o.h <= b.y + b.h + 0.01;
    const tight = boxes.filter((b) => !boxes.some((o) => inside(b, o) && (o.w > b.w || o.h > b.h)));
    const first = this.record(onPage[0]!);
    if (tight.length === 0) {
      // No box of its own (e.g. a line in the middle of a paragraph): use the
      // line boxes that contain its nodes.
      const parents = new Set<number>();
      for (const i of onPage) {
        let p = this.parent.data[i]!;
        while (p !== -1 && !(this.type.data[p] === OPEN_HBOX && this.w.data[p]! > 0)) p = this.parent.data[p]!;
        if (p !== -1) parents.add(p);
      }
      for (const p of parents) {
        const r = this.record(p);
        tight.push({ x: r.x, y: r.y - r.h, w: r.w, h: Math.max(r.h + r.d, 1) });
      }
      if (tight.length === 0) tight.push({ x: first.x, y: first.y - 10, w: 20, h: 12 });
    }
    const merged = mergeTouching(tight);
    return { page, x: first.x, y: merged.reduce((m, b) => Math.min(m, b.y), Infinity), boxes: merged.slice(0, 50) };
  }

  private area(index: number): number {
    if (index < 0) return Infinity;
    return this.w.data[index]! * (this.h.data[index]! + this.d.data[index]!);
  }

  /** Distance from the point to a record's box; the line matters more than the column. */
  private distance(i: number, x: number, y: number): number {
    const rx = this.x.data[i]!;
    const rw = this.w.data[i]!;
    const top = this.y.data[i]! - this.h.data[i]!;
    const bottom = this.y.data[i]! + this.d.data[i]!;
    const dx = x < rx ? rx - x : x > rx + rw ? x - (rx + rw) : 0;
    const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
    return dy * 4 + dx;
  }

  /** PDF -> source: which file and line produced the point (x, y) on `page`? */
  reverse(page: number, x: number, y: number): ReverseResult | null {
    const [from, to] = this.rangeOf(page);
    const known = (i: number) => this.inputs.has(this.tag.data[i]!);
    const isLineBox = (i: number) => this.type.data[i] === OPEN_HBOX && known(i);
    let any = false;
    for (let i = from; i < to && !any; i++) any = known(i);
    if (!any) return null;

    // Innermost horizontal box that contains the point.
    let best: { index: number; area: number } | null = null;
    for (let i = from; i < to; i++) {
      if (!isLineBox(i)) continue;
      const r = this.record(i);
      if (x >= r.x && x <= r.x + r.w && y >= r.y - r.h && y <= r.y + r.d) {
        const area = r.w * (r.h + r.d);
        if (!best || area < best.area) best = { index: i, area };
      }
    }

    if (!best) {
      // Between lines: start from the nearest line box instead.
      let nearestBox = -1;
      let nearestDist = Infinity;
      for (let i = from; i < to; i++) {
        if (!isLineBox(i) || this.w.data[i]! <= 0 || this.h.data[i]! + this.d.data[i]! <= 0) continue;
        const d = this.distance(i, x, y);
        if (d < nearestDist || (d === nearestDist && this.area(i) < this.area(nearestBox))) {
          nearestDist = d;
          nearestBox = i;
        }
      }
      if (nearestBox !== -1) best = { index: nearestBox, area: this.area(nearestBox) };
    }

    if (best) {
      const descendantsOf = (index: number) => {
        const out: number[] = [];
        const isInside = (i: number) => {
          let p = this.parent.data[i]!;
          while (p !== -1 && p !== index) p = this.parent.data[p]!;
          return p === index;
        };
        // Descendants follow the box contiguously in document order.
        for (let i = index + 1; i < to && isInside(i); i++) out.push(i);
        return out;
      };
      let box = best.index;
      // A box that holds other line boxes is a container (page body, paragraph):
      // go to the line box nearest to the point instead.
      for (let depth = 0; depth < 20; depth++) {
        const inner = descendantsOf(box).filter((i) => {
          const t = this.type.data[i];
          return (t === OPEN_HBOX || t === H_BOX) && this.w.data[i]! > 0 && this.h.data[i]! + this.d.data[i]! > 0 && known(i);
        });
        if (inner.length === 0) break;
        const next = inner.reduce((a, b) => (this.distance(b, x, y) < this.distance(a, x, y) ? b : a));
        if (next === box) break;
        box = next;
      }
      // Within the line, the node just left of the click names the line most precisely.
      const nodes = descendantsOf(box).filter(known);
      let left = -1;
      for (const i of nodes) if (this.x.data[i]! <= x && (left === -1 || this.x.data[i]! > this.x.data[left]!)) left = i;
      const pick = left !== -1 ? left : (nodes[0] ?? box);
      return { file: this.inputs.get(this.tag.data[pick]!)!, line: this.line.data[pick]! };
    }

    // Otherwise the nearest node on the page.
    let nearest = -1;
    let dist = Infinity;
    for (let i = from; i < to; i++) {
      if (!known(i)) continue;
      const r = this.record(i);
      const top = r.y - r.h;
      const bottom = r.y + r.d;
      const dx = x < r.x ? r.x - x : x > r.x + r.w ? x - (r.x + r.w) : 0;
      const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
      const d = Math.hypot(dx, dy);
      if (d < dist) {
        dist = d;
        nearest = i;
      }
    }
    return nearest !== -1 ? { file: this.inputs.get(this.tag.data[nearest]!)!, line: this.line.data[nearest]! } : null;
  }
}
