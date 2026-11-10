/**
 * «Sahifa dizayni» (page design), MVP: paragraph and character styles and
 * master pages, kept in the project as `sahifa.sty`.
 *
 * The model lives at the top of the package in `% oversells-sahifa:` comment
 * lines (JSON, like `% oversells-drawing:` of the drawing board); the rest of
 * the file is generated from it, so the project stays plain LaTeX that
 * compiles without Oversells. In the document:
 *
 *   \begin{uslub}{iqtibos} ... \end{uslub}   paragraph style
 *   \matnuslubi{urgu}{...}                   character style
 *   \sahifausta{asosiy}                      master page from here on
 *
 * Headings stay \chapter/\section/\subsection (so the contents, «Faqat shu
 * bob» and SyncTeX keep working); a heading style only changes their look.
 */

import { indexOutsideComments } from './latex-text.js';

export const PAGE_DESIGN_FILE = 'sahifa.sty';
export const PAGE_DESIGN_PACKAGE = 'sahifa';
const MARK = '% oversells-sahifa: ';

export type SlotKind = 'empty' | 'page' | 'chapter' | 'section' | 'title' | 'text';
export interface Slot {
  kind: SlotKind;
  /** For kind 'text'. */
  text?: string;
}
export interface HeaderLine {
  left: Slot;
  center: Slot;
  right: Slot;
}
export interface PageSide {
  head: HeaderLine;
  foot: HeaderLine;
}
export type PageNumbering = 'arabic' | 'roman' | 'Roman';
export type BackgroundKind = 'rect' | 'line' | 'image';
/**
 * Something drawn on every page of a master, behind the text: a coloured area, a line or a picture.
 * Positions in mm from the top-left corner of the trimmed page; a line runs from (x, y) by (w, h).
 */
export interface BackgroundElement {
  kind: BackgroundKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** RRGGBB (rect, line). */
  color?: string;
  /** 0 (solid) … 1 (invisible). */
  transparency?: number;
  /** Line thickness, pt. */
  thickness?: number;
  /** A picture of the project (image), cover-filled into the box. */
  file?: string;
  /** On left-hand pages of a two-sided book, x is measured from the right edge (outer margins). */
  mirror?: boolean;
}
export interface MasterPage {
  id: string;
  name: string;
  odd: PageSide;
  /** Left-hand pages of a two-sided document (one-sided documents use `odd` only). */
  even: PageSide;
  /** A line under the running head. */
  headRule: boolean;
  /** Restarts page numbers in this style when the master is switched on (\sahifausta). */
  numbering: PageNumbering | null;
  background?: BackgroundElement[];
}

export type Align = 'justify' | 'left' | 'right' | 'center';
export interface ParagraphStyle {
  id: string;
  name: string;
  basedOn?: string;
  /** Heading level this style formats (1 = \chapter, or \section without chapters). */
  heading?: 1 | 2 | 3;
  /** Installed family ("Noto Serif") or an uploaded file ("fonts/Kitob.otf"). */
  font?: string;
  /** Points. */
  size?: number;
  /** Points between baselines. */
  leading?: number;
  /** Letter spacing in thousandths of an em (fontspec LetterSpace is in percent of the size: /10). */
  tracking?: number;
  align?: Align;
  /** First-line indent, mm. */
  indent?: number;
  /** Indent of the whole paragraph from the left, mm. */
  leftIndent?: number;
  /** Points. */
  spaceBefore?: number;
  spaceAfter?: number;
  /** Points between paragraphs inside the style (stanzas of a poem). */
  parSkip?: number;
  italic?: boolean;
  bold?: boolean;
  /** RRGGBB. */
  color?: string;
  hyphenate?: boolean;
  keepWithNext?: boolean;
  /** A drop cap of that many lines on the first letter (XeLaTeX, LuaLaTeX). */
  dropCap?: 2 | 3 | 4;
}
export interface CharacterStyle {
  id: string;
  name: string;
  font?: string;
  italic?: boolean;
  bold?: boolean;
  smallCaps?: boolean;
  color?: string;
  tracking?: number;
}
/** Page margins and column gap, mm; unset values keep the document's own. */
export interface PageGeometry {
  inner?: number;
  outer?: number;
  top?: number;
  bottom?: number;
  /** Gap between columns of \begin{ustunlar}{n}. */
  columnGap?: number;
}

export interface PageDesignSpec {
  version: 1;
  /** Book title for the running heads. */
  title: string;
  paragraphStyles: ParagraphStyle[];
  characterStyles: CharacterStyle[];
  masters: MasterPage[];
  defaultMaster: string;
  /** Pages where a chapter starts (LaTeX's `plain` page style); null keeps the class default. */
  chapterMaster: string | null;
  /** Chapters start on a right-hand page (book/report classes, two-sided). */
  chapterOpensRight: boolean;
  /** The blank page left before such a chapter has no running head or number. */
  blankPagesEmpty: boolean;
  /** No single line of a paragraph alone at the top or bottom of a page. */
  widowControl: boolean;
  page?: PageGeometry;
  /** Margin kerning and font expansion (microtype; XeLaTeX only does the first). */
  microtype?: boolean;
  /**
   * Snap to the baseline grid: spaces before and after styles and headings become whole lines of
   * the body text, leadings a whole number of lines, pictures in the flow are padded to the grid.
   */
  baselineSnap?: boolean;
  /** An ornament at the end of every chapter (or top-level section without chapters). */
  chapterEndOrnament?: Ornament;
  /** An ornament under every chapter title (or top-level section title without chapters). */
  chapterHeadOrnament?: Ornament;
}
export type Ornament = 'stars' | 'rule' | 'fleuron';
export const ORNAMENTS: Ornament[] = ['stars', 'rule', 'fleuron'];

export class PageDesignError extends Error {
  /** For the interface: what went wrong when applying a style ('invalid' for the model). */
  constructor(
    message: string,
    readonly code: 'invalid' | 'unknownStyle' | 'noSelection' | 'oneParagraph' | 'brokenGroup' | 'noParagraph' | 'notInBody' = 'invalid',
  ) {
    super(message);
  }
}

// --- validation ----------------------------------------------------------------------------

const ID = /^[a-z][a-z0-9]{0,29}$/;
const COLOR = /^[0-9A-Fa-f]{6}$/;
/** Font names and project paths: no TeX specials. */
const FONT = /^(?!\/)(?!.*\.\.)[\p{L}\p{N} ._\-/]{1,80}$/u;
const SLOT_KINDS: SlotKind[] = ['empty', 'page', 'chapter', 'section', 'title', 'text'];
const ALIGNS: Align[] = ['justify', 'left', 'right', 'center'];
const NUMBERINGS: PageNumbering[] = ['arabic', 'roman', 'Roman'];
const BACKGROUND_KINDS: BackgroundKind[] = ['rect', 'line', 'image'];
/** A picture path inside the project: no "..", no TeX specials. */
const PICTURE = /^(?!\/)(?!.*\.\.)[\p{L}\p{N}._\-/]{1,160}\.(png|jpe?g|pdf)$/iu;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (msg: string): never => {
  throw new PageDesignError(msg);
};

function str(v: unknown, what: string, max: number): string {
  if (typeof v !== 'string') return fail(`${what}: text expected`);
  const s = v.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (s.length > max) fail(`${what}: at most ${max} characters`);
  return s;
}
function id(v: unknown, what: string): string {
  if (typeof v !== 'string' || !ID.test(v)) fail(`${what}: an id is lower-case Latin letters and digits, starting with a letter`);
  return v as string;
}
function num(v: unknown, what: string, min: number, max: number): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(`${what}: a number from ${min} to ${max}`);
  return Math.round((v as number) * 100) / 100;
}
function bool(v: unknown, what: string): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') fail(`${what}: true or false`);
  return v as boolean;
}
function color(v: unknown, what: string): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || !COLOR.test(v.replace(/^#/, ''))) fail(`${what}: a colour as RRGGBB`);
  return (v as string).replace(/^#/, '').toUpperCase();
}
function font(v: unknown, what: string): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || !FONT.test(v) || v.includes('..')) fail(`${what}: a font name or a project file`);
  return (v as string).trim();
}
function dropCap(v: unknown, what: string): 2 | 3 | 4 | undefined {
  if (v === undefined || v === null || v === 0) return undefined;
  if (v !== 2 && v !== 3 && v !== 4) fail(`${what}: a drop cap of 2, 3 or 4 lines`);
  return v as 2 | 3 | 4;
}
function geometry(v: unknown): PageGeometry | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) return fail('page: an object expected');
  const g = clean({
    inner: num(v.inner, 'page: inner margin', 3, 80),
    outer: num(v.outer, 'page: outer margin', 3, 80),
    top: num(v.top, 'page: top margin', 3, 80),
    bottom: num(v.bottom, 'page: bottom margin', 3, 80),
    columnGap: num(v.columnGap, 'page: column gap', 1, 40),
  });
  return Object.keys(g).length ? g : undefined;
}
const clean = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

function slot(v: unknown, what: string): Slot {
  if (!isObj(v)) return { kind: 'empty' };
  const kind = v.kind as SlotKind;
  if (!SLOT_KINDS.includes(kind)) fail(`${what}: unknown kind`);
  return kind === 'text' ? { kind, text: str(v.text ?? '', what, 120) } : { kind };
}
function background(v: unknown, what: string): BackgroundElement {
  if (!isObj(v)) return fail(`${what}: an object expected`);
  const kind = v.kind as BackgroundKind;
  if (!BACKGROUND_KINDS.includes(kind)) fail(`${what}: unknown kind`);
  const req = (k: 'x' | 'y' | 'w' | 'h', min: number) => num(v[k] ?? 0, `${what}: ${k}`, min, 1000) ?? 0;
  let file: string | undefined;
  if (kind === 'image') {
    file = str(v.file, `${what}: file`, 160);
    if (!PICTURE.test(file)) fail(`${what}: a picture of the project expected (png, jpg, pdf)`);
  }
  return clean({
    kind,
    x: req('x', -100),
    y: req('y', -100),
    w: req('w', kind === 'line' ? -1000 : 0),
    h: req('h', kind === 'line' ? -1000 : 0),
    color: kind === 'image' ? undefined : color(v.color, what),
    transparency: num(v.transparency, `${what}: transparency`, 0, 1),
    thickness: kind === 'line' ? num(v.thickness, `${what}: thickness`, 0.1, 20) : undefined,
    file,
    mirror: bool(v.mirror, what) || undefined,
  });
}
function line(v: unknown, what: string): HeaderLine {
  const o = isObj(v) ? v : {};
  return { left: slot(o.left, `${what}.left`), center: slot(o.center, `${what}.center`), right: slot(o.right, `${what}.right`) };
}
function side(v: unknown, what: string): PageSide {
  const o = isObj(v) ? v : {};
  return { head: line(o.head, `${what}.head`), foot: line(o.foot, `${what}.foot`) };
}

