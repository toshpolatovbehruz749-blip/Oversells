import { escapeLatex, jsonCommentLines, jsonFromCommentLines } from './page-design.js';
import { PRINT_FORMATS, ean13Tikz, isbnDigits } from './print.js';
import type { PreflightCheck } from './preflight.js';

/**
 * «Muqova»: the book cover as one spread (back cover, spine, front cover) in
 * its own file, muqova.tex, compiled into its own PDF. The spine width comes
 * from the page count and the paper; the model is kept in comment lines at the
 * top of muqova.tex, the LaTeX below it is generated (like sahifa.sty).
 */

export const COVER_FILE = 'muqova.tex';
const MARK = '% oversells-muqova: ';

export type PaperKind = 'gazeta' | 'ofset' | 'borYaltiroq' | 'borXira' | 'kitob';
export interface Paper {
  id: string;
  kind: PaperKind;
  /** g/m². */
  gsm: number;
  /** Thickness of one sheet (two pages), mm. Typical values: ask the printing house for theirs. */
  thickness: number;
}

const paper = (kind: PaperKind, gsm: number, thickness: number): Paper => ({ id: `${kind}-${gsm}`, kind, gsm, thickness });
/** Common papers with typical thicknesses (they differ between mills by about ±10 %). */
export const PAPERS: Paper[] = [
  paper('gazeta', 45, 0.065),
  paper('gazeta', 49, 0.07),
  paper('ofset', 60, 0.075),
  paper('ofset', 65, 0.08),
  paper('ofset', 70, 0.09),
  paper('ofset', 80, 0.1),
  paper('ofset', 90, 0.11),
  paper('ofset', 100, 0.12),
  paper('ofset', 120, 0.145),
  paper('borYaltiroq', 90, 0.075),
  paper('borYaltiroq', 100, 0.08),
  paper('borYaltiroq', 115, 0.09),
  paper('borYaltiroq', 130, 0.105),
  paper('borYaltiroq', 150, 0.12),
  paper('borYaltiroq', 170, 0.14),
  paper('borXira', 90, 0.085),
  paper('borXira', 100, 0.09),
  paper('borXira', 115, 0.1),
  paper('borXira', 130, 0.115),
  paper('borXira', 150, 0.135),
  paper('borXira', 170, 0.155),
  paper('kitob', 60, 0.108),
  paper('kitob', 70, 0.126),
  paper('kitob', 80, 0.144),
];

/** yelim: soft cover, glued (perfect binding); skoba: stapled through the fold; qattiq: hard cover on boards. */
export type Binding = 'yelim' | 'skoba' | 'qattiq';
export const BINDINGS: Binding[] = ['yelim', 'skoba', 'qattiq'];

export interface CoverSpec {
  version: 1;
  /** A PRINT_FORMATS id, or 'custom' with width and height. */
  format: string;
  width?: number;
  height?: number;
  pages: number;
  paper: string;
  /** Overrides the paper's thickness (mm per sheet), e.g. the value the printing house gave. */
  thickness?: number;
  binding: Binding;
  /** Soft covers: bleed beyond the trim, mm. */
  bleed: number;
  title: string;
  subtitle?: string;
  author?: string;
  publisher?: string;
  /** Back cover text; an empty line starts a new paragraph. */
  back?: string;
  isbn?: string;
  /** RRGGBB. */
  frontColor: string;
  spineColor: string;
  backColor: string;
  textColor: string;
  /** Pictures of the project, cover-filled into the front / back panel (to the bleed). */
  frontImage?: string;
  backImage?: string;
  cmyk?: boolean;
}

export class CoverError extends Error {}
const fail = (msg: string): never => {
  throw new CoverError(msg);
};

