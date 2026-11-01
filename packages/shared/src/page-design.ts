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
}

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
const FONT = /^[\p{L}\p{N} ._\-/]{1,80}$/u;
const SLOT_KINDS: SlotKind[] = ['empty', 'page', 'chapter', 'section', 'title', 'text'];
const ALIGNS: Align[] = ['justify', 'left', 'right', 'center'];
const NUMBERINGS: PageNumbering[] = ['arabic', 'roman', 'Roman'];

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
    return {
      id: id(m.id, w),
      name: str(m.name ?? m.id, w, 60),
      odd: side(m.odd, `${w}.odd`),
      even: side(m.even ?? m.odd, `${w}.even`),
      headRule: bool(m.headRule, w) ?? false,
      numbering,
    };
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
  return text.replace(/[\\{}$&#^_%~]/g, (c) =>
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

/** Commands that set up a paragraph style inside its group. */
function paragraphSetup(p: ParagraphStyle, fontMacro: FontMacro): string {
  const out: string[] = [];
  if (p.font) out.push(`\\sahifa@iffonts{${fontMacro(p.font)}}`);
  if (p.size || p.leading) {
    const size = p.size ?? 10;
    out.push(`\\fontsize{${pt(size)}}{${pt(p.leading ?? Math.round(size * 1.2 * 10) / 10)}}\\selectfont`);
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
  if (p.parSkip !== undefined) out.push(`\\parskip=${pt(p.parSkip)}`);
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

/** Font settings of a heading style as titlesec format commands. */
function headingFormat(p: ParagraphStyle, fontMacro: FontMacro): string {
  const out: string[] = ['\\normalfont'];
  if (p.font) out.push(`\\sahifa@iffonts{${fontMacro(p.font)}}`);
  const size = p.size ?? [0, 20, 15, 12][p.heading ?? 1]!;
  out.push(`\\fontsize{${pt(size)}}{${pt(p.leading ?? Math.round(size * 1.2 * 10) / 10)}}\\selectfont`);
  if (p.bold !== false) out.push('\\bfseries');
  if (p.italic) out.push('\\itshape');
  if (p.color) out.push(`\\color[HTML]{${p.color}}`);
  if (p.align === 'center') out.push('\\filcenter');
  else if (p.align === 'right') out.push('\\filleft');
  return out.join('');
}

/** The model as comment lines (JSON, split into short lines). */
function modelComment(spec: PageDesignSpec): string {
  const json = JSON.stringify(spec);
  const lines: string[] = [];
  for (let i = 0; i < json.length; i += 100) lines.push(MARK + json.slice(i, i + 100));
  return lines.join('\n');
}

/**
 * \rasmramka[keys]{file}{caption}: a picture frame.
 *   joy=oqim     in the text flow, centred (default)
 *   joy=oralash  beside the text, which flows around it (wrapfig); tomon=chap|ong
 *   joy=sahifa   at x, y from the top-left corner of the page, over the text
 *   joy=tola     a whole page, to the edges and `bleed` beyond them (cover-fills, crops the rest)
 *   en=<width>, kesish=<left bottom right top> (trim, the file is not changed), id=<name>
 */
const FRAMES = String.raw`\RequirePackage{graphicx}
\RequirePackage{wrapfig}
\RequirePackage{eso-pic}
\RequirePackage{keyval}
\RequirePackage{tikz}
\RequirePackage{zref-abspage}
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
\def\sahifa@ram@oqim#1#2{\par\begin{center}%
  \sahifa@img{#1}{\ifx\sahifa@r@en\@empty\linewidth\else\sahifa@r@en\fi}\sahifa@caption{#2}\end{center}}
\def\sahifa@ram@oralash#1#2{\edef\sahifa@w{\ifx\sahifa@r@en\@empty 0.4\noexpand\linewidth\else\sahifa@r@en\fi}%
  \begin{wrapfigure}{\sahifa@r@side}{\sahifa@w}\centering\sahifa@img{#1}{\sahifa@w}\sahifa@caption{#2}\end{wrapfigure}}
% A frame fixed on the page: a zref label marks the page it is on (known from the previous
% run; latexmk runs again), and the picture is drawn when exactly that page is shipped out.
\newcounter{sahifa@ram}
\def\sahifa@ram@sahifa#1#2{\edef\sahifa@w{\ifx\sahifa@r@en\@empty 50mm\else\sahifa@r@en\fi}%
  \stepcounter{sahifa@ram}%
  \edef\sahifa@lbl{sahifa@ram@\arabic{sahifa@ram}}%
  \zref@labelbyprops{\sahifa@lbl}{abspage}%
  \edef\sahifa@tmp{\noexpand\AddToShipoutPictureFG{%
    \noexpand\ifnum\noexpand\value{abspage}=\noexpand\zref@extractdefault{\sahifa@lbl}{abspage}{0}\relax
    \noexpand\AtPageUpperLeft{%
    \noexpand\put(\noexpand\LenToUnit{\sahifa@r@x},\noexpand\LenToUnit{-\sahifa@r@y}){%
      \noexpand\makebox(0,0)[tl]{\noexpand\parbox[t]{\sahifa@w}{%
        \noexpand\includegraphics[\sahifa@r@gopts width=\sahifa@w]{#1}\noexpand\sahifa@caption{\unexpanded{#2}}}}}}\noexpand\fi}}%
  \sahifa@tmp}
\def\sahifa@ram@tola#1#2{\clearpage
  \@tempdima=\paperwidth \advance\@tempdima\sahifa@r@bleed \advance\@tempdima\sahifa@r@bleed
  \@tempdimb=\paperheight \advance\@tempdimb\sahifa@r@bleed \advance\@tempdimb\sahifa@r@bleed
  \edef\sahifa@tmp{\noexpand\AddToShipoutPictureBG*{\noexpand\AtPageCenter{\noexpand\makebox(0,0){%
    \noexpand\sahifa@cover{#1}{\the\@tempdima}{\the\@tempdimb}}}}}%
  \sahifa@tmp\thispagestyle{empty}\null\clearpage}
\NewDocumentCommand\rasmramka{O{}mm}{\begingroup
  \def\sahifa@r@joy{oqim}\let\sahifa@r@en\@empty\def\sahifa@r@x{0mm}\def\sahifa@r@y{0mm}%
  \let\sahifa@r@kesish\@empty\def\sahifa@r@bleed{3mm}\def\sahifa@r@side{r}\let\sahifa@r@id\@empty
  \setkeys{sahifa@ram}{#1}%
  \edef\sahifa@r@gopts{\ifx\sahifa@r@kesish\@empty\else trim=\sahifa@r@kesish,clip,\fi}%
  \@ifundefined{sahifa@ram@\sahifa@r@joy}{\PackageWarning{sahifa}{Unknown frame mode \sahifa@r@joy}\sahifa@ram@oqim{#2}{#3}}%
    {\csname sahifa@ram@\sahifa@r@joy\endcsname{#2}{#3}}%
  \endgroup}`;

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
    '  \\@ifundefined{ps@sahifa@#1}{\\PackageWarning{sahifa}{No master page #1}}{\\pagestyle{sahifa@#1}}}',
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
      '  \\hbox{}\\thispagestyle{empty}\\newpage\\if@twocolumn\\hbox{}\\newpage\\fi\\fi\\fi}',
    );
  }
  out.push('\\newcommand\\bosbet{\\clearpage\\hbox{}\\thispagestyle{empty}\\clearpage}');
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
  out.push(FRAMES);

  // Paragraph styles.
  const body = spec.paragraphStyles.filter((p) => !p.heading);
  for (const s of body) {
    const p = resolveParagraphStyle(spec, s.id);
    out.push(`\\@namedef{sahifa@p@${p.id}}{${paragraphSetup(p, fontMacro)}}`);
    out.push(`\\@namedef{sahifa@pb@${p.id}}{${p.spaceBefore ? `\\addvspace{${pt(p.spaceBefore)}}` : ''}}`);
    out.push(`\\@namedef{sahifa@pa@${p.id}}{${p.spaceAfter ? `\\addvspace{${pt(p.spaceAfter)}}` : ''}}`);
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
    '\\NewDocumentCommand\\matnuslubi{mm}{%',
    '  \\@ifundefined{sahifa@c@#1}{\\PackageWarning{sahifa}{No character style #1}#2}{{\\csname sahifa@c@#1\\endcsname #2}}}',
  );

  // Heading styles change the look of the sectioning commands.
  const headings = spec.paragraphStyles.filter((p) => p.heading);
  if (headings.length) {
    out.push('\\RequirePackage{titlesec}');
    const level = (h: number, withChapter: boolean) =>
      withChapter ? ['', 'chapter', 'section', 'subsection'][h]! : ['', 'section', 'subsection', 'subsubsection'][h]!;
    for (const withChapter of [true, false]) {
      out.push(withChapter ? '\\@ifundefined{chapter}{}{%' : '\\@ifundefined{chapter}{%');
      for (const h of headings) {
        const p = resolveParagraphStyle(spec, h.id);
        const cmd = level(h.heading!, withChapter);
        const label = cmd === 'chapter' ? '\\thechapter.' : `\\the${cmd}`;
        out.push(`  \\titleformat{\\${cmd}}[hang]{${headingFormat(p, fontMacro)}}{${label}}{0.6em}{}%`);
        const before = p.spaceBefore ?? (cmd === 'chapter' ? 0 : 12);
        const after = p.spaceAfter ?? (cmd === 'chapter' ? 24 : 6);
        out.push(`  \\titlespacing*{\\${cmd}}{${mm(p.leftIndent ?? 0)}}{${pt(before)}}{${pt(after)}}%`);
      }
      out.push(withChapter ? '}' : '}{}');
    }
  }
  out.push('\\endinput', '');
  return out.join('\n');
}

/** The model from a sahifa.sty (null when there is none or it is broken). */
export function readPageDesign(sty: string): PageDesignSpec | null {
  const json = sty
    .split('\n')
    .filter((l) => l.startsWith(MARK))
    .map((l) => l.slice(MARK.length))
    .join('');
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