/** Checks and cleans a page design from the client or a file; throws PageDesignError. */
export function normalizePageDesign(raw: unknown): PageDesignSpec {
  if (!isObj(raw)) return fail('page design: an object expected');
  if (raw.version !== 1) fail('page design: version 1 expected');
  const arr = (v: unknown, what: string, max: number): unknown[] => {
    if (!Array.isArray(v)) return fail(`${what}: a list expected`);
    if (v.length > max) fail(`${what}: at most ${max}`);
    return v;
  };
  const paragraphStyles = arr(raw.paragraphStyles ?? [], 'paragraphStyles', 60).map((p, i): ParagraphStyle => {
    if (!isObj(p)) return fail(`paragraphStyles[${i}]: an object expected`);
    const w = `paragraph style ${String(p.id ?? i)}`;
    const align = p.align as Align | undefined;
    if (align !== undefined && !ALIGNS.includes(align)) fail(`${w}: unknown alignment`);
    const heading = p.heading as 1 | 2 | 3 | undefined;
    if (heading !== undefined && heading !== null && ![1, 2, 3].includes(heading)) fail(`${w}: heading 1, 2 or 3`);
    return clean({
      id: id(p.id, w),
      name: str(p.name ?? p.id, w, 60),
      basedOn: p.basedOn ? id(p.basedOn, `${w}: basedOn`) : undefined,
      heading: heading ?? undefined,
      font: font(p.font, w),
      size: num(p.size, `${w}: size`, 4, 96),
      leading: num(p.leading, `${w}: leading`, 4, 144),
      tracking: num(p.tracking, `${w}: tracking`, -100, 500),
      align,
      indent: num(p.indent, `${w}: indent`, 0, 60),
      leftIndent: num(p.leftIndent, `${w}: left indent`, 0, 100),
      spaceBefore: num(p.spaceBefore, `${w}: space before`, 0, 200),
      spaceAfter: num(p.spaceAfter, `${w}: space after`, 0, 200),
      parSkip: num(p.parSkip, `${w}: space between paragraphs`, 0, 100),
      italic: bool(p.italic, w),
      bold: bool(p.bold, w),
      color: color(p.color, w),
      hyphenate: bool(p.hyphenate, w),
      keepWithNext: bool(p.keepWithNext, w),
      dropCap: dropCap(p.dropCap, w),
    });
  });
  const characterStyles = arr(raw.characterStyles ?? [], 'characterStyles', 60).map((c, i): CharacterStyle => {
    if (!isObj(c)) return fail(`characterStyles[${i}]: an object expected`);
    const w = `character style ${String(c.id ?? i)}`;
    return clean({
      id: id(c.id, w),
      name: str(c.name ?? c.id, w, 60),
      font: font(c.font, w),
      italic: bool(c.italic, w),
      bold: bool(c.bold, w),
      smallCaps: bool(c.smallCaps, w),
      color: color(c.color, w),
      tracking: num(c.tracking, `${w}: tracking`, -100, 500),
    });
  });
  const masters = arr(raw.masters ?? [], 'masters', 30).map((m, i): MasterPage => {
    if (!isObj(m)) return fail(`masters[${i}]: an object expected`);
    const w = `master ${String(m.id ?? i)}`;
    const numbering = (m.numbering ?? null) as PageNumbering | null;
    if (numbering !== null && !NUMBERINGS.includes(numbering)) fail(`${w}: unknown numbering`);
    const master: MasterPage = {
      id: id(m.id, w),
      name: str(m.name ?? m.id, w, 60),
      odd: side(m.odd, `${w}.odd`),
      even: side(m.even ?? m.odd, `${w}.even`),
      headRule: bool(m.headRule, w) ?? false,
      numbering,
    };
    const bg = arr(m.background ?? [], `${w}: background`, 12).map((b, j) => background(b, `${w}: background ${j + 1}`));
    if (bg.length) master.background = bg;
    return master;
  });
  const unique = (ids: string[], what: string) => {
    const seen = new Set<string>();
    for (const x of ids) {
      if (seen.has(x)) fail(`${what} ${x} is defined twice`);
      seen.add(x);
    }
  };
  unique(paragraphStyles.map((p) => p.id), 'paragraph style');
  unique(characterStyles.map((c) => c.id), 'character style');
  unique(masters.map((m) => m.id), 'master');
  if (!masters.length) fail('page design: at least one master page');
  const masterIds = new Set(masters.map((m) => m.id));
  const defaultMaster = id(raw.defaultMaster, 'defaultMaster');
  if (!masterIds.has(defaultMaster)) fail(`defaultMaster: no master ${defaultMaster}`);
  const chapterMaster = raw.chapterMaster ? id(raw.chapterMaster, 'chapterMaster') : null;
  if (chapterMaster && !masterIds.has(chapterMaster)) fail(`chapterMaster: no master ${chapterMaster}`);
  const styleIds = new Set(paragraphStyles.map((p) => p.id));
  for (const p of paragraphStyles) if (p.basedOn && !styleIds.has(p.basedOn)) fail(`paragraph style ${p.id}: no style ${p.basedOn}`);
  const spec: PageDesignSpec = {
    version: 1,
    title: str(raw.title ?? '', 'title', 120),
    paragraphStyles,
    characterStyles,
    masters,
    defaultMaster,
    chapterMaster,
    chapterOpensRight: bool(raw.chapterOpensRight, 'chapterOpensRight') ?? false,
    blankPagesEmpty: bool(raw.blankPagesEmpty, 'blankPagesEmpty') ?? true,
    widowControl: bool(raw.widowControl, 'widowControl') ?? true,
  };
  const page = geometry(raw.page);
  if (page) spec.page = page;
  const microtype = bool(raw.microtype, 'microtype');
  if (microtype) spec.microtype = true;
  if (bool(raw.baselineSnap, 'baselineSnap')) spec.baselineSnap = true;
  if (raw.chapterEndOrnament !== undefined && raw.chapterEndOrnament !== null) {
    const o = raw.chapterEndOrnament as Ornament;
    if (!ORNAMENTS.includes(o)) fail('chapterEndOrnament: unknown ornament');
    spec.chapterEndOrnament = o;
  }
  if (raw.chapterHeadOrnament !== undefined && raw.chapterHeadOrnament !== null) {
    const o = raw.chapterHeadOrnament as Ornament;
    if (!ORNAMENTS.includes(o)) fail('chapterHeadOrnament: unknown ornament');
    spec.chapterHeadOrnament = o;
  }
  for (const p of paragraphStyles) resolveParagraphStyle(spec, p.id);
  return spec;
}

/** A paragraph style with everything it inherits through basedOn; throws on a cycle. */
export function resolveParagraphStyle(spec: PageDesignSpec, styleId: string): ParagraphStyle {
  const chain: ParagraphStyle[] = [];
  const seen = new Set<string>();
  for (let cur: string | undefined = styleId; cur; ) {
    if (seen.has(cur)) fail(`paragraph style ${styleId}: basedOn makes a loop`);
    seen.add(cur);
    const s = spec.paragraphStyles.find((p) => p.id === cur);
    if (!s) break;
    chain.unshift(s);
    cur = s.basedOn;
  }
  const merged = Object.assign({}, ...chain) as ParagraphStyle;
  // Only the style itself is a heading; its id and name are its own.
  const own = chain[chain.length - 1];
  return clean({ ...merged, id: styleId, name: own?.name ?? styleId, basedOn: own?.basedOn, heading: own?.heading });
}

// --- defaults ------------------------------------------------------------------------------

const EMPTY: Slot = { kind: 'empty' };
const blankLine = (): HeaderLine => ({ left: EMPTY, center: EMPTY, right: EMPTY });

/** A starting point: a few common styles, a body master with running heads and a chapter-opening master. */
export function defaultPageDesign(title = ''): PageDesignSpec {
  return {
    version: 1,
    title,
    paragraphStyles: [
      { id: 'iqtibos', name: 'Iqtibos', italic: true, leftIndent: 10, spaceBefore: 6, spaceAfter: 6 },
      { id: 'sher', name: 'Sheʼr', align: 'left', leftIndent: 15, indent: 0, hyphenate: false, spaceBefore: 6, spaceAfter: 6 },
      { id: 'izoh', name: 'Izoh', size: 9, leading: 11, color: '555555' },
    ],
    characterStyles: [
      { id: 'urgu', name: 'Urgʻu', italic: true },
      { id: 'atama', name: 'Atama', bold: true },
      { id: 'xorijiy', name: 'Xorijiy soʻz', italic: true },
    ],
    masters: [
      {
        id: 'asosiy',
        name: 'Asosiy',
        odd: { head: { left: EMPTY, center: { kind: 'chapter' }, right: { kind: 'page' } }, foot: blankLine() },
        even: { head: { left: { kind: 'page' }, center: { kind: 'title' }, right: EMPTY }, foot: blankLine() },
        headRule: false,
        numbering: null,
      },
      {
        id: 'boshlanish',
        name: 'Bob boshlanishi',
        odd: { head: blankLine(), foot: { left: EMPTY, center: { kind: 'page' }, right: EMPTY } },
        even: { head: blankLine(), foot: { left: EMPTY, center: { kind: 'page' }, right: EMPTY } },
        headRule: false,
        numbering: null,
      },
    ],
    defaultMaster: 'asosiy',
    chapterMaster: 'boshlanish',
    chapterOpensRight: false,
    blankPagesEmpty: true,
    widowControl: true,
  };
}

