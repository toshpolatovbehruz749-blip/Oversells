import {
  ORNAMENTS,
  defaultPageDesign,
  normalizePageDesign,
  type Align,
  type CharacterStyle,
  type HeaderLine,
  type MasterPage,
  type Ornament,
  type PageDesignSpec,
  type ParagraphStyle,
} from './page-design.js';

/**
 * «Sahifa dizayni» from a description (AI): the model answers in this JSON
 * schema (structured output), the answer is turned into a page design here and
 * checked like any other. Fonts are left out on purpose: an uninstalled font
 * stops the compile; the design keeps the document's own.
 */

const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] });
const ORN = ['none', ...ORNAMENTS];

export const AI_PAGE_DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    notes: { type: 'string' },
    title: { type: 'string' },
    paragraphStyles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          heading: nullable('integer'),
          size: nullable('number'),
          leading: nullable('number'),
          align: { anyOf: [{ type: 'string', enum: ['justify', 'left', 'center', 'right'] }, { type: 'null' }] },
          italic: { type: 'boolean' },
          bold: { type: 'boolean' },
          color: nullable('string'),
          indent: nullable('number'),
          leftIndent: nullable('number'),
          spaceBefore: nullable('number'),
          spaceAfter: nullable('number'),
          dropCap: nullable('integer'),
        },
        required: ['id', 'name', 'heading', 'size', 'leading', 'align', 'italic', 'bold', 'color', 'indent', 'leftIndent', 'spaceBefore', 'spaceAfter', 'dropCap'],
        additionalProperties: false,
      },
    },
    characterStyles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          italic: { type: 'boolean' },
          bold: { type: 'boolean' },
          smallCaps: { type: 'boolean' },
          color: nullable('string'),
        },
        required: ['id', 'name', 'italic', 'bold', 'smallCaps', 'color'],
        additionalProperties: false,
      },
    },
    margins: {
      type: 'object',
      properties: { inner: { type: 'number' }, outer: { type: 'number' }, top: { type: 'number' }, bottom: { type: 'number' } },
      required: ['inner', 'outer', 'top', 'bottom'],
      additionalProperties: false,
    },
    runningHeads: { type: 'string', enum: ['none', 'pageOnly', 'titleAndChapter'] },
    chapterOpensRight: { type: 'boolean' },
    chapterHeadOrnament: { type: 'string', enum: ORN },
    chapterEndOrnament: { type: 'string', enum: ORN },
    microtype: { type: 'boolean' },
  },
  required: [
    'name',
    'notes',
    'title',
    'paragraphStyles',
    'characterStyles',
    'margins',
    'runningHeads',
    'chapterOpensRight',
    'chapterHeadOrnament',
    'chapterEndOrnament',
    'microtype',
  ],
  additionalProperties: false,
} as const;

export interface AiPageDesignProposal {
  name: string;
  notes: string;
  design: PageDesignSpec;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v)) * 10) / 10 : undefined;
const colour = (v: unknown): string | undefined => {
  const c = typeof v === 'string' ? v.replace(/^#/, '') : '';
  return /^[0-9A-Fa-f]{6}$/.test(c) ? c.toUpperCase() : undefined;
};
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const defined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined && x !== false)) as T;