const COLOR = /^[0-9A-Fa-f]{6}$/;
const PICTURE = /^(?!\/)(?!.*\.\.)[\p{L}\p{N}._\-/]{1,160}\.(png|jpe?g|pdf)$/iu;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, what: string, max: number): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') return fail(`${what}: text expected`);
  if (v.length > max) fail(`${what}: at most ${max} characters`);
  return v;
};
const number = (v: unknown, what: string, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(`${what}: a number from ${min} to ${max}`);
  return v as number;
};
const colour = (v: unknown, what: string, fallback: string): string => {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v !== 'string' || !COLOR.test(v)) fail(`${what}: RRGGBB`);
  return (v as string).toUpperCase();
};
const picture = (v: unknown, what: string): string | undefined => {
  const p = text(v, what, 160);
  if (p !== undefined && !PICTURE.test(p)) fail(`${what}: a picture of the project expected (png, jpg, pdf)`);
  return p;
};

export function defaultCover(title = ''): CoverSpec {
  return {
    version: 1,
    format: 'a5',
    pages: 160,
    paper: 'ofset-70',
    binding: 'yelim',
    bleed: 3,
    title: title.slice(0, 200),
    frontColor: '1F3A5F',
    spineColor: '1F3A5F',
    backColor: '1F3A5F',
    textColor: 'FFFFFF',
  };
}

/** Checks and cleans a cover from the client or a file; throws CoverError. */
export function normalizeCover(raw: unknown): CoverSpec {
  if (!isObj(raw) || raw.version !== 1) return fail('cover: version 1 expected');
  const format = typeof raw.format === 'string' ? raw.format : '';
  if (format !== 'custom' && !PRINT_FORMATS.some((f) => f.id === format)) fail('cover: unknown format');
  const binding = raw.binding as Binding;
  if (!BINDINGS.includes(binding)) fail('cover: unknown binding');
  const paperId = typeof raw.paper === 'string' ? raw.paper : '';
  if (!PAPERS.some((p) => p.id === paperId)) fail('cover: unknown paper');
  const spec: CoverSpec = {
    version: 1,
    format,
    pages: Math.round(number(raw.pages, 'pages', 4, 2000)),
    paper: paperId,
    binding,
    bleed: number(raw.bleed ?? 3, 'bleed', 0, 10),
    title: text(raw.title, 'title', 200) ?? '',
    frontColor: colour(raw.frontColor, 'frontColor', '1F3A5F'),
    spineColor: colour(raw.spineColor, 'spineColor', '1F3A5F'),
    backColor: colour(raw.backColor, 'backColor', '1F3A5F'),
    textColor: colour(raw.textColor, 'textColor', 'FFFFFF'),
  };
  if (format === 'custom') {
    spec.width = number(raw.width, 'width', 50, 500);
    spec.height = number(raw.height, 'height', 50, 500);
  }
  if (raw.thickness !== undefined && raw.thickness !== null) spec.thickness = number(raw.thickness, 'thickness', 0.03, 0.5);
  const optional: [keyof CoverSpec, string | undefined][] = [
    ['subtitle', text(raw.subtitle, 'subtitle', 300)],
    ['author', text(raw.author, 'author', 200)],
    ['publisher', text(raw.publisher, 'publisher', 200)],
    ['back', text(raw.back, 'back', 3000)],
    ['frontImage', picture(raw.frontImage, 'frontImage')],
    ['backImage', picture(raw.backImage, 'backImage')],
  ];
  for (const [k, v] of optional) if (v !== undefined) (spec as unknown as Record<string, unknown>)[k] = v;
  const isbn = text(raw.isbn, 'isbn', 20);
  if (isbn !== undefined) {
    if (!isbnDigits(isbn)) fail('isbn: not a valid ISBN-13');
    spec.isbn = isbn.trim();
  }
  if (raw.cmyk === true) spec.cmyk = true;
  return spec;
}

export type CoverWarning = 'spineTooThin' | 'staplePages' | 'stapleTooThick' | 'gluedTooThin';

/** The cover spread, mm. x from the left edge of the PDF page, y from its top. */
export interface CoverGeometry {
  trim: { w: number; h: number };
  /** Thickness of one sheet used. */
  sheet: number;
  spine: number;
  /** Width and height of one cover panel (a board for hard covers). */
  panel: { w: number; h: number };
  /** Hard covers: the joint between board and spine. */
  hinge: number;
  /** Bleed (soft) or turn-in (hard) around the panels. */
  edge: number;
  /** Area for the crop marks around everything. */
  slug: number;
  page: { w: number; h: number };
  /** Left edges of the back panel, the spine and the front panel, and the top of the panels. */
  back: number;
  spineX: number;
  front: number;
  top: number;
  warnings: CoverWarning[];
}