// --- LaTeX generation ----------------------------------------------------------------------

/** Text from the user inside LaTeX. */
export function escapeLatex(text: string): string {
  // U+2028/U+2029 may end a line for the TeX engine (the rest would run as TeX): a space instead.
  return text.replace(/[\u2028\u2029]/g, ' ').replace(/[\\{}$&#^_%~]/g, (c) =>
    c === '\\' ? '\\textbackslash{}' : c === '^' ? '\\textasciicircum{}' : c === '~' ? '\\textasciitilde{}' : `\\${c}`,
  );
}

/** Fonts of the design in a fixed order; each gets a macro named with letters only. */
function fontList(spec: PageDesignSpec): string[] {
  const fonts = new Set<string>();
  for (const p of spec.paragraphStyles) if (p.font) fonts.add(p.font);
  for (const c of spec.characterStyles) if (c.font) fonts.add(c.font);
  return [...fonts];
}

type FontMacro = (font: string) => string;

function fontMacros(fonts: string[]): FontMacro {
  const letters = (n: number): string => (n < 26 ? '' : letters(Math.floor(n / 26) - 1)) + String.fromCharCode(97 + (n % 26));
  return (f) => `\\sahifa@font@${letters(fonts.indexOf(f))}`;
}

function fontDefinitions(fonts: string[], fontMacro: FontMacro): string[] {
  return fonts.map((f) => {
    const slash = f.lastIndexOf('/');
    // An uploaded file: by file name, with the folder as Path.
    if (/\.(otf|ttf)$/i.test(f)) {
      const dir = slash === -1 ? './' : `./${f.slice(0, slash + 1)}`;
      const name = f.slice(slash + 1);
      return `\\newfontfamily${fontMacro(f)}{${name}}[Path=${dir}]`;
    }
    return `\\newfontfamily${fontMacro(f)}{${f}}`;
  });
}

const mm = (v: number) => `${v}mm`;
const pt = (v: number) => `${v}pt`;
/** A vertical space: as written, or the nearest whole number of grid lines. */
const space = (v: number, snap: boolean) => (snap ? `\\sahifa@snap{${pt(v)}}` : pt(v));
/** A leading: as written, or rounded up to whole grid lines. */
const leadingOf = (v: number, snap: boolean) => (snap ? `\\sahifa@snapup{${pt(v)}}` : pt(v));

/** Commands that set up a paragraph style inside its group. */
function paragraphSetup(p: ParagraphStyle, fontMacro: FontMacro, snap = false): string {
  const out: string[] = [];
  if (p.font) out.push(`\\sahifa@iffonts{${fontMacro(p.font)}}`);
  if (p.size || p.leading) {
    const size = p.size ?? 10;
    out.push(`\\fontsize{${pt(size)}}{${leadingOf(p.leading ?? Math.round(size * 1.2 * 10) / 10, snap)}}\\selectfont`);
  }
  if (p.tracking) out.push(`\\sahifa@iffonts{\\addfontfeature{LetterSpace=${p.tracking / 10}}}`);
  if (p.italic) out.push('\\itshape');
  if (p.bold) out.push('\\bfseries');
  if (p.color) out.push(`\\color[HTML]{${p.color}}`);
  if (p.align === 'left') out.push('\\raggedright');
  else if (p.align === 'right') out.push('\\raggedleft');
  else if (p.align === 'center') out.push('\\centering');
  if (p.leftIndent) out.push(`\\advance\\leftskip ${mm(p.leftIndent)}`);
  if (p.indent !== undefined) out.push(`\\parindent=${mm(p.indent)}`);
  if (p.parSkip !== undefined) out.push(`\\parskip=${space(p.parSkip, snap)}`);
  if (p.hyphenate === false) out.push('\\hyphenpenalty=10000 \\exhyphenpenalty=10000');
  return out.join('');
}

function characterSetup(c: CharacterStyle, fontMacro: FontMacro): string {
  const out: string[] = [];
  if (c.font) out.push(`\\sahifa@iffonts{${fontMacro(c.font)}}`);
  if (c.tracking) out.push(`\\sahifa@iffonts{\\addfontfeature{LetterSpace=${c.tracking / 10}}}`);
  if (c.italic) out.push('\\itshape');
  if (c.bold) out.push('\\bfseries');
  if (c.smallCaps) out.push('\\scshape');
  if (c.color) out.push(`\\color[HTML]{${c.color}}`);
  return out.join('');
}

function slotLatex(s: Slot): string {
  switch (s.kind) {
    case 'page':
      return '\\thepage';
    case 'chapter':
      return '\\leftmark';
    case 'section':
      return '\\rightmark';
    case 'title':
      return '\\sahifa@title';
    case 'text':
      return escapeLatex(s.text ?? '');
    default:
      return '';
  }
}

function masterBody(m: MasterPage): string {
  const fields: string[] = ['\\fancyhf{}'];
  const put = (where: 'head' | 'foot', page: 'O' | 'E', l: HeaderLine) => {
    const cmd = where === 'head' ? '\\fancyhead' : '\\fancyfoot';
    for (const [pos, s] of [['L', l.left], ['C', l.center], ['R', l.right]] as const) {
      const v = slotLatex(s);
      if (v) fields.push(`${cmd}[${pos}${page}]{${v}}`);
    }
  };
  put('head', 'O', m.odd.head);
  put('foot', 'O', m.odd.foot);
  put('head', 'E', m.even.head);
  put('foot', 'E', m.even.foot);
  fields.push(`\\renewcommand\\headrulewidth{${m.headRule ? '0.4pt' : '0pt'}}`, '\\renewcommand\\footrulewidth{0pt}');
  return fields.join('%\n  ');
}

/** TikZ code of the background of a master (inside \AtPageUpperLeft, y grows downwards as -y). */
function backgroundLatex(m: MasterPage): string {
  const parts: string[] = [];
  (m.background ?? []).forEach((b, i) => {
    const colour = `sahifa@bg@${m.id}@${i + 1}`;
    const opacity = b.transparency ? `,opacity=${Math.round((1 - b.transparency) * 1000) / 1000}` : '';
    const draw = (mirrored: boolean): string => {
      // Mirrored: the box keeps its distance from the right edge instead of the left one; a line runs the other way.
      const from = b.kind === 'line' ? b.x : b.x + b.w;
      const x = mirrored ? `\\paperwidth${from < 0 ? `+${mm(-from)}` : `-${mm(from)}`}` : mm(b.x);
      const y = mm(-b.y);
      const dx = mm(mirrored && b.kind === 'line' ? -b.w : b.w);
      const dy = mm(-b.h);
      switch (b.kind) {
        case 'rect':
          return `\\fill[${colour}${opacity}] (${x},${y}) rectangle ++(${dx},${dy});`;
        case 'line':
          return `\\draw[${colour},line width=${pt(b.thickness ?? 0.5)}${opacity}] (${x},${y}) -- ++(${dx},${dy});`;
        default:
          return `\\node[anchor=north west,inner sep=0pt${opacity}] at (${x},${y}) {\\sahifa@cover{${b.file}}{${mm(b.w)}}{${mm(b.h)}}};`;
      }
    };
    parts.push(b.mirror ? `\\ifsahifa@evenpage ${draw(true)}\\else ${draw(false)}\\fi` : draw(false));
  });
  return parts.join('%\n  ');
}

const ORNAMENT_LATEX: Record<Ornament, string> = {
  stars: '*\\quad*\\quad*',
  rule: '\\rule[0.5ex]{30mm}{0.4pt}',
  fleuron: '\\ding{167}',
};

/** Font settings of a heading style as titlesec format commands. */
function headingFormat(p: ParagraphStyle, fontMacro: FontMacro, snap = false): string {
  const out: string[] = ['\\normalfont'];
  if (p.font) out.push(`\\sahifa@iffonts{${fontMacro(p.font)}}`);
  const size = p.size ?? [0, 20, 15, 12][p.heading ?? 1]!;
  out.push(`\\fontsize{${pt(size)}}{${leadingOf(p.leading ?? Math.round(size * 1.2 * 10) / 10, snap)}}\\selectfont`);
  if (p.bold !== false) out.push('\\bfseries');
  if (p.italic) out.push('\\itshape');
  if (p.color) out.push(`\\color[HTML]{${p.color}}`);
  if (p.align === 'center') out.push('\\filcenter');
  else if (p.align === 'right') out.push('\\filleft');
  return out.join('');
}

/**
 * A model as TeX comment lines starting with `mark`: its JSON in lines of about 100 characters,
 * never cut inside a character (emoji are two UTF-16 units), and with U+2028/U+2029 escaped,
 * since TeX engines may read them as line ends and run the rest of the line as TeX.
 */
export function jsonCommentLines(mark: string, model: unknown): string {
  const json = JSON.stringify(model).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const chars = Array.from(json);
  const lines: string[] = [];
  for (let i = 0; i < chars.length; i += 100) lines.push(mark + chars.slice(i, i + 100).join(''));
  return lines.join('\n');
}

/** The JSON of a model written by jsonCommentLines (Windows line ends too); '' when there is none. */
export function jsonFromCommentLines(mark: string, text: string): string {
  return text
    .split(/\r?\n/)
    .filter((l) => l.startsWith(mark))
    .map((l) => l.slice(mark.length))
    .join('');
}

/**
 * Baseline grid snapping: the grid is the body text's \baselineskip at \begin{document}.
 * \sahifa@snap{dim} is the nearest whole number of lines, \sahifa@snapup{dim} at least as many
 * lines as needed (for leadings); \sahifa@gridbox{content} sets a centred block (a picture
 * in the flow and its caption) on its own lines: it starts on the line after the previous
 * text's baseline, half a line of space above and below it, and is padded to whole lines.
 */
const BASELINE_SNAP = String.raw`\newif\ifsahifa@snap \sahifa@snaptrue
\newdimen\sahifa@grid \sahifa@grid=12pt
\AtBeginDocument{\sahifa@grid=\baselineskip\relax}
\newcommand\sahifa@snap[1]{\dimexpr\sahifa@grid*\numexpr\dimexpr#1\relax/\sahifa@grid\relax\relax}
\newcommand\sahifa@snapup[1]{\dimexpr\sahifa@grid*\numexpr\dimexpr#1+\sahifa@grid/2-1sp\relax/\sahifa@grid\relax\relax}
\newcommand\sahifa@gridbox[1]{\par
  \setbox\@tempboxa\vbox{\hsize\linewidth\centering\parindent\z@ #1\par}%
  \@tempdima=\ht\@tempboxa \advance\@tempdima\dp\@tempboxa \advance\@tempdima\sahifa@grid
  \ifdim\prevdepth>\z@\vskip-\prevdepth\fi\nointerlineskip
  \vbox to \sahifa@snapup{\@tempdima}{\vfil\box\@tempboxa\vfil}\prevdepth\z@}
% After a heading: the next line's baseline (the last one + a body line) onto the grid, measured
% from the first baseline of the page (\topskip); \pagetotal is the last baseline's position.
\newcommand\sahifa@gridalign{\par\ifdim\pagetotal>\z@
  \@tempdima=\dimexpr\pagetotal-\topskip\relax
  \@tempdimb=\dimexpr\@tempdima-\sahifa@grid*\numexpr\dimexpr\@tempdima-\sahifa@grid/2+1sp\relax/\sahifa@grid\relax\relax
  \ifdim\@tempdimb>0.05pt\nobreak\vskip\dimexpr\sahifa@grid-\@tempdimb\relax\fi\fi}`;

/** The model as comment lines (JSON, split into short lines). */
function modelComment(spec: PageDesignSpec): string {
  return jsonCommentLines(MARK, spec);
}

/**
 * \rasmramka[keys]{file}{caption}: a picture frame.
 *   joy=oqim     in the text flow, centred (default)
 *   joy=oralash  beside the text, which flows around it (wrapfig); tomon=chap|ong
 *   joy=sahifa   at x, y from the top-left corner of the page, over the text
 *   joy=tola     a whole page, to the edges and `bleed` beyond them (cover-fills, crops the rest)
 *   joy=yoyilma  one picture over two facing pages (left, then right), to the bleed
 *   en=<width>, kesish=<left bottom right top> (trim, the file is not changed), id=<name>
 */
const FRAMES = String.raw`\RequirePackage{graphicx}
\RequirePackage{wrapfig}
\RequirePackage{eso-pic}
\RequirePackage{keyval}
\RequirePackage{tikz}
\RequirePackage{zref-abspage}
\RequirePackage{currfile}
% For the visual editor (log): paper, text block and margins in pt, once the layout is final.
\AddToHook{begindocument/end}{%
  \typeout{OVS-G1:\the\paperwidth;\the\paperheight;\the\textwidth;\the\textheight}%
  \typeout{OVS-G2:\the\dimexpr\oddsidemargin+1in+\hoffset\relax;\the\dimexpr\evensidemargin+1in+\hoffset\relax;%
    \the\dimexpr\topmargin+1in+\voffset+\headheight+\headsep\relax;\if@twoside 1\else 0\fi}%
  \typeout{OVS-G3:\the\baselineskip;\the\topskip}}
\define@key{sahifa@ram}{joy}{\def\sahifa@r@joy{#1}}
\define@key{sahifa@ram}{en}{\def\sahifa@r@en{#1}}
\define@key{sahifa@ram}{x}{\def\sahifa@r@x{#1}}
\define@key{sahifa@ram}{y}{\def\sahifa@r@y{#1}}
\define@key{sahifa@ram}{kesish}{\def\sahifa@r@kesish{#1}}
\define@key{sahifa@ram}{bleed}{\def\sahifa@r@bleed{#1}}
\define@key{sahifa@ram}{id}{\def\sahifa@r@id{#1}}
\define@key{sahifa@ram}{tomon}{\def\@tempa{#1}\def\@tempb{chap}\ifx\@tempa\@tempb\def\sahifa@r@side{l}\else\def\sahifa@r@side{r}\fi}
\newcommand\sahifa@caption[1]{\if\relax\detokenize{#1}\relax\else\par\smallskip
  {\@ifundefined{sahifa@p@rasmosti}{\small\itshape}{\csname sahifa@p@rasmosti\endcsname}#1\par}\fi}
\newcommand\sahifa@img[2]{\edef\sahifa@tmp{\noexpand\includegraphics[\sahifa@r@gopts width=#2]{#1}}\sahifa@tmp}
\ExplSyntaxOn
\cs_new_protected:Npn \sahifa_fill:nnn #1#2#3
  {
    \hbox_set:Nn \l_tmpa_box { \includegraphics{#1} }
    \fp_compare:nNnTF
      { \dim_to_fp:n { \box_wd:N \l_tmpa_box } * \dim_to_fp:n {#3} } >
      { \dim_to_fp:n { \box_ht:N \l_tmpa_box } * \dim_to_fp:n {#2} }
      { \includegraphics[height=#3]{#1} }
      { \includegraphics[width=#2]{#1} }
  }
\cs_set_eq:NN \sahifa@fill \sahifa_fill:nnn
\ExplSyntaxOff
\newcommand\sahifa@cover[3]{\begin{tikzpicture}
  \clip (-0.5*#2,-0.5*#3) rectangle (0.5*#2,0.5*#3);
  \node[inner sep=0pt] at (0,0) {\sahifa@fill{#1}{#2}{#3}};
  \end{tikzpicture}}
\def\sahifa@ram@oqim#1#2{\ifsahifa@snap
  \sahifa@gridbox{\sahifa@img{#1}{\ifx\sahifa@r@en\@empty\linewidth\else\sahifa@r@en\fi}\sahifa@caption{#2}}%
  \else\par\begin{center}%
  \sahifa@img{#1}{\ifx\sahifa@r@en\@empty\linewidth\else\sahifa@r@en\fi}\sahifa@caption{#2}\end{center}\fi}
\def\sahifa@ram@oralash#1#2{\edef\sahifa@w{\ifx\sahifa@r@en\@empty 0.4\noexpand\linewidth\else\sahifa@r@en\fi}%
  \begin{wrapfigure}{\sahifa@r@side}{\sahifa@w}\centering\sahifa@img{#1}{\sahifa@w}\sahifa@caption{#2}\end{wrapfigure}}
% A frame fixed on the page: a zref label marks the page it is on (known from the previous
% run; latexmk runs again), and the picture is drawn when exactly that page is shipped out.
\newcounter{sahifa@ram}
\def\sahifa@ram@sahifa#1#2{\edef\sahifa@w{\ifx\sahifa@r@en\@empty 50mm\else\sahifa@r@en\fi}%
  \stepcounter{sahifa@ram}%
  \edef\sahifa@lbl{sahifa@ram@\arabic{sahifa@ram}}%
  \zref@labelbyprops{\sahifa@lbl}{abspage}%
  % For the visual editor (log): the frame's file and line, and on its page its box in pt.
  \edef\sahifa@tmp{\noexpand\includegraphics[\sahifa@r@gopts width=\sahifa@w]{#1}}\setbox\@tempboxa\hbox{\sahifa@tmp}%
  \typeout{OVS-FL:\arabic{sahifa@ram};\the\inputlineno;\currfilepath}%
  \edef\sahifa@tmp{\noexpand\AddToShipoutPictureFG{\noexpand\sahifa@frameat{\sahifa@lbl}{\arabic{sahifa@ram}}%
    {\the\dimexpr\sahifa@r@x\relax}{\the\dimexpr\sahifa@r@y\relax}{\the\dimexpr\sahifa@w\relax}{\the\ht\@tempboxa}%
    {\sahifa@r@gopts}{#1}{\unexpanded{#2}}}}%
  \sahifa@tmp}
% At shipout: #1 label, #2 frame number, #3 x, #4 y, #5 width, #6 height, #7 graphicx options,
% #8 file, #9 caption. On a left-hand page of a two-sided book a frame that reaches past the
% gutter (x + width > paper width) is a spread frame: this page shows the part up to the gutter,
% the facing right-hand page the rest, at the same height.
\newcommand\sahifa@frameat[9]{%
  \@tempcnta=\zref@extractdefault{#1}{abspage}{0}\relax
  \ifnum\value{abspage}=\@tempcnta
    \typeout{OVS-FP:#2;\the\value{abspage};#3;#4;#5;#6}%
    \sahifa@ifspread{#3}{#5}%
      {\AtPageUpperLeft{\put(\LenToUnit{#3},\LenToUnit{-#4}){\sahifa@part{#8}{#7}{#5}{#9}{0pt}{\dimexpr\paperwidth-#3\relax}}}}%
      {\AtPageUpperLeft{\put(\LenToUnit{#3},\LenToUnit{-#4}){\makebox(0,0)[tl]{\parbox[t]{#5}{%
        \includegraphics[#7width=#5]{#8}\sahifa@caption{#9}}}}}}%
  \else\advance\@tempcnta\@ne
    \ifnum\value{abspage}=\@tempcnta
      \sahifa@ifspreadfrom{#3}{#5}%
        {\AtPageUpperLeft{\put(0,\LenToUnit{-#4}){\sahifa@part{#8}{#7}{#5}{#9}{\dimexpr\paperwidth-#3\relax}{\dimexpr#3+#5-\paperwidth\relax}}}}{}%
    \fi
  \fi}
% #1 x, #2 width: a spread frame on this (left-hand) page?
\newcommand\sahifa@ifspread[4]{\if@twoside\ifodd\value{abspage}#4\else
  \ifdim\dimexpr#1+#2\relax>\paperwidth #3\else #4\fi\fi\else #4\fi}
% The same, asked on the right-hand page after it (the frame was on the page before).
\newcommand\sahifa@ifspreadfrom[4]{\if@twoside\ifodd\value{abspage}%
  \ifdim\dimexpr#1+#2\relax>\paperwidth #3\else #4\fi\else #4\fi\else #4\fi}
% Part of a frame: #1 file, #2 options, #3 width, #4 caption, shifted left by #5 and cut to #6 wide.
\newcommand\sahifa@part[6]{\makebox(0,0)[tl]{\begin{tikzpicture}
  \useasboundingbox (0,0) rectangle (#6,-1pt);
  \clip (0,1pt) rectangle (#6,-\paperheight);
  \node[anchor=north west,inner sep=0pt] at (-#5,0) {\parbox[t]{#3}{\includegraphics[#2width=#3]{#1}\sahifa@caption{#4}}};
  \end{tikzpicture}}}
\def\sahifa@ram@tola#1#2{\clearpage\typeout{OVS-BLEED}
  \@tempdima=\paperwidth \advance\@tempdima\sahifa@r@bleed \advance\@tempdima\sahifa@r@bleed
  \@tempdimb=\paperheight \advance\@tempdimb\sahifa@r@bleed \advance\@tempdimb\sahifa@r@bleed
  \edef\sahifa@tmp{\noexpand\AddToShipoutPictureBG*{\noexpand\AtPageCenter{\noexpand\makebox(0,0){%
    \noexpand\sahifa@cover{#1}{\the\@tempdima}{\the\@tempdimb}}}}}%
  \sahifa@tmp\thispagestyle{empty}\null\clearpage}
% joy=yoyilma: one picture over two facing pages (a left page, then a right one), cover-filled
% to the bleed on the outer edges; the gutter has no bleed. Two-sided books start it on an even page.
\newcommand\sahifa@half[5]{\begin{tikzpicture}
  \path[use as bounding box] (-0.5\paperwidth,-0.5\paperheight) rectangle (0.5\paperwidth,0.5\paperheight);
  \if l#4\clip (-0.5\paperwidth-#5,-0.5*#3) rectangle (0.5\paperwidth,0.5*#3);
    \node[inner sep=0pt] at (0.5\paperwidth,0) {\sahifa@fill{#1}{#2}{#3}};
  \else\clip (-0.5\paperwidth,-0.5*#3) rectangle (0.5\paperwidth+#5,0.5*#3);
    \node[inner sep=0pt] at (-0.5\paperwidth,0) {\sahifa@fill{#1}{#2}{#3}};\fi
  \end{tikzpicture}}
\def\sahifa@ram@yoyilma#1#2{\clearpage\typeout{OVS-BLEED}
  \if@twoside\ifodd\c@page\hbox{}\thispagestyle{empty}\sahifa@blankbg\newpage\fi\fi
  \@tempdima=2\paperwidth \advance\@tempdima\sahifa@r@bleed \advance\@tempdima\sahifa@r@bleed
  \@tempdimb=\paperheight \advance\@tempdimb\sahifa@r@bleed \advance\@tempdimb\sahifa@r@bleed
  \@for\sahifa@side:=l,r\do{%
    \edef\sahifa@tmp{\noexpand\AddToShipoutPictureBG*{\noexpand\AtPageCenter{\noexpand\makebox(0,0){%
      \noexpand\sahifa@half{#1}{\the\@tempdima}{\the\@tempdimb}{\sahifa@side}{\sahifa@r@bleed}}}}}%
    \sahifa@tmp\thispagestyle{empty}\sahifa@blankbg\null\clearpage}}
% joy=fon: the picture fills the page it is placed on (to the bleed), behind the text of that page.
\def\sahifa@ram@fon#1#2{\typeout{OVS-BLEED}\stepcounter{sahifa@ram}%
  \edef\sahifa@lbl{sahifa@ram@\arabic{sahifa@ram}}\zref@labelbyprops{\sahifa@lbl}{abspage}%
  \@tempdima=\paperwidth \advance\@tempdima\sahifa@r@bleed \advance\@tempdima\sahifa@r@bleed
  \@tempdimb=\paperheight \advance\@tempdimb\sahifa@r@bleed \advance\@tempdimb\sahifa@r@bleed
  \edef\sahifa@tmp{\noexpand\AddToShipoutPictureBG{%
    \noexpand\ifnum\noexpand\value{abspage}=\noexpand\zref@extractdefault{\sahifa@lbl}{abspage}{0}\relax
    \noexpand\AtPageCenter{\noexpand\makebox(0,0){\noexpand\sahifa@cover{#1}{\the\@tempdima}{\the\@tempdimb}}}\noexpand\fi}}%
  % Something on the page, so that a page of only a background and text boxes is still a page.
  \sahifa@tmp\par\null\par}
\NewDocumentCommand\rasmramka{O{}mm}{\begingroup
  \def\sahifa@r@joy{oqim}\let\sahifa@r@en\@empty\def\sahifa@r@x{0mm}\def\sahifa@r@y{0mm}%
  \let\sahifa@r@kesish\@empty\def\sahifa@r@bleed{3mm}\def\sahifa@r@side{r}\let\sahifa@r@id\@empty
  \setkeys{sahifa@ram}{#1}%
  \edef\sahifa@r@gopts{\ifx\sahifa@r@kesish\@empty\else trim=\sahifa@r@kesish,clip,\fi}%
  \@ifundefined{sahifa@ram@\sahifa@r@joy}{\PackageWarning{sahifa}{Unknown frame mode \sahifa@r@joy}\sahifa@ram@oqim{#2}{#3}}%
    {\csname sahifa@ram@\sahifa@r@joy\endcsname{#2}{#3}}%
  \endgroup}
% \begin{matnquti}[x=,y=,en=,fon=RRGGBB,shaffof=0..1,ichki=] text \end{matnquti}: a text box fixed
% at x, y on the page it is placed on, over pictures (a picture book page: joy=fon + text boxes).
\define@key{sahifa@mq}{x}{\def\sahifa@q@x{#1}}
\define@key{sahifa@mq}{y}{\def\sahifa@q@y{#1}}
\define@key{sahifa@mq}{en}{\def\sahifa@q@en{#1}}
\define@key{sahifa@mq}{fon}{\def\sahifa@q@fon{#1}}
\define@key{sahifa@mq}{shaffof}{\def\sahifa@q@shaffof{#1}}
\define@key{sahifa@mq}{ichki}{\def\sahifa@q@ichki{#1}}
\define@key{sahifa@mq}{id}{}
\newcommand\sahifa@qnode[5]{\definecolor{sahifa@qc}{HTML}{#3}\begin{tikzpicture}
  \node[anchor=north west,inner sep=#2,text width=#1-2*#2,fill=sahifa@qc,fill opacity=1-#4,text opacity=1]{#5};
  \end{tikzpicture}}
\NewDocumentEnvironment{matnquti}{O{}+b}{\begingroup
  \def\sahifa@q@x{20mm}\def\sahifa@q@y{20mm}\def\sahifa@q@en{80mm}\def\sahifa@q@fon{FFFFFF}%
  \def\sahifa@q@shaffof{0}\def\sahifa@q@ichki{3mm}%
  \setkeys{sahifa@mq}{#1}%
  \stepcounter{sahifa@ram}%
  \edef\sahifa@lbl{sahifa@ram@\arabic{sahifa@ram}}\zref@labelbyprops{\sahifa@lbl}{abspage}%
  \setbox\@tempboxa\hbox{\sahifa@qnode{\sahifa@q@en}{\sahifa@q@ichki}{\sahifa@q@fon}{\sahifa@q@shaffof}{#2}}%
  \@tempdima=\ht\@tempboxa \advance\@tempdima\dp\@tempboxa
  \typeout{OVS-FL:\arabic{sahifa@ram};\the\inputlineno;\currfilepath}%
  \edef\sahifa@tmp{\noexpand\AddToShipoutPictureFG{%
    \noexpand\ifnum\noexpand\value{abspage}=\noexpand\zref@extractdefault{\sahifa@lbl}{abspage}{0}\relax
    \noexpand\typeout{OVS-FP:\arabic{sahifa@ram};\noexpand\the\noexpand\value{abspage};%
      \the\dimexpr\sahifa@q@x\relax;\the\dimexpr\sahifa@q@y\relax;\the\dimexpr\sahifa@q@en\relax;\the\@tempdima}%
    \noexpand\AtPageUpperLeft{\noexpand\put(\noexpand\LenToUnit{\sahifa@q@x},\noexpand\LenToUnit{-\sahifa@q@y}){%
      \noexpand\makebox(0,0)[tl]{\noexpand\sahifa@qnode{\sahifa@q@en}{\sahifa@q@ichki}{\sahifa@q@fon}{\sahifa@q@shaffof}{\unexpanded{#2}}}}}%
    \noexpand\fi}}%
  \sahifa@tmp\endgroup}{}
% \begin{rasmtori}[ratio]{n} \torrasm{file}{caption} ... \end{rasmtori}: a grid of n pictures
% a row, all cut to the same height (width × ratio, default 0.7), captions below (album, catalogue).
\newcounter{sahifa@tor}
\NewDocumentEnvironment{rasmtori}{O{0.7}m}{\par\noindent\setcounter{sahifa@tor}{0}%
  \def\sahifa@torn{#2}%
  \edef\sahifa@torw{\the\dimexpr(\linewidth-4mm*\numexpr#2-1\relax)/#2\relax}%
  \@tempdima=\sahifa@torw\relax\@tempdima=#1\@tempdima\edef\sahifa@torh{\the\@tempdima}\ignorespaces}%
  {\par\medskip}
\NewDocumentCommand\torrasm{m+m}{%
  \ifnum\value{sahifa@tor}=\sahifa@torn\relax\par\medskip\noindent\setcounter{sahifa@tor}{0}%
  \else\ifnum\value{sahifa@tor}>0 \hspace{4mm}\fi\fi
  \stepcounter{sahifa@tor}%
  \begin{minipage}[t]{\sahifa@torw}\vspace{0pt}\sahifa@cover{#1}{\sahifa@torw}{\sahifa@torh}\sahifa@caption{#2}\end{minipage}\ignorespaces}
% Workbooks: writing lines, a box for the answer, squared paper.
\newcommand\yozishchiziqlari[1]{\par\vspace{3mm}\foreach \sahifa@i in {1,...,#1}{\noindent\textcolor{black!35}{\rule{\linewidth}{0.4pt}}\par\vspace{7mm}}}
\newcommand\javobjoyi[1][25mm]{\par\noindent\fbox{\parbox[t][#1][t]{\dimexpr\linewidth-2\fboxsep-2\fboxrule\relax}{\mbox{}}}\par}
\newcommand\katakjoy[1][30mm]{\par\noindent\begin{tikzpicture}\draw[step=5mm,black!25,very thin] (0,0) grid (\linewidth,#1);\end{tikzpicture}\par}`;

/** sahifa.sty: the model in comments, then the package generated from it. */
export function generatePageDesignPackage(raw: PageDesignSpec): string {
  const spec = normalizePageDesign(raw);
  const out: string[] = [
    modelComment(spec),
    '% Oversells «Sahifa dizayni». Generated from the lines above: change it in the',
    '% Sahifa dizayni dialog. Your own settings go into another file (it is rewritten).',
    '\\NeedsTeXFormat{LaTeX2e}',
    '\\ProvidesPackage{sahifa}[2026/11/01 Oversells sahifa dizayni]',
    '\\RequirePackage{iftex}',
    '\\RequirePackage{xcolor}',
    '\\RequirePackage{fancyhdr}',
    // Fonts only with fontspec (XeLaTeX, LuaLaTeX); pdfLaTeX keeps the document fonts.
    '\\ifPDFTeX\\newcommand\\sahifa@iffonts[1]{}\\else\\RequirePackage{fontspec}\\newcommand\\sahifa@iffonts[1]{#1}\\fi',
    // pdfLaTeX: the Uzbek ʻ and ʼ (U+02BB, U+02BC) of a title in the running heads, unless the document set them up.
    '\\ifPDFTeX',
    '  \\ifcsname u8:\\detokenize{\u02bb}\\endcsname\\else\\DeclareUnicodeCharacter{02BB}{`}\\fi',
    '  \\ifcsname u8:\\detokenize{\u02bc}\\endcsname\\else\\DeclareUnicodeCharacter{02BC}{\'}\\fi',
    '\\fi',
  ];
  const fonts = fontList(spec);
  const fontMacro = fontMacros(fonts);
  if (fonts.length) out.push('\\ifPDFTeX\\else', ...fontDefinitions(fonts, fontMacro), '\\fi');
  out.push(`\\newcommand\\sahifa@title{${escapeLatex(spec.title)}}`);

  // Running heads: the chapter (or section) name without "CHAPTER 1." and capitals.
  out.push(
    '\\@ifundefined{chapter}{%',
    '  \\renewcommand\\sectionmark[1]{\\markboth{#1}{}}\\renewcommand\\subsectionmark[1]{\\markright{#1}}%',
    '}{%',
    '  \\renewcommand\\chaptermark[1]{\\markboth{#1}{}}\\renewcommand\\sectionmark[1]{\\markright{#1}}%',
    '}',
  );

  // Masters.
  for (const m of spec.masters) out.push(`\\fancypagestyle{sahifa@${m.id}}{%\n  ${masterBody(m)}}`);
  out.push(
    '\\newcommand\\sahifausta[1]{%',
    '  \\@ifundefined{sahifa@numbering@#1}{}{\\pagenumbering{\\csname sahifa@numbering@#1\\endcsname}}%',
    '  \\@ifundefined{ps@sahifa@#1}{\\PackageWarning{sahifa}{No master page #1}}{\\pagestyle{sahifa@#1}\\gdef\\sahifa@master{#1}}}',
  );
  for (const m of spec.masters) if (m.numbering) out.push(`\\@namedef{sahifa@numbering@${m.id}}{${m.numbering}}`);
  out.push(`\\pagestyle{sahifa@${spec.defaultMaster}}`);
  if (spec.chapterMaster) {
    const m = spec.masters.find((x) => x.id === spec.chapterMaster)!;
    out.push(`\\fancypagestyle{plain}{%\n  ${masterBody(m)}}`);
  }
  if (spec.chapterOpensRight) out.push('\\@ifundefined{if@openright}{}{\\@openrighttrue}');
  if (spec.blankPagesEmpty) {
    out.push(
      '\\renewcommand\\cleardoublepage{\\clearpage\\if@twoside\\ifodd\\c@page\\else',
      '  \\hbox{}\\thispagestyle{empty}\\sahifa@blankbg\\newpage\\if@twocolumn\\hbox{}\\newpage\\fi\\fi\\fi}',
    );
  }
  // A blank page shows no master background (the switch is reset when that page is shipped out).
  out.push('\\def\\sahifa@blankbg{\\@ifundefined{ifsahifa@nobg}{}{\\global\\sahifa@nobgtrue}}');
  out.push('\\newcommand\\bosbet{\\clearpage\\hbox{}\\thispagestyle{empty}\\sahifa@blankbg\\clearpage}');
  if (spec.widowControl) out.push('\\widowpenalty=10000 \\clubpenalty=10000 \\displaywidowpenalty=10000');

  // Page: margins (inner/outer swap on left-hand pages of two-sided documents) and columns.
  const g = spec.page ?? {};
  const margins = (['inner', 'outer', 'top', 'bottom'] as const).filter((k) => g[k] !== undefined).map((k) => `${k}=${mm(g[k]!)}`);
  if (margins.length) {
    out.push(`\\@ifpackageloaded{geometry}{\\geometry{${margins.join(',')}}}{\\RequirePackage[${margins.join(',')}]{geometry}}`);
  }
  out.push('\\RequirePackage{multicol}');
  if (g.columnGap !== undefined) out.push(`\\setlength\\columnsep{${mm(g.columnGap)}}`);
  out.push('\\NewDocumentEnvironment{ustunlar}{m}{\\begin{multicols}{#1}}{\\end{multicols}}');
  if (spec.microtype) out.push('\\RequirePackage{microtype}');
  const snap = !!spec.baselineSnap;
  out.push(snap ? BASELINE_SNAP : '\\newif\\ifsahifa@snap \\newcommand\\sahifa@gridbox[1]{#1}');
  out.push(FRAMES);

  // Background elements of the masters: drawn under every page while that master is on
  // (\sahifausta switches it), not on the blank pages before chapters and of \bosbet.
  const withBg = spec.masters.filter((m) => m.background?.length);
  if (withBg.length) {
    out.push('\\newif\\ifsahifa@evenpage', '\\newif\\ifsahifa@nobg', `\\gdef\\sahifa@master{${spec.defaultMaster}}`);
    for (const m of withBg) {
      m.background!.forEach((b, i) => {
        if (b.kind !== 'image') out.push(`\\definecolor{sahifa@bg@${m.id}@${i + 1}}{HTML}{${(b.color ?? '000000').toUpperCase()}}`);
      });
      out.push(`\\@namedef{sahifa@bg@${m.id}}{%\n  ${backgroundLatex(m)}}`);
    }
    out.push(
      '\\AddToShipoutPictureBG{%',
      '  \\ifsahifa@nobg\\global\\sahifa@nobgfalse\\else',
      '  \\@ifundefined{sahifa@bg@\\sahifa@master}{}{%',
      '    \\if@twoside\\ifodd\\c@page\\sahifa@evenpagefalse\\else\\sahifa@evenpagetrue\\fi\\else\\sahifa@evenpagefalse\\fi',
      '    \\AtPageUpperLeft{\\begin{tikzpicture}[overlay]\\csname sahifa@bg@\\sahifa@master\\endcsname\\end{tikzpicture}}}\\fi}',
    );
  }

  // Paragraph styles.
  const body = spec.paragraphStyles.filter((p) => !p.heading);
  for (const s of body) {
    const p = resolveParagraphStyle(spec, s.id);
    out.push(`\\@namedef{sahifa@p@${p.id}}{${paragraphSetup(p, fontMacro, snap)}}`);
    out.push(`\\@namedef{sahifa@pb@${p.id}}{${p.spaceBefore ? `\\addvspace{${space(p.spaceBefore, snap)}}` : ''}}`);
    out.push(`\\@namedef{sahifa@pa@${p.id}}{${p.spaceAfter ? `\\addvspace{${space(p.spaceAfter, snap)}}` : ''}}`);
    out.push(`\\@namedef{sahifa@pk@${p.id}}{${p.keepWithNext ? '\\nobreak' : ''}}`);
    // The drop cap takes the first letter of the paragraph (the next token after the style starts).
    out.push(`\\@namedef{sahifa@pd@${p.id}}{${p.dropCap ? `\\sahifa@dropcap{${p.dropCap}}` : '\\ignorespaces'}}`);
  }
  if (body.some((s) => resolveParagraphStyle(spec, s.id).dropCap)) {
    out.push(
      '\\RequirePackage{lettrine}',
      // A letter (Unicode letters are one token in XeLaTeX/LuaLaTeX) gets the drop cap; anything else stays as it is.
      '\\def\\sahifa@dropcap#1#2{\\ifcat\\noexpand#2a\\expandafter\\@firstoftwo\\else\\expandafter\\@secondoftwo\\fi{\\lettrine[lines=#1]{#2}{}}{#2}}',
    );
  }
  out.push(
    '\\NewDocumentEnvironment{uslub}{m}{%',
    '  \\par\\@ifundefined{sahifa@p@#1}{\\PackageWarning{sahifa}{No paragraph style #1}}{}%',
    '  \\csname sahifa@pb@#1\\endcsname\\csname sahifa@p@#1\\endcsname',
    '  \\@ifundefined{sahifa@pd@#1}{\\ignorespaces}{\\csname sahifa@pd@#1\\endcsname}',
    '}{%',
    '  \\par\\csname sahifa@pk@#1\\endcsname\\csname sahifa@pa@#1\\endcsname',
    '}',
  );
  // Character styles.
  for (const c of spec.characterStyles) out.push(`\\@namedef{sahifa@c@${c.id}}{${characterSetup(c, fontMacro)}}`);
  out.push(
    '\\NewDocumentCommand\\matnuslubi{m+m}{%',
    '  \\@ifundefined{sahifa@c@#1}{\\PackageWarning{sahifa}{No character style #1}#2}{{\\csname sahifa@c@#1\\endcsname #2}}}',
  );

  // Heading styles change the look of the sectioning commands; the head ornament goes under level 1.
  const headings = spec.paragraphStyles.filter((p) => p.heading);
  const head = spec.chapterHeadOrnament;
  if (head === 'fleuron' || spec.chapterEndOrnament === 'fleuron') out.push('\\RequirePackage{pifont}');
  // titlesec's after-code is not \long: \endgraf, not \par.
  const ornament = head ? `\\endgraf\\nobreak\\vspace{4pt}{\\centering\\normalfont ${ORNAMENT_LATEX[head]}\\endgraf}` : '';
  // After-code of a heading: the ornament under level 1, and the grid alignment when snapping.
  const afterCode = (level1: boolean) => {
    const code = (level1 ? ornament : '') + (snap ? '\\sahifa@gridalign' : '');
    return code ? `[${code}]` : '';
  };
  const headAfter = afterCode(true);
  if (headings.length || head) {
    out.push('\\RequirePackage{titlesec}');
    const level = (h: number, withChapter: boolean) =>
      withChapter ? ['', 'chapter', 'section', 'subsection'][h]! : ['', 'section', 'subsection', 'subsubsection'][h]!;
    for (const withChapter of [true, false]) {
      out.push(withChapter ? '\\@ifundefined{chapter}{}{%' : '\\@ifundefined{chapter}{%');
      for (const h of headings) {
        const p = resolveParagraphStyle(spec, h.id);
        const cmd = level(h.heading!, withChapter);
        const label = cmd === 'chapter' ? '\\thechapter.' : `\\the${cmd}`;
        out.push(`  \\titleformat{\\${cmd}}[hang]{${headingFormat(p, fontMacro, snap)}}{${label}}{0.6em}{}${afterCode(h.heading === 1)}%`);
        const before = p.spaceBefore ?? (cmd === 'chapter' ? 0 : 12);
        const after = p.spaceAfter ?? (cmd === 'chapter' ? 24 : 6);
        // titlesec reads the spaces with calc, which cannot take \\dimexpr: snapped values are
        // worked out at \\begin{document}, once the grid (the body's \\baselineskip) is known.
        out.push(
          snap
            ? `  \\AtBeginDocument{\\edef\\sahifa@tmp{\\noexpand\\titlespacing*{\\noexpand\\${cmd}}{${mm(p.leftIndent ?? 0)}}{\\the${space(before, true)}}{\\the${space(after, true)}}}\\sahifa@tmp}%`
            : `  \\titlespacing*{\\${cmd}}{${mm(p.leftIndent ?? 0)}}{${pt(before)}}{${pt(after)}}%`,
        );
      }
      // No style for level 1: the class's own look, with the ornament under it.
      if (head && !headings.some((h) => h.heading === 1)) {
        out.push(
          withChapter
            ? `  \\titleformat{\\chapter}[display]{\\normalfont\\huge\\bfseries}{\\chaptertitlename\\ \\thechapter}{20pt}{\\Huge}${headAfter}%`
            : `  \\titleformat{\\section}{\\normalfont\\Large\\bfseries}{\\thesection}{1em}{}${headAfter}%`,
        );
      }
      out.push(withChapter ? '}' : '}{}');
    }
  }
  // Chapter-end ornament: before each chapter after the first numbered one, and at the end of the book.
  if (spec.chapterEndOrnament) {
    out.push(
      `\\newcommand\\bobbezagi{\\par\\nobreak\\bigskip{\\centering ${ORNAMENT_LATEX[spec.chapterEndOrnament]}\\par}\\bigskip}`,
      '\\@ifundefined{chapter}{%',
      '  \\AddToHook{cmd/section/before}{\\ifnum\\c@section>0 \\bobbezagi\\fi}%',
      '  \\AddToHook{enddocument}{\\ifnum\\c@section>0 \\bobbezagi\\fi}%',
      '}{%',
      '  \\AddToHook{cmd/chapter/before}{\\ifnum\\c@chapter>0 \\bobbezagi\\fi}%',
      '  \\AddToHook{enddocument}{\\ifnum\\c@chapter>0 \\bobbezagi\\fi}%',
      '}',
    );
  }
  out.push('\\endinput', '');
  return out.join('\n');
}

/** The model from a sahifa.sty (null when there is none or it is broken). */
export function readPageDesign(sty: string): PageDesignSpec | null {
  const json = jsonFromCommentLines(MARK, sty);
  if (!json) return null;
  try {
    return normalizePageDesign(JSON.parse(json));
  } catch {
    return null;
  }
}

/** Main file text with \usepackage{sahifa} before \begin{document} (after dizayn); null if already there or no body. */
export function withPageDesignPackage(main: string): string | null {
  if (/^[^%\n]*\\usepackage(\[[^\]]*\])?\{sahifa\}/m.test(main)) return null;
  const m = /^[ \t]*\\begin\{document\}/m.exec(main);
  if (!m) return null;
  return `${main.slice(0, m.index)}\\usepackage{sahifa} % Oversells sahifa dizayni (sahifa.sty)\n${main.slice(m.index)}`;
}

