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

export class SyncTex {
  /** tag -> project path (system files are left out). */
  readonly inputs = new Map<number, string>();
  readonly records: SyncRecord[] = [];
  pageCount = 0;

  static fromGzip(data: Buffer): SyncTex {
    return SyncTex.parse(gunzipSync(data).toString('utf8'));
  }

  static parse(text: string): SyncTex {
    const s = new SyncTex();
    let unit = 1;
    let magnification = 1000;
    let xOffset = 0;
    let yOffset = 0;
    let page = 0;
    const stack: number[] = [];
    let inContent = false;

    const toBp = (v: number) => (v * unit * magnification) / 1000 / SP_PER_BP;

    for (const raw of text.split('\n')) {
      const line = raw.trimEnd();
      if (!line) continue;
      if (!inContent) {
        const colon = line.indexOf(':');
        const key = line.slice(0, colon);
        const value = line.slice(colon + 1);
        if (key === 'Input') {
          const sep = value.indexOf(':');
          const path = projectPathOf(value.slice(sep + 1));
          if (path !== null) s.inputs.set(Number(value.slice(0, sep)), path);
        } else if (key === 'Unit') unit = Number(value);
        else if (key === 'Magnification') magnification = Number(value) || 1000;
        else if (key === 'X Offset') xOffset = Number(value);
        else if (key === 'Y Offset') yOffset = Number(value);
        else if (key === 'Content') inContent = true;
        continue;
      }
      const type = line[0]!;
      if (type === '{') {
        page = Number(line.slice(1));
        s.pageCount = Math.max(s.pageCount, page);
        stack.length = 0;
        continue;
      }
      if (type === '}') continue;
      if (BOX_CLOSE.has(type)) {
        stack.pop();
        continue;
      }
      if (type === '!' || line.startsWith('Postamble') || line.startsWith('Input:')) {
        // Byte offsets, trailer, or inputs declared late (\input inside the document).
        if (line.startsWith('Input:')) {
          const value = line.slice('Input:'.length);
          const sep = value.indexOf(':');
          const path = projectPathOf(value.slice(sep + 1));
          if (path !== null) s.inputs.set(Number(value.slice(0, sep)), path);
        }
        continue;
      }
      // <type><tag>,<line>[,<column>]:<x>,<y>[:<W>,<H>,<D>]   (k has :<W> only)
      const m = /^.(\d+),(\d+)(?:,-?\d+)?:(-?\d+),(-?\d+)(?::(-?\d+)(?:,(-?\d+),(-?\d+))?)?/.exec(line);
      if (!m) continue;
      const record: SyncRecord = {
        type,
        tag: Number(m[1]),
        line: Number(m[2]),
        page,
        x: (Number(m[3]) * unit * magnification) / 1000 / SP_PER_BP + xOffset / SP_PER_BP,
        y: (Number(m[4]) * unit * magnification) / 1000 / SP_PER_BP + yOffset / SP_PER_BP,
        w: m[5] !== undefined ? toBp(Number(m[5])) : 0,
        h: m[6] !== undefined && WITH_SIZE.has(type) ? toBp(Number(m[6])) : 0,
        d: m[7] !== undefined && WITH_SIZE.has(type) ? toBp(Number(m[7])) : 0,
        parent: stack.length ? stack[stack.length - 1]! : -1,
      };
      s.records.push(record);
      if (BOX_OPEN.has(type)) stack.push(s.records.length - 1);
    }
    return s;
  }

  private tagsOf(file: string): Set<number> {
    const tags = new Set<number>();
    for (const [tag, path] of this.inputs) if (path === file) tags.add(tag);
    return tags;
  }