const round1 = (v: number) => Math.round(v * 10) / 10;
/** Hard covers: board thickness and the overhang of the boards past the book block (typical). */
const BOARD = 2.5;
const OVERHANG = 3;

export function coverGeometry(spec: CoverSpec): CoverGeometry {
  const f = PRINT_FORMATS.find((x) => x.id === spec.format);
  const trim = { w: f?.width ?? spec.width ?? 148, h: f?.height ?? spec.height ?? 210 };
  const sheet = spec.thickness ?? PAPERS.find((p) => p.id === spec.paper)?.thickness ?? 0.1;
  const block = Math.ceil(spec.pages / 2) * sheet;
  const warnings: CoverWarning[] = [];
  let spine: number;
  let panel = { ...trim };
  let hinge = 0;
  let edge = spec.bleed;
  if (spec.binding === 'skoba') {
    spine = 0;
    if (spec.pages % 4) warnings.push('staplePages');
    if (spec.pages > 64) warnings.push('stapleTooThick');
  } else if (spec.binding === 'qattiq') {
    spine = round1(block + 2 * BOARD + 1);
    panel = { w: trim.w + OVERHANG, h: trim.h + 2 * OVERHANG };
    hinge = 7;
    edge = 15;
  } else {
    // The cover card adds a little on both sides of the spine.
    spine = round1(block + 0.5);
    if (spec.pages < 32) warnings.push('gluedTooThin');
  }
  if (spec.binding !== 'skoba' && spine < 6) warnings.push('spineTooThin');
  const slug = 12;
  const back = slug + edge;
  const spineX = back + panel.w + hinge;
  const front = spineX + spine + hinge;
  return {
    trim,
    sheet,
    spine,
    panel,
    hinge,
    edge,
    slug,
    page: { w: round1(front + panel.w + edge + slug), h: round1(slug + edge + panel.h + edge + slug) },
    back,
    spineX,
    front,
    top: slug + edge,
    warnings,
  };
}

const mm = (v: number) => `${round1(v)}mm`;
const paragraphs = (s: string) =>
  s
    .split(/\n\s*\n/)
    .map((p) => escapeLatex(p.trim()).replace(/\n/g, ' '))
    .filter(Boolean)
    .join('\\par ');

/** The model as comment lines (JSON, split into short lines). */
function modelComment(spec: CoverSpec): string {
  return jsonCommentLines(MARK, spec);
}

/** The model from a muqova.tex (null when there is none or it is broken). */
export function readCover(tex: string): CoverSpec | null {
  const json = jsonFromCommentLines(MARK, tex);
  if (!json) return null;
  try {
    return normalizeCover(JSON.parse(json));
  } catch {
    return null;
  }
}