// --- applying styles in the code --------------------------------------------------------------

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

/** Lines that are not paragraph text: environments, headings, page breaks, comments. */
const STRUCTURE =
  /^\s*(%|\\(begin|end)\{[^}]*\}\s*(\[[^\]]*\]|\{[^}]*\})*\s*(%.*)?$|\\(part|chapter|section|subsection|subsubsection|paragraph|maketitle|tableofcontents|input|include|clearpage|cleardoublepage|newpage|bosbet|sahifausta|item)\b)/;

/** Styles go into the document text only: not the preamble of a main file, not after \end{document}. */
function requireBody(text: string, lo: number, hi: number): void {
  const begin = indexOutsideComments(text, '\\begin{document}');
  if (begin === -1) return; // a chapter file (\input): all of it is text
  const end = indexOutsideComments(text, '\\end{document}', begin);
  if (lo < begin + '\\begin{document}'.length || (end !== -1 && hi > end)) {
    throw new PageDesignError('Put the cursor into the text of the document', 'notInBody');
  }
}

/**
 * Puts the paragraphs touched by [from, to) into \begin{uslub}{id}...\end{uslub}.
 * When they already are exactly one styled block, only its style changes.
 */
export function applyParagraphStyle(text: string, from: number, to: number, styleId: string): TextEdit[] {
  if (!ID.test(styleId)) throw new PageDesignError('Unknown style', 'unknownStyle');
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  requireBody(text, lo, hi);
  // Already inside \begin{uslub}{x} ... \end{uslub} that starts the paragraph: change x.
  const before = text.slice(0, lo);
  const open = before.lastIndexOf('\\begin{uslub}{');
  if (open !== -1) {
    const close = text.indexOf('\\end{uslub}', open);
    if (close !== -1 && close >= hi) {
      const m = /^\\begin\{uslub\}\{([a-z][a-z0-9]*)\}/.exec(text.slice(open));
      if (m) return [{ from: open + 14, to: open + 14 + m[1]!.length, insert: styleId }];
    }
  }
  // Paragraph bounds: blank lines and lines that are not text (\begin{..}, \end{..}, headings, comments).
  const lines: { from: number; to: number; text: string }[] = [];
  for (let pos = 0; pos <= text.length; ) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    lines.push({ from: pos, to: end, text: text.slice(pos, end) });
    if (nl === -1) break;
    pos = nl + 1;
  }
  const lineAt = (offset: number) => lines.findIndex((l) => offset >= l.from && offset <= l.to);
  const isText = (l: { text: string }) => l.text.trim() !== '' && !STRUCTURE.test(l.text);
  let first = lineAt(lo);
  let last = lineAt(hi);
  // A selection may start or end on a boundary line: shrink to the text lines inside it.
  while (first < last && !isText(lines[first]!)) first++;
  while (last > first && !isText(lines[last]!)) last--;
  if (first === -1 || !isText(lines[first]!)) throw new PageDesignError('No paragraph is selected', 'noParagraph');
  while (first > 0 && isText(lines[first - 1]!)) first--;
  while (last < lines.length - 1 && isText(lines[last + 1]!)) last++;
  const start = lines[first]!.from;
  const end = lines[last]!.to;
  return [
    { from: start, to: start, insert: `\\begin{uslub}{${styleId}}\n` },
    { from: end, to: end, insert: `\n\\end{uslub}` },
  ];
}