  /**
   * Source -> PDF: where does `line` of `file` appear? Lines without
   * records (blank lines, comments) use the next line that has some.
   */
  forward(file: string, line: number): ForwardResult | null {
    const tags = this.tagsOf(file);
    if (tags.size === 0) return null;
    const inFile = this.records.filter((r) => tags.has(r.tag) && r.page > 0);
    if (inFile.length === 0) return null;
    let target = line;
    let matches = inFile.filter((r) => r.line === target);
    if (matches.length === 0) {
      const later = inFile.filter((r) => r.line > line).map((r) => r.line);
      const earlier = inFile.filter((r) => r.line < line).map((r) => r.line);
      target = later.length ? Math.min(...later) : Math.max(...earlier);
      matches = inFile.filter((r) => r.line === target);
    }
    const page = Math.min(...matches.map((r) => r.page));
    const onPage = matches.filter((r) => r.page === page);

    const boxes: SyncBox[] = [];
    const seen = new Set<string>();
    for (const r of onPage) {
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
    const first = onPage[0]!;
    if (tight.length === 0) {
      // No box of its own (e.g. a line in the middle of a paragraph): use the
      // line boxes that contain its nodes.
      const parents = new Set<number>();
      for (const r of onPage) {
        let p = r.parent;
        while (p !== -1 && !(this.records[p]!.type === '(' && this.records[p]!.w > 0)) p = this.records[p]!.parent;
        if (p !== -1) parents.add(p);
      }
      for (const p of parents) {
        const r = this.records[p]!;
        tight.push({ x: r.x, y: r.y - r.h, w: r.w, h: Math.max(r.h + r.d, 1) });
      }
      if (tight.length === 0) tight.push({ x: first.x, y: first.y - 10, w: 20, h: 12 });
    }
    const merged = mergeTouching(tight);
    return { page, x: first.x, y: Math.min(...merged.map((b) => b.y)), boxes: merged.slice(0, 50) };
  }

  private area(index: number): number {
    if (index < 0) return Infinity;
    const r = this.records[index]!;
    return r.w * (r.h + r.d);
  }

  /** PDF -> source: which file and line produced the point (x, y) on `page`? */
  reverse(page: number, x: number, y: number): ReverseResult | null {
    const onPage = this.records.filter((r) => r.page === page && this.inputs.has(r.tag));
    if (onPage.length === 0) return null;

    // Innermost horizontal box that contains the point.
    let best: { index: number; area: number } | null = null;
    for (let i = 0; i < this.records.length; i++) {
      const r = this.records[i]!;
      if (r.page !== page || r.type !== '(' || !this.inputs.has(r.tag)) continue;
      if (x >= r.x && x <= r.x + r.w && y >= r.y - r.h && y <= r.y + r.d) {
        const area = r.w * (r.h + r.d);
        if (!best || area < best.area) best = { index: i, area };
      }
    }

    if (!best) {
      // Between lines: start from the nearest line box instead.
      let nearestBox = -1;
      let nearestDist = Infinity;
      for (let i = 0; i < this.records.length; i++) {
        const r = this.records[i]!;
        if (r.page !== page || r.type !== '(' || r.w <= 0 || r.h + r.d <= 0 || !this.inputs.has(r.tag)) continue;
        const top = r.y - r.h;
        const bottom = r.y + r.d;
        const dx = x < r.x ? r.x - x : x > r.x + r.w ? x - (r.x + r.w) : 0;
        const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
        const d = dy * 4 + dx;
        if (d < nearestDist || (d === nearestDist && r.w * (r.h + r.d) < this.area(nearestBox))) {
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
          let p = this.records[i]!.parent;
          while (p !== -1 && p !== index) p = this.records[p]!.parent;
          return p === index;
        };
        // Descendants follow the box contiguously in document order.
        for (let i = index + 1; i < this.records.length && isInside(i); i++) out.push(i);
        return out;
      };
      let box = best.index;
      // A box that holds other line boxes is a container (page body, paragraph):
      // go to the line box nearest to the point instead.
      for (let depth = 0; depth < 20; depth++) {
        const inner = descendantsOf(box).filter((i) => {
          const r = this.records[i]!;
          return (r.type === '(' || r.type === 'h') && r.w > 0 && r.h + r.d > 0 && this.inputs.has(r.tag);
        });
        if (inner.length === 0) break;
        const distance = (i: number) => {
          const r = this.records[i]!;
          const top = r.y - r.h;
          const bottom = r.y + r.d;
          const dx = x < r.x ? r.x - x : x > r.x + r.w ? x - (r.x + r.w) : 0;
          const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
          return dy * 4 + dx; // the line matters more than the column
        };
        const next = inner.reduce((a, b) => (distance(b) < distance(a) ? b : a));
        if (next === box) break;
        box = next;
      }
      // Within the line, the node just left of the click names the line most precisely.
      const nodes = descendantsOf(box)
        .map((i) => this.records[i]!)
        .filter((r) => this.inputs.has(r.tag));
      const left = nodes.filter((r) => r.x <= x).sort((a, b) => b.x - a.x)[0];
      const pick = left ?? nodes[0] ?? this.records[box]!;
      return { file: this.inputs.get(pick.tag)!, line: pick.line };
    }

    // Otherwise the nearest node on the page.
    let nearest: SyncRecord | null = null;
    let dist = Infinity;
    for (const r of onPage) {
      const top = r.y - r.h;
      const bottom = r.y + r.d;
      const dx = x < r.x ? r.x - x : x > r.x + r.w ? x - (r.x + r.w) : 0;
      const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
      const d = Math.hypot(dx, dy);
      if (d < dist) {
        dist = d;
        nearest = r;
      }
    }
    return nearest ? { file: this.inputs.get(nearest.tag)!, line: nearest.line } : null;
  }
}