/** muqova.tex: a one-page document of the whole spread, with crop and fold marks. XeLaTeX or LuaLaTeX. */
export function generateCover(raw: CoverSpec): string {
  const spec = normalizeCover(raw);
  const g = coverGeometry(spec);
  // TikZ works from the bottom-left corner: y below is counted upwards.
  const H = g.page.h;
  const up = (yTop: number) => mm(H - yTop);
  const left = g.slug;
  const right = g.page.w - g.slug;
  const top = g.slug;
  const bottom = H - g.slug;
  const backEnd = g.spineX - g.hinge;
  const frontStart = g.front - g.hinge;
  const box = (x1: number, y1: number, x2: number, y2: number) => `(${mm(x1)},${up(y2)}) rectangle (${mm(x2)},${up(y1)})`;
  const coverFill = (file: string, x1: number, x2: number) =>
    `\\begin{scope}\\clip ${box(x1, top, x2, bottom)};\\node[inner sep=0pt] at (${mm((x1 + x2) / 2)},${up((top + bottom) / 2)}) {\\muqova@fill{${file}}{${mm(x2 - x1)}}{${mm(bottom - top)}}};\\end{scope}`;
  const panelTop = g.top;
  const panelBottom = g.top + g.panel.h;
  // Text keeps 10 mm from the trim (or board edge) and the fold.
  const safe = 10;
  const frontCenter = g.front + g.panel.w / 2;
  const textWidth = g.panel.w - 2 * safe;

  const draw: string[] = [
    `\\fill[muqova@back] ${box(left, top, g.spineX, bottom)};`,
    `\\fill[muqova@front] ${box(g.spineX + g.spine, top, right, bottom)};`,
  ];
  if (g.spine > 0) draw.push(`\\fill[muqova@spine] ${box(g.spineX, top, g.spineX + g.spine, bottom)};`);
  if (spec.backImage) draw.push(coverFill(spec.backImage, left, backEnd));
  if (spec.frontImage) draw.push(coverFill(spec.frontImage, frontStart, right));

  const front: string[] = [];
  if (spec.author) front.push(`{\\large ${escapeLatex(spec.author)}\\par}\\vspace{12mm}`);
  front.push(`{\\fontsize{26}{31}\\selectfont\\bfseries ${escapeLatex(spec.title)}\\par}`);
  if (spec.subtitle) front.push(`\\vspace{5mm}{\\large ${escapeLatex(spec.subtitle)}\\par}`);
  draw.push(
    `\\node[anchor=north,text width=${mm(textWidth)},align=center,text=muqova@text] at (${mm(frontCenter)},${up(panelTop + 25)}) {${front.join('')}};`,
  );
  if (spec.publisher) {
    draw.push(
      `\\node[anchor=south,text width=${mm(textWidth)},align=center,text=muqova@text] at (${mm(frontCenter)},${up(panelBottom - 12)}) {${escapeLatex(spec.publisher)}};`,
    );
  }
  // Spine: read from top to bottom; only when there is room for a line of text.
  if (g.spine >= 6) {
    const size = Math.min(12, round1(g.spine * 0.55 * 2.845));
    const spineText = [spec.author, spec.title].filter(Boolean).map((s) => escapeLatex(s!)).join('\\quad\\textbullet\\quad ');
    draw.push(
      `\\node[rotate=-90,text=muqova@text,font=\\fontsize{${size}}{${size}}\\selectfont\\bfseries] at (${mm(g.spineX + g.spine / 2)},${up(
        (panelTop + panelBottom) / 2,
      )}) {${spineText}};`,
    );
  }
  if (spec.back) {
    draw.push(
      `\\node[anchor=north west,text width=${mm(textWidth)},align=justify,text=muqova@text,font=\\small] at (${mm(g.back + safe)},${up(
        panelTop + 20,
      )}) {${paragraphs(spec.back)}};`,
    );
  }
  if (spec.isbn) {
    draw.push(
      `\\node[anchor=south east,fill=white,inner sep=2mm] at (${mm(backEnd - safe)},${up(panelBottom - safe)}) {\\muqova@isbn};`,
    );
  }
  // Crop marks at the trim / board corners, fold marks at the spine (and hinges), all in the slug.
  const marks: string[] = [];
  const trimX = [g.back, g.front + g.panel.w];
  const trimY = [panelTop, panelBottom];
  const len = g.slug - 3;
  for (const x of trimX) {
    marks.push(`\\draw (${mm(x)},${up(0)}) -- (${mm(x)},${up(len)});`, `\\draw (${mm(x)},${up(H)}) -- (${mm(x)},${up(H - len)});`);
  }
  for (const y of trimY) {
    marks.push(`\\draw (0mm,${up(y)}) -- (${mm(len)},${up(y)});`, `\\draw (${mm(g.page.w)},${up(y)}) -- (${mm(g.page.w - len)},${up(y)});`);
  }
  const folds = g.spine > 0 ? [g.spineX, g.spineX + g.spine] : [g.spineX];
  if (g.hinge) folds.push(backEnd, frontStart);
  for (const x of folds) {
    marks.push(`\\draw[dashed] (${mm(x)},${up(0)}) -- (${mm(x)},${up(len)});`, `\\draw[dashed] (${mm(x)},${up(H)}) -- (${mm(x)},${up(H - len)});`);
  }

  const out = [
    modelComment(spec),
    '% Oversells «Muqova»: generated from the lines above (the «Muqova» tab of «Sahifa dizayni»).',
    `% Spine ${round1(g.spine)} mm, spread ${g.page.w} × ${g.page.h} mm with ${g.slug} mm for the marks. Compile with XeLaTeX or LuaLaTeX.`,
    '\\documentclass{article}',
    `\\usepackage[paperwidth=${mm(g.page.w)},paperheight=${mm(g.page.h)},margin=0mm]{geometry}`,
    spec.cmyk ? '\\usepackage[cmyk]{xcolor}' : '\\usepackage{xcolor}',
    '\\usepackage{fontspec}',
    '\\setmainfont{Noto Serif}',
    '\\usepackage{babel}',
    '\\babelprovide[import=uz-Latn, main]{uzbek}',
    '\\usepackage{graphicx}',
    '\\usepackage{tikz}',
    `\\definecolor{muqova@front}{HTML}{${spec.frontColor}}`,
    `\\definecolor{muqova@spine}{HTML}{${spec.spineColor}}`,
    `\\definecolor{muqova@back}{HTML}{${spec.backColor}}`,
    `\\definecolor{muqova@text}{HTML}{${spec.textColor}}`,
    '\\makeatletter',
    // Scales a picture to cover the box (the clip cuts the rest).
    '\\ExplSyntaxOn',
    '\\cs_new_protected:Npn \\muqova_fill:nnn #1#2#3',
    '  {',
    '    \\hbox_set:Nn \\l_tmpa_box { \\includegraphics{#1} }',
    '    \\fp_compare:nNnTF',
    '      { \\dim_to_fp:n { \\box_wd:N \\l_tmpa_box } * \\dim_to_fp:n {#3} } >',
    '      { \\dim_to_fp:n { \\box_ht:N \\l_tmpa_box } * \\dim_to_fp:n {#2} }',
    '      { \\includegraphics[height=#3]{#1} }',
    '      { \\includegraphics[width=#2]{#1} }',
    '  }',
    '\\cs_set_eq:NN \\muqova@fill \\muqova_fill:nnn',
    '\\ExplSyntaxOff',
    spec.isbn ? `\\newcommand\\muqova@isbn{%\n${ean13Tikz(spec.isbn)}}` : '',
    '\\pagestyle{empty}',
    '\\begin{document}',
    '\\noindent\\begin{tikzpicture}[remember picture,overlay,shift={(current page.south west)}]',
    ...draw,
    '\\begin{scope}[line width=0.25pt,black]',
    ...marks,
    '\\end{scope}',
    '\\end{tikzpicture}',
    '\\end{document}',
    '',
  ];
  return out.filter((l) => l !== '').join('\n') + '\n';
}

/** Pages of the PDF from a LaTeX log (the last "Output written on … (N pages"). */
export function pagesFromLog(log: string): number | null {
  const all = [...log.matchAll(/Output written on .*?\((\d+) pages?/g)];
  return all.length ? Number(all[all.length - 1]![1]) : null;
}

/**
 * Preflight of the cover against the book: muqova.tex was made for some page count; when the
 * book now has another one, the spine is the wrong width. The fix sets the cover to the book's
 * pages (the spine follows from the paper).
 */
export function coverSpineCheck(cover: CoverSpec, bookPages: number): PreflightCheck {
  if (cover.pages === bookPages) return { id: 'cover-spine', status: 'ok', items: [] };
  const was = coverGeometry(cover).spine;
  const now = coverGeometry({ ...cover, pages: bookPages }).spine;
  const mm = (v: number) => `${Math.round(v * 10) / 10} mm`;
  return {
    id: 'cover-spine',
    // A spine off by half a millimetre or more shows on the shelf: the title slides off it.
    status: Math.abs(now - was) >= 0.5 ? 'error' : 'warning',
    items: [{ text: `${cover.pages} → ${bookPages} (${mm(was)} → ${mm(now)})` }],
    fix: { kind: 'coverPages', pages: bookPages },
  };
}