/** Wraps [from, to) into \matnuslubi{id}{...}; the selection must be text of one paragraph with balanced braces. */
export function applyCharacterStyle(text: string, from: number, to: number, styleId: string): TextEdit[] {
  if (!ID.test(styleId)) throw new PageDesignError('Unknown style', 'unknownStyle');
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  requireBody(text, lo, hi);
  const sel = text.slice(lo, hi);
  if (!sel.trim()) throw new PageDesignError('Select some text first', 'noSelection');
  if (/\n[ \t]*\n/.test(sel)) throw new PageDesignError('Select text inside one paragraph', 'oneParagraph');
  let depth = 0;
  for (let i = 0; i < sel.length; i++) {
    if (sel[i] === '\\') i++;
    else if (sel[i] === '{') depth++;
    else if (sel[i] === '}' && --depth < 0) break;
  }
  if (depth !== 0) throw new PageDesignError('The selection cuts a {...} group', 'brokenGroup');
  return [
    { from: lo, to: lo, insert: `\\matnuslubi{${styleId}}{` },
    { from: hi, to: hi, insert: '}' },
  ];
}

// --- visual editor: layout from the log, frame keys in the source ------------------------------

/** TeX points to PDF points (bp). */
const ptToBp = (v: number) => (v * 72) / 72.27;