/** A Latin id: lower-case letters and digits, starting with a letter, unique in `taken`. */
function cleanId(raw: unknown, fallback: string, taken: Set<string>): string {
  const base =
    (typeof raw === 'string' ? raw : '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]/g, '')
      .replace(/^[0-9]+/, '')
      .slice(0, 26) || fallback;
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}${i}`;
  taken.add(id);
  return id;
}

/** The AI answer as a checked page design; throws (PageDesignError or Error) when it cannot be one. */
export function pageDesignFromAi(data: unknown, title: string): AiPageDesignProposal {
  if (!isObj(data)) throw new Error('The answer is not an object');
  const taken = new Set<string>();
  const paragraphStyles: ParagraphStyle[] = (Array.isArray(data.paragraphStyles) ? data.paragraphStyles : [])
    .filter(isObj)
    .slice(0, 30)
    .map((p, i) => {
      const heading = p.heading === 1 || p.heading === 2 || p.heading === 3 ? (p.heading as 1 | 2 | 3) : undefined;
      const dropCap = p.dropCap === 2 || p.dropCap === 3 || p.dropCap === 4 ? (p.dropCap as 2 | 3 | 4) : undefined;
      const align = ['justify', 'left', 'center', 'right'].includes(p.align as string) ? (p.align as Align) : undefined;
      return defined({
        id: cleanId(p.id, `uslub${i + 1}`, taken),
        name: text(p.name, 60) || `Uslub ${i + 1}`,
        heading,
        size: num(p.size, 6, 48),
        leading: num(p.leading, 6, 60),
        align,
        italic: p.italic === true || undefined,
        bold: p.bold === true || undefined,
        color: colour(p.color),
        indent: num(p.indent, 0, 30),
        leftIndent: num(p.leftIndent, 0, 60),
        spaceBefore: num(p.spaceBefore, 0, 60),
        spaceAfter: num(p.spaceAfter, 0, 60),
        dropCap: heading ? undefined : dropCap,
      }) as ParagraphStyle;
    });
  const characterStyles: CharacterStyle[] = (Array.isArray(data.characterStyles) ? data.characterStyles : [])
    .filter(isObj)
    .slice(0, 20)
    .map(
      (c, i) =>
        defined({
          id: cleanId(c.id, `belgi${i + 1}`, taken),
          name: text(c.name, 60) || `Belgi ${i + 1}`,
          italic: c.italic === true || undefined,
          bold: c.bold === true || undefined,
          smallCaps: c.smallCaps === true || undefined,
          color: colour(c.color),
        }) as CharacterStyle,
    );

  const design = defaultPageDesign((text(data.title, 120) || title).slice(0, 120));
  design.paragraphStyles = paragraphStyles;
  design.characterStyles = characterStyles;
  // Masters: the running heads asked for, and a chapter-opening page with the number only.
  const empty = { kind: 'empty' as const };
  const line = (l: HeaderLine['left'], c: HeaderLine['center'], r: HeaderLine['right']): HeaderLine => ({ left: l, center: c, right: r });
  const none = line(empty, empty, empty);
  const page = { kind: 'page' as const };
  const heads = data.runningHeads;
  const body: MasterPage =
    heads === 'titleAndChapter'
      ? {
          id: 'asosiy',
          name: 'Asosiy matn',
          odd: { head: line(empty, { kind: 'chapter' }, page), foot: none },
          even: { head: line(page, { kind: 'title' }, empty), foot: none },
          headRule: false,
          numbering: null,
        }
      : {
          id: 'asosiy',
          name: 'Asosiy matn',
          odd: { head: none, foot: heads === 'none' ? none : line(empty, page, empty) },
          even: { head: none, foot: heads === 'none' ? none : line(empty, page, empty) },
          headRule: false,
          numbering: null,
        };
  const opening: MasterPage = {
    id: 'bobboshi',
    name: 'Bob boshi',
    odd: { head: none, foot: heads === 'none' ? none : line(empty, page, empty) },
    even: { head: none, foot: heads === 'none' ? none : line(empty, page, empty) },
    headRule: false,
    numbering: null,
  };
  design.masters = [body, opening];
  design.defaultMaster = 'asosiy';
  design.chapterMaster = 'bobboshi';
  design.chapterOpensRight = data.chapterOpensRight === true;
  const m = isObj(data.margins) ? data.margins : {};
  design.page = defined({ inner: num(m.inner, 8, 50), outer: num(m.outer, 8, 50), top: num(m.top, 8, 50), bottom: num(m.bottom, 8, 50) });
  if (data.microtype === true) design.microtype = true;
  const ornament = (v: unknown) => (ORNAMENTS.includes(v as Ornament) ? (v as Ornament) : undefined);
  const head = ornament(data.chapterHeadOrnament);
  const end = ornament(data.chapterEndOrnament);
  if (head) design.chapterHeadOrnament = head;
  if (end) design.chapterEndOrnament = end;
  return {
    name: text(data.name, 100) || 'Dizayn',
    notes: text(data.notes, 600),
    design: normalizePageDesign(design),
  };
}