export interface LayoutFrame {
  /** Order of the fixed frames in the document (1, 2, ...). */
  n: number;
  /** Source file and line of the \rasmramka. */
  file: string;
  line: number;
  page: number;
  /** PDF points from the top-left corner of the paper (the trimmed page). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageLayout {
  /** The trimmed page, PDF points. */
  paper: { w: number; h: number };
  /** The text block. */
  text: { w: number; h: number };
  /** From the left edge of the PDF page to the text block on odd and even pages, and from its top. */
  oddLeft: number;
  evenLeft: number;
  top: number;
  twoside: boolean;
  /** Baseline grid of the body text: the first baseline below the top of the text block, then every `step`. */
  baseline?: { first: number; step: number };
  frames: LayoutFrame[];
}

/** What sahifa.sty wrote into the log (OVS-G1/G2 for the page, OVS-FL/FP for fixed frames); null without it. */
export function parsePageLayout(log: string): PageLayout | null {
  const num = (s: string) => ptToBp(Number(s.replace(/pt$/, '')));
  // The stored log can hold several LaTeX runs (latexmk): the last one is the final layout.
  const last = (re: RegExp) => [...log.matchAll(re)].pop();
  const g1 = last(/^OVS-G1:([\d.]+pt);([\d.]+pt);([\d.]+pt);([\d.]+pt)\s*$/gm);
  const g2 = last(/^OVS-G2:(-?[\d.]+pt);(-?[\d.]+pt);(-?[\d.]+pt);([01])\s*$/gm);
  if (!g1 || !g2) return null;
  const where = new Map<number, { file: string; line: number }>();
  for (const m of log.matchAll(/^OVS-FL:(\d+);(\d+);(.+?)\s*$/gm)) where.set(Number(m[1]), { file: m[3]!, line: Number(m[2]) });
  const frames = new Map<number, LayoutFrame>();
  for (const m of log.matchAll(/^OVS-FP:(\d+);(\d+);(-?[\d.]+pt);(-?[\d.]+pt);([\d.]+pt);([\d.]+pt)\s*$/gm)) {
    const n = Number(m[1]);
    const at = where.get(n);
    if (!at) continue;
    frames.set(n, { n, ...at, page: Number(m[2]), x: num(m[3]!), y: num(m[4]!), w: num(m[5]!), h: num(m[6]!) });
  }
  const g3 = last(/^OVS-G3:([\d.]+pt);([\d.]+pt)\s*$/gm);
  return {
    ...(g3 && Number(g3[1]!.replace('pt', '')) > 0 ? { baseline: { first: num(g3[2]!), step: num(g3[1]!) } } : {}),
    paper: { w: num(g1[1]!), h: num(g1[2]!) },
    text: { w: num(g1[3]!), h: num(g1[4]!) },
    oddLeft: num(g2[1]!),
    evenLeft: num(g2[2]!),
    top: num(g2[3]!),
    twoside: g2[4] === '1',
    frames: [...frames.values()],
  };
}

/**
 * Sets keys of the \rasmramka that ends on `line` (1-based; TeX reports the line where the
 * command's last argument ends): `{ x: '30mm' }` replaces or adds x=30mm, other keys and the
 * rest of the text stay as written. Null when there is no such frame.
 */
export function setFrameKeys(
  text: string,
  line: number,
  changes: Record<string, string>,
  opts: { fixedOnly?: boolean } = {},
): string | null {
  const lines = text.split('\n');
  if (line < 1 || line > lines.length) return null;
  const endOfLine = lines.slice(0, line).join('\n').length;
  // A picture frame, or a text box (TeX reports the line of its \end{matnquti}).
  // fixedOnly (dragging in visual mode): only a frame fixed on the page; a frame in the flow (an
  // inner one in a text box, or one the line number of an older compile now points at) is skipped.
  let frame = text.lastIndexOf('\\rasmramka', endOfLine);
  while (opts.fixedOnly && frame !== -1 && !/^\[[^\]]*\bjoy\s*=\s*sahifa\b/.test(text.slice(frame + '\\rasmramka'.length, frame + 400))) {
    frame = frame === 0 ? -1 : text.lastIndexOf('\\rasmramka', frame - 1);
  }
  const box = text.lastIndexOf('\\begin{matnquti}', endOfLine);
  const at = Math.max(frame, box);
  const head = at === box ? '\\begin{matnquti}' : '\\rasmramka';
  if (at === -1 || text.slice(at, endOfLine).split('\n').length > 60) return null;
  let i = at + head.length;
  const pairs: [string, string][] = [];
  let open = -1;
  let close = -1;
  if (text[i] === '[') {
    open = i;
    let depth = 0;
    for (let j = i + 1; j < text.length; j++) {
      const c = text[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === ']' && depth === 0) {
        close = j;
        break;
      }
    }
    if (close === -1) return null;
    // key=value items, split at commas outside braces.
    const body = text.slice(open + 1, close);
    let braces = 0;
    let from = 0;
    for (let j = 0; j <= body.length; j++) {
      const c = body[j];
      if (c === '{') braces++;
      else if (c === '}') braces--;
      if (j === body.length || (c === ',' && braces === 0)) {
        const item = body.slice(from, j).trim();
        if (item) {
          const eq = item.indexOf('=');
          pairs.push(eq === -1 ? [item, ''] : [item.slice(0, eq).trim(), item.slice(eq + 1).trim()]);
        }
        from = j + 1;
      }
    }
    i = close + 1;
  }
  for (const [key, value] of Object.entries(changes)) {
    if (!/^[a-z]+$/.test(key) || /[,\]\\{}%]/.test(value)) return null;
    const found = pairs.find((p) => p[0] === key);
    if (found) found[1] = value;
    else pairs.push([key, value]);
  }
  const options = `[${pairs.map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join(',')}]`;
  return open === -1 ? text.slice(0, i) + options + text.slice(i) : text.slice(0, open) + options + text.slice(close + 1);
}

// --- merging styles (e.g. Word styles after an import onto the book's own) --------------------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text with every use of style `from` changed to `to`, and how many there were. */
export function mergeStyleInText(text: string, kind: 'paragraph' | 'character', from: string, to: string): { text: string; count: number } {
  const re =
    kind === 'paragraph'
      ? new RegExp(`(\\\\begin\\{uslub\\}\\s*\\{)${escapeRe(from)}(\\})`, 'g')
      : new RegExp(`(\\\\matnuslubi\\s*\\{)${escapeRe(from)}(\\})`, 'g');
  let count = 0;
  const out = text.replace(re, (_m, a: string, b: string) => {
    count++;
    return `${a}${to}${b}`;
  });
  return { text: out, count };
}

/** The design without style `from`; styles based on it are based on `to` instead. */
export function mergeStyleInDesign(raw: PageDesignSpec, kind: 'paragraph' | 'character', from: string, to: string): PageDesignSpec {
  const spec = normalizePageDesign(raw);
  if (from === to) fail('a style cannot be merged into itself');
  if (kind === 'paragraph') {
    const a = spec.paragraphStyles.find((p) => p.id === from);
    const b = spec.paragraphStyles.find((p) => p.id === to);
    if (!a || !b) fail(`no paragraph style ${a ? to : from}`);
    if (a!.heading || b!.heading) fail('heading styles format the sectioning commands and are not merged');
    spec.paragraphStyles = spec.paragraphStyles
      .filter((p) => p.id !== from)
      .map((p) => (p.basedOn === from ? clean({ ...p, basedOn: p.id === to ? undefined : to }) : p));
  } else {
    if (!spec.characterStyles.some((c) => c.id === from) || !spec.characterStyles.some((c) => c.id === to)) fail('no such character style');
    spec.characterStyles = spec.characterStyles.filter((c) => c.id !== from);
  }
  return normalizePageDesign(spec);
}

// --- styles applied on the PDF (visual mode) ----------------------------------------------------

const APOSTROPHES = "'ʻʼ‘’`´";
const escapeChar = (c: string) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Where text selected on the PDF is in the source: searched near `line` (from SyncTeX) in `text`.
 * The PDF has no hyphens of broken words, single spaces for line breaks and ~, and may show
 * another apostrophe than the source (ʻ for '); the selection must be plain text of the
 * source (no commands inside it). The match nearest to the line wins; null when none.
 */
export function findSelectionInSource(text: string, line: number, selected: string): { from: number; to: number } | null {
  const clean = selected
    .normalize('NFKC') // ligatures (ﬁ) as plain letters
    .replace(/­/g, '')
    .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean || clean.length > 2000) return null;
  const pattern = [...clean]
    .map((c) => (c === ' ' ? '(?:[\\s~]|\\\\[ ,;:])+' : APOSTROPHES.includes(c) ? `[${escapeChar(APOSTROPHES)}]` : escapeChar(c) + '(?:\\\\-)?'))
    .join('');
  const re = new RegExp(pattern, 'gu');
  // Offsets of the lines, to measure how far a match is from the SyncTeX line.
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  const lineOf = (pos: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  let best: { from: number; to: number; d: number } | null = null;
  for (const m of text.matchAll(re)) {
    const from = m.index!;
    // Not inside a comment.
    const lineStart = starts[lineOf(from) - 1]!;
    if (/(^|[^\\])%/.test(text.slice(lineStart, from))) continue;
    const d = Math.abs(lineOf(from) - line);
    if (d > 40) continue;
    if (!best || d < best.d) best = { from, to: from + m[0].length, d };
  }
  return best ? { from: best.from, to: best.to } : null;
}
