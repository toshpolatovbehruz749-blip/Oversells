import { latexToBlocks, type Block, type Run, type TextRun } from './latex-blocks.js';
import type { Align, CharacterStyle, HeaderLine, MasterPage, PageDesignSpec, ParagraphStyle, Slot } from './page-design.js';

/**
 * InDesign IDML export of an Oversells project: main.tex (with its \input files) and the
 * «Sahifa dizayni» model in sahifa.sty. The result is the list of parts of the .idml ZIP
 * (the caller zips them, `mimetype` first and stored). What goes over:
 *  - paragraphs with their styles: «Sahifa dizayni» paragraph styles (\begin{uslub}),
 *    headings as «Sarlavha 1–3» (formatted by the design's heading styles), lists, quotes,
 *    captions; character styles (\matnuslubi), bold/italic/small caps/underline;
 *  - footnotes as InDesign footnotes, pictures as inline frames linked to their files;
 *  - page size, margins and facing pages; the masters with running heads and feet
 *    (page number, chapter and section through text variables, book title, text), head rule;
 *  - one text story threaded through as many pages as the book had (InDesign adds pages
 *    for overset text when it is opened with Smart Text Reflow).
 * Not taken over (warned): formulas keep their LaTeX source in the «Formula (LaTeX)»
 * character style, drawings leave «[Chizma]», tables keep their cells separated by tabs.
 */

export interface IdmlPicture {
  /** The URI InDesign links to (file:///…/a.png, or file:Links/a.png for a package). */
  uri: string;
  widthPx: number;
  heightPx: number;
  /** Pixels per inch stored in the file (72 when it says nothing). */
  ppi: number;
  format: 'png' | 'jpeg' | 'pdf';
}

export interface IdmlPageSetup {
  widthMm: number;
  heightMm: number;
  /** Margins, mm: inner/outer are left/right of a one-sided document. */
  inner: number;
  outer: number;
  top: number;
  bottom: number;
  facing: boolean;
}

export interface IdmlExportInput {
  title: string;
  mainTex: string;
  /** Text of a project file (for \input / \include), null when it is not there. */
  readFile?: (path: string) => string | null;
  design?: PageDesignSpec | null;
  page?: Partial<IdmlPageSetup>;
  /** Pages of the last PDF (the threaded frames get at least that many pages). */
  pages?: number | null;
  /** A picture as written in the text (rasmlar/a, rasmlar/a.png) → its file, null when missing. */
  picture?: (path: string) => IdmlPicture | null;
}

export type IdmlExportWarning =
  | { kind: 'formulas'; count: number }
  | { kind: 'drawings'; count: number }
  | { kind: 'tables'; count: number }
  | { kind: 'missingPicture'; name: string };

export interface IdmlExportResult {
  /** Path in the ZIP → content. */
  parts: Record<string, string>;
  pages: number;
  warnings: IdmlExportWarning[];
}

const MM = 72 / 25.4;
const DOM = '21.2';

/** Paper sizes LaTeX knows by name (mm). */
const PAPERS: Record<string, [number, number]> = {
  a4paper: [210, 297],
  a5paper: [148, 210],
  a6paper: [105, 148],
  b5paper: [176, 250],
  letterpaper: [215.9, 279.4],
};

/** Page size, margins and sidedness read from the preamble (geometry, class options); defaults A4. */
export function pageSetupFromLatex(mainTex: string): IdmlPageSetup & { fontSize: number; mainFont: string | null } {
  const pre = mainTex.slice(0, Math.max(0, mainTex.indexOf('\\begin{document}'))).replace(/(^|[^\\])%[^\n]*/g, '$1');
  const cls = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/.exec(pre);
  const opts = (cls?.[1] ?? '').split(',').map((o) => o.trim());
  const geometry = [...pre.matchAll(/\\(?:usepackage\s*\[([^\]]*)\]\s*\{geometry\}|geometry\s*\{([^}]*)\}|PassOptionsToPackage\s*\{([^}]*)\}\s*\{geometry\})/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '').join(',');
  const g = (key: string) => {
    const m = new RegExp(`(?:^|,)\\s*${key}\\s*=\\s*([\\d.]+)\\s*(mm|cm|pt|in)`).exec(geometry);
    if (!m) return undefined;
    const v = Number(m[1]);
    return m[2] === 'cm' ? v * 10 : m[2] === 'in' ? v * 25.4 : m[2] === 'pt' ? (v * 25.4) / 72.27 : v;
  };
  let [w, h] = PAPERS.a4paper!;
  for (const o of [...opts, ...geometry.split(',').map((x) => x.trim())]) if (PAPERS[o]) [w, h] = PAPERS[o]!;
  w = g('paperwidth') ?? w;
  h = g('paperheight') ?? h;
  const all = g('margin');
  const book = /book|memoir|scrbook/.test(cls?.[2] ?? '');
  const facing = opts.includes('twoside') || (book && !opts.includes('oneside'));
  const fontSize = Number(/^(\d+)pt$/.exec(opts.find((o) => /^\d+pt$/.test(o)) ?? '')?.[1] ?? 10);
  const mainFont = /\\setmainfont\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/.exec(pre)?.[1]?.trim() ?? null;
  const side = Math.round(Math.min(w, h) * 0.12);
  return {
    widthMm: w,
    heightMm: h,
    inner: g('inner') ?? g('left') ?? all ?? side,
    outer: g('outer') ?? g('right') ?? all ?? side,
    top: g('top') ?? all ?? side,
    bottom: g('bottom') ?? all ?? Math.round(side * 1.3),
    facing,
    fontSize,
    mainFont,
  };
}

// --- XML helpers -------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Text content: XML-escaped, characters XML 1.0 does not allow dropped. */
const content = (s: string) => esc(s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, ''));
/** The name part of a style reference: ':' and '%' escaped as InDesign does. */
const refName = (name: string) => esc(name.replace(/%/g, '%25').replace(/:/g, '%3a').replace(/\//g, '%2f'));
const num = (v: number) => String(Math.round(v * 1000) / 1000);
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const PKG = 'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"';

const JUSTIFICATION: Record<Align, string> = { justify: 'LeftJustified', left: 'LeftAlign', right: 'RightAlign', center: 'CenterAlign' };
const fontStyleOf = (bold?: boolean, italic?: boolean) => (bold && italic ? 'Bold Italic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular');
/** An uploaded font file (fonts/Kitob-Regular.otf) → a family name to look for. */
const fontFamily = (font: string) => (/\.(otf|ttf)$/i.test(font) ? font.replace(/^.*\//, '').replace(/\.(otf|ttf)$/i, '').replace(/[-_](Regular|Book|Roman)$/i, '').replace(/[-_]+/g, ' ') : font);

interface StyleOut {
  self: string;
  name: string;
  attrs: Record<string, string | number | boolean | undefined>;
  props: string[];
}

// --- the export ---------------------------------------------------------------------------------

export function projectToIdml(input: IdmlExportInput): IdmlExportResult {
  const design = input.design ?? null;
  const fromTex = pageSetupFromLatex(input.mainTex);
  const pg: IdmlPageSetup = { ...fromTex, ...Object.fromEntries(Object.entries(input.page ?? {}).filter(([, v]) => v !== undefined)) };
  if (design?.page) {
    for (const k of ['inner', 'outer', 'top', 'bottom'] as const) if (design.page[k] !== undefined) pg[k] = design.page[k]!;
  }
  const W = pg.widthMm * MM;
  const H = pg.heightMm * MM;
  const base = fromTex.fontSize;
  const parsed = latexToBlocks(input.mainTex, input.readFile ?? (() => null));
  const warnings: IdmlExportWarning[] = [];
  if (parsed.formulas) warnings.push({ kind: 'formulas', count: parsed.formulas });
  if (parsed.drawings) warnings.push({ kind: 'drawings', count: parsed.drawings });
  if (parsed.tables) warnings.push({ kind: 'tables', count: parsed.tables });

  let next = 0x100;
  const uid = () => `u${(next++).toString(16)}`;

  // Colours.
  const colours = new Map<string, string>();
  const colour = (hex: string | undefined) => {
    if (!hex || !/^[0-9A-Fa-f]{6}$/.test(hex)) return undefined;
    const key = hex.toUpperCase();
    if (!colours.has(key)) colours.set(key, `Color/RGB ${key}`);
    return colours.get(key)!;
  };

  // --- paragraph styles ---
  const mainFont = fromTex.mainFont ?? 'Times New Roman';
  const pStyles: StyleOut[] = [];
  const usedNames = new Set<string>(['[Basic Paragraph]']);
  const uniqueName = (n: string) => {
    let name = n.trim() || 'Uslub';
    for (let i = 2; usedNames.has(name); i++) name = `${n} ${i}`;
    usedNames.add(name);
    return name;
  };
  const paragraphAttrs = (p: Partial<ParagraphStyle>) => {
    const attrs: StyleOut['attrs'] = {};
    const props: string[] = [];
    if (p.size) attrs.PointSize = num(p.size);
    if (p.leading) props.push(`<Leading type="unit">${num(p.leading)}</Leading>`);
    else if (p.size) props.push(`<Leading type="unit">${num(p.size * 1.2)}</Leading>`);
    if (p.align) attrs.Justification = JUSTIFICATION[p.align];
    if (p.indent !== undefined) attrs.FirstLineIndent = num(p.indent * MM);
    if (p.leftIndent !== undefined) attrs.LeftIndent = num(p.leftIndent * MM);
    if (p.spaceBefore !== undefined) attrs.SpaceBefore = num(p.spaceBefore);
    if (p.spaceAfter !== undefined) attrs.SpaceAfter = num(p.spaceAfter);
    if (p.bold !== undefined || p.italic !== undefined) attrs.FontStyle = fontStyleOf(p.bold, p.italic);
    if (p.color) attrs.FillColor = colour(p.color);
    if (p.hyphenate === false) attrs.Hyphenation = false;
    if (p.keepWithNext) attrs.KeepWithNext = 2;
    if (p.tracking) attrs.Tracking = Math.round(p.tracking);
    if (p.dropCap) {
      attrs.DropCapLines = p.dropCap;
      attrs.DropCapCharacters = 1;
    }
    if (p.font) props.push(`<AppliedFont type="string">${esc(fontFamily(p.font))}</AppliedFont>`);
    return { attrs, props };
  };
  const NORMAL = 'ParagraphStyle/$ID/NormalParagraphStyle';
  const byId = new Map<string, string>();
  const designStyles = design?.paragraphStyles ?? [];
  // Design styles that are not headings, named as in the design.
  for (const s of designStyles.filter((x) => !x.heading)) {
    const name = uniqueName(s.name);
    byId.set(s.id, `ParagraphStyle/${refName(name)}`);
  }
  const headingStyle = (level: 1 | 2 | 3) => designStyles.find((s) => s.heading === level);
  const headingNames = (['Sarlavha 1', 'Sarlavha 2', 'Sarlavha 3'] as const).map((n) => uniqueName(n));
  for (const s of designStyles.filter((x) => !x.heading)) {
    const { attrs, props } = paragraphAttrs(s);
    const parent = s.basedOn ? byId.get(s.basedOn) : undefined;
    props.unshift(`<BasedOn type="object">${parent ?? NORMAL}</BasedOn>`);
    if (s.parSkip !== undefined && s.spaceAfter === undefined) attrs.SpaceAfter = num(s.parSkip);
    pStyles.push({ self: byId.get(s.id)!, name: byId.get(s.id)!.slice('ParagraphStyle/'.length), attrs, props });
  }
  const headingDefaults: Partial<ParagraphStyle>[] = [
    { size: base * 1.8, bold: true, spaceBefore: base * 2, spaceAfter: base * 1.5, keepWithNext: true, align: 'left', hyphenate: false },
    { size: base * 1.4, bold: true, spaceBefore: base * 1.5, spaceAfter: base * 0.8, keepWithNext: true, align: 'left', hyphenate: false },
    { size: base * 1.15, bold: true, spaceBefore: base, spaceAfter: base * 0.5, keepWithNext: true, align: 'left', hyphenate: false },
  ];
  const headingRefs: string[] = [];
  for (const level of [1, 2, 3] as const) {
    const own = headingStyle(level);
    const { attrs, props } = paragraphAttrs({ ...headingDefaults[level - 1], ...own, indent: own?.indent ?? 0 });
    props.unshift(`<BasedOn type="object">${NORMAL}</BasedOn>`);
    if (level === 1 && parsed.chapters) attrs.StartParagraph = design?.chapterOpensRight !== false && pg.facing ? 'NextOddPage' : 'NextPage';
    const self = `ParagraphStyle/${refName(headingNames[level - 1]!)}`;
    headingRefs.push(self);
    if (own) byId.set(own.id, self);
    pStyles.push({ self, name: refName(headingNames[level - 1]!), attrs, props });
  }
  const extra = (n: string, p: Partial<ParagraphStyle>, more: StyleOut['attrs'] = {}, moreProps: string[] = []) => {
    const name = uniqueName(n);
    const { attrs, props } = paragraphAttrs(p);
    props.unshift(`<BasedOn type="object">${NORMAL}</BasedOn>`, ...moreProps);
    const self = `ParagraphStyle/${refName(name)}`;
    pStyles.push({ self, name: refName(name), attrs: { ...attrs, ...more }, props });
    return self;
  };
  const tab = base * 1.8;
  const LIST = extra('Roʻyxat', { indent: -tab / MM, leftIndent: tab / MM }, {}, [
    `<TabList type="list"><ListItem type="record"><Alignment type="enumeration">LeftAlign</Alignment><AlignmentCharacter type="string">.</AlignmentCharacter><Leader type="string"></Leader><Position type="unit">${num(tab)}</Position></ListItem></TabList>`,
  ]);
  const QUOTE = extra('Iqtibos (quote)', { leftIndent: 10, italic: true }, { RightIndent: num(10 * MM) });
  const CAPTION = extra('Rasm osti yozuvi', { size: base * 0.9, italic: true, align: 'center', indent: 0, spaceAfter: base * 0.8 });
  const TITLE = extra('Kitob nomi', { size: base * 2.2, bold: true, align: 'center', indent: 0, spaceAfter: base });
  const FOOTNOTE = extra('Izoh', { size: base * 0.8, leading: base * 0.95, indent: 0 });
  const RUNNING = extra('Sahifa yozuvi', { size: base * 0.85, indent: 0, align: 'left', hyphenate: false }, {}, []);

  // --- character styles ---
  const cStyles: StyleOut[] = [];
  const cById = new Map<string, string>();
  const cNames = new Set<string>();
  for (const c of design?.characterStyles ?? []) {
    let name = c.name.trim() || 'Belgi';
    for (let i = 2; cNames.has(name); i++) name = `${c.name} ${i}`;
    cNames.add(name);
    const self = `CharacterStyle/${refName(name)}`;
    cById.set(c.id, self);
    cStyles.push({ self, name: refName(name), ...characterAttrs(c, colour) });
  }
  const FORMULA = 'CharacterStyle/Formula (LaTeX)';
  cStyles.push({ self: FORMULA, name: 'Formula (LaTeX)', attrs: { FontStyle: 'Italic', FillColor: colour('1F4E79') }, props: [] });
  const NO_CHAR = 'CharacterStyle/$ID/[No character style]';

  // --- the story ---
  const stories: Array<{ self: string; xml: string }> = [];
  const textWidth = W - (pg.inner + pg.outer) * MM;
  const textHeight = H - (pg.top + pg.bottom) * MM;
  const missing = new Set<string>();
  const runXml = (r: Run): string => {
    if (r.type === 'break') return '<Content>\u2028</Content>';
    if (r.type === 'text') return `<Content>${content(r.text)}</Content>`;
    if (r.type === 'footnote') {
      const paras = r.paragraphs.length ? r.paragraphs : [{ kind: 'body' as const, runs: [] }];
      const inner = paras
        .map((p, i) => {
          const runs = p.runs.map((x, k) => charRange(x, k === 0 && i === 0 ? '<Content><?ACE 4?></Content><Content> </Content>' : '')).join('');
          const first = i === 0 && !p.runs.length ? `<CharacterStyleRange AppliedCharacterStyle="${NO_CHAR}"><Content><?ACE 4?></Content></CharacterStyleRange>` : '';
          return `<ParagraphStyleRange AppliedParagraphStyle="${FOOTNOTE}">${first}${runs}${i < paras.length - 1 ? `<CharacterStyleRange AppliedCharacterStyle="${NO_CHAR}"><Br/></CharacterStyleRange>` : ''}</ParagraphStyleRange>`;
        })
        .join('');
      return `<Footnote>${inner}</Footnote>`;
    }
    // A picture: an inline frame with the linked file.
    const pic = input.picture?.(r.file) ?? null;
    if (!pic) {
      missing.add(r.file);
      return `<Content>[${content(r.file)}]</Content>`;
    }
    const nativeW = (pic.widthPx * 72) / (pic.ppi || 72);
    const nativeH = (pic.heightPx * 72) / (pic.ppi || 72);
    let w = r.widthShare !== undefined ? textWidth * r.widthShare : r.widthMm !== undefined ? r.widthMm * MM : Math.min(textWidth, nativeW);
    let h = (w * nativeH) / Math.max(1, nativeW);
    if (h > textHeight * 0.85) {
      h = textHeight * 0.85;
      w = (h * nativeW) / Math.max(1, nativeH);
    }
    const scale = w / Math.max(1, nativeW);
    const rect = uid();
    const img = uid();
    const link = uid();
    const format = pic.format === 'png' ? '$ID/Portable Network Graphics (PNG)' : pic.format === 'jpeg' ? '$ID/JPEG' : '$ID/Adobe Portable Document Format (PDF)';
    return (
      `<Rectangle Self="${rect}" ContentType="GraphicType" StrokeWeight="0" ItemTransform="1 0 0 1 0 0">` +
      `<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>` +
      pathPoints(0, 0, w, h) +
      `</PathPointArray></GeometryPathType></PathGeometry></Properties>` +
      `<AnchoredObjectSetting AnchoredPosition="InlinePosition" />` +
      `<FrameFittingOption FittingOnEmptyFrame="Proportionally" />` +
      `<${pic.format === 'pdf' ? 'PDF' : 'Image'} Self="${img}" ItemTransform="${num(scale)} 0 0 ${num(scale)} 0 0">` +
      `<Properties><GraphicBounds Left="0" Top="0" Right="${num(nativeW)}" Bottom="${num(nativeH)}" /></Properties>` +
      `<Link Self="${link}" LinkResourceURI="${esc(pic.uri)}" LinkResourceFormat="${format}" StoredState="Normal" LinkClassID="35906" LinkClientID="257" />` +
      `</${pic.format === 'pdf' ? 'PDF' : 'Image'}></Rectangle>`
    );
  };
  const charRange = (r: Run, prefix = ''): string => {
    if (r.type !== 'text') return `<CharacterStyleRange AppliedCharacterStyle="${NO_CHAR}">${prefix}${runXml(r)}</CharacterStyleRange>`;
    const t = r as TextRun;
    const applied = t.formula ? FORMULA : t.charStyle && cById.get(t.charStyle) ? cById.get(t.charStyle)! : NO_CHAR;
    const attrs: string[] = [];
    if (t.bold || t.italic) attrs.push(`FontStyle="${fontStyleOf(t.bold, t.italic)}"`);
    if (t.smallCaps) attrs.push('Capitalization="SmallCaps"');
    if (t.underline) attrs.push('Underline="true"');
    return `<CharacterStyleRange AppliedCharacterStyle="${applied}"${attrs.length ? ' ' + attrs.join(' ') : ''}>${prefix}${runXml(r)}</CharacterStyleRange>`;
  };
  const styleOf = (b: Block): string => {
    switch (b.kind) {
      case 'heading':
        return headingRefs[(b.level ?? 1) - 1]!;
      case 'style':
        return (b.style && byId.get(b.style)) || NORMAL;
      case 'list':
        return LIST;
      case 'quote':
        return QUOTE;
      case 'caption':
        return CAPTION;
      case 'title':
        return TITLE;
      default:
        return NORMAL;
    }
  };
  const paragraphXml = (b: Block, last: boolean) => {
    const attrs = [`AppliedParagraphStyle="${styleOf(b)}"`];
    if (b.align && b.kind !== 'caption' && b.kind !== 'title') attrs.push(`Justification="${JUSTIFICATION[b.align]}"`);
    if (b.align === 'center' && b.kind !== 'heading') attrs.push('FirstLineIndent="0"');
    if (b.newPage && b.kind !== 'heading') attrs.push('StartParagraph="NextPage"');
    const runs = b.runs.map((r) => charRange(r)).join('');
    // A line with an inline picture grows with it (auto leading), instead of the picture covering the lines above.
    const props = b.runs.some((r) => r.type === 'picture') ? '<Properties><Leading type="enumeration">Auto</Leading></Properties>' : '';
    if (props) attrs.push(`SpaceBefore="${num(base * 0.6)}"`, `SpaceAfter="${num(base * 0.3)}"`);
    return `<ParagraphStyleRange ${attrs.join(' ')}>${props}${runs}${last ? '' : `<CharacterStyleRange AppliedCharacterStyle="${NO_CHAR}"><Br/></CharacterStyleRange>`}</ParagraphStyleRange>`;
  };
  const blocks = parsed.blocks.length ? parsed.blocks : [{ kind: 'body' as const, runs: [] }];
  const mainStory = uid();
  stories.push({ self: mainStory, xml: storyXml(mainStory, blocks.map((b, i) => paragraphXml(b, i === blocks.length - 1)).join('\n')) });
  for (const m of missing) warnings.push({ kind: 'missingPicture', name: m });

  // --- masters ---
  const masters: MasterPage[] = design?.masters?.length
    ? design.masters
    : [{ id: 'asosiy', name: 'Asosiy', odd: footOnly(), even: footOnly(), headRule: false, numbering: null }];
  const defaultMaster = design?.defaultMaster && masters.some((m) => m.id === design.defaultMaster) ? design.defaultMaster : masters[0]!.id;
  const variables = { chapter: 'Bob nomi', section: 'Boʻlim nomi' };
  const slotXml = (s: Slot): string => {
    switch (s.kind) {
      case 'page':
        return '<Content><?ACE 18?></Content>';
      case 'chapter':
      case 'section':
        return `<TextVariableInstance Self="${uid()}" Name="&lt;${esc(variables[s.kind])}&gt;" ResultText="" AssociatedTextVariable="dTextVariablen${esc(variables[s.kind])}" />`;
      case 'title':
        return `<Content>${content(design?.title ?? input.title)}</Content>`;
      case 'text':
        return `<Content>${content(s.text ?? '')}</Content>`;
      default:
        return '';
    }
  };
  const lineStory = (line: HeaderLine, rule: boolean, width: number) => {
    if (![line.left, line.center, line.right].some((s) => s.kind !== 'empty')) return null;
    const self = uid();
    const tabs = `<TabList type="list">` +
      `<ListItem type="record"><Alignment type="enumeration">CenterAlign</Alignment><AlignmentCharacter type="string">.</AlignmentCharacter><Leader type="string"></Leader><Position type="unit">${num(width / 2)}</Position></ListItem>` +
      `<ListItem type="record"><Alignment type="enumeration">RightAlign</Alignment><AlignmentCharacter type="string">.</AlignmentCharacter><Leader type="string"></Leader><Position type="unit">${num(width)}</Position></ListItem>` +
      `</TabList>`;
    const ruleAttrs = rule ? ' RuleBelow="true" RuleBelowLineWeight="0.5" RuleBelowOffset="3"' : '';
    const body =
      `<ParagraphStyleRange AppliedParagraphStyle="${RUNNING}" FirstLineIndent="0"${ruleAttrs}><Properties>${tabs}</Properties>` +
      `<CharacterStyleRange AppliedCharacterStyle="${NO_CHAR}">${slotXml(line.left)}<Content>\t</Content>${slotXml(line.center)}<Content>\t</Content>${slotXml(line.right)}</CharacterStyleRange>` +
      `</ParagraphStyleRange>`;
    stories.push({ self, xml: storyXml(self, body) });
    return self;
  };
  const masterIds = new Map<string, string>();
  const masterSpreads: Array<{ self: string; xml: string }> = [];
  const pagesPerMaster = pg.facing ? 2 : 1;
  masters.forEach((m, i) => {
    const self = uid();
    masterIds.set(m.id, self);
    const prefix = String.fromCharCode(65 + (i % 26));
    const items: string[] = [];
    const pagesXml: string[] = [];
    for (let k = 0; k < pagesPerMaster; k++) {
      const left = pg.facing && k === 0;
      const x0 = pg.facing ? (left ? -W : 0) : 0;
      const side = left ? m.even : m.odd;
      const marginLeft = (left ? pg.outer : pg.inner) * MM;
      const marginRight = (left ? pg.inner : pg.outer) * MM;
      pagesXml.push(pageXml(uid(), prefix, 'n', x0, W, H, marginLeft, marginRight, pg.top * MM, pg.bottom * MM));
      const width = W - marginLeft - marginRight;
      const lineH = base * 1.6;
      const head = lineStory(side.head, m.headRule, width);
      if (head) {
        const y = pg.top * MM * 0.45;
        items.push(textFrameXml(uid(), head, 'n', 'n', x0 + marginLeft, y - H / 2, width, lineH));
      }
      const foot = lineStory(side.foot, false, width);
      if (foot) {
        const y = H - pg.bottom * MM * 0.6;
        items.push(textFrameXml(uid(), foot, 'n', 'n', x0 + marginLeft, y - H / 2, width, lineH));
      }
    }
    masterSpreads.push({
      self,
      xml:
        `${HEAD}\n<idPkg:MasterSpread ${PKG} DOMVersion="${DOM}">\n` +
        `<MasterSpread Self="${self}" Name="${prefix}-${esc(m.name)}" NamePrefix="${prefix}" BaseName="${esc(m.name)}" ShowMasterItems="true" PageCount="${pagesPerMaster}" ItemTransform="1 0 0 1 0 0">\n` +
        pagesXml.join('\n') +
        '\n' +
        items.join('\n') +
        `\n</MasterSpread>\n</idPkg:MasterSpread>\n`,
    });
  });

  // --- pages and the threaded frames ---
  const estimate = estimatePages(parsed.blocks, {
    lineChars: textWidth / (base * 0.5),
    lines: textHeight / (base * 1.2),
    chapters: parsed.chapters,
    oddChapters: pg.facing && design?.chapterOpensRight !== false,
  });
  let pageCount = Math.max(1, input.pages ?? 0, estimate);
  if (pageCount > 2000) pageCount = 2000;
  const spreads: Array<{ self: string; xml: string }> = [];
  const frameIds = Array.from({ length: pageCount }, () => uid());
  const pageIds: string[] = [];
  const master = masterIds.get(defaultMaster)!;
  let p = 0;
  while (p < pageCount) {
    const self = uid();
    const onSpread = pg.facing ? (p === 0 ? [p] : [p, p + 1].filter((x) => x < pageCount)) : [p];
    const items: string[] = [];
    const pagesXml: string[] = [];
    for (const n of onSpread) {
      const right = !pg.facing || n % 2 === 0; // page 1 (n = 0) is a right-hand page
      const x0 = pg.facing ? (right ? 0 : -W) : 0;
      const marginLeft = (right ? pg.inner : pg.outer) * MM;
      const marginRight = (right ? pg.outer : pg.inner) * MM;
      const id = uid();
      pageIds.push(id);
      pagesXml.push(pageXml(id, String(n + 1), master, x0, W, H, marginLeft, marginRight, pg.top * MM, pg.bottom * MM));
      items.push(
        textFrameXml(frameIds[n]!, mainStory, n === 0 ? 'n' : frameIds[n - 1]!, n === pageCount - 1 ? 'n' : frameIds[n + 1]!, x0 + marginLeft, pg.top * MM - H / 2, W - marginLeft - marginRight, H - (pg.top + pg.bottom) * MM),
      );
    }
    spreads.push({
      self,
      xml:
        `${HEAD}\n<idPkg:Spread ${PKG} DOMVersion="${DOM}">\n` +
        `<Spread Self="${self}" ShowMasterItems="true" PageCount="${onSpread.length}" BindingLocation="${pg.facing && onSpread[0] === 0 ? 0 : pg.facing ? 1 : 0}" AllowPageShuffle="true" ItemTransform="1 0 0 1 0 0">\n` +
        pagesXml.join('\n') +
        '\n' +
        items.join('\n') +
        `\n</Spread>\n</idPkg:Spread>\n`,
    });
    p += onSpread.length;
  }

  // --- resources ---
  const layer = 'ulayer';
  const sectionNumbering = masters.find((m) => m.id === defaultMaster)?.numbering;
  const pageNumberStyle = sectionNumbering === 'roman' ? 'LowerRoman' : sectionNumbering === 'Roman' ? 'UpperRoman' : 'Arabic';
  const designmap =
    `${HEAD}\n<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="${DOM}(30)" ?>\n` +
    `<Document ${PKG} DOMVersion="${DOM}" Self="d" StoryList="${stories.map((s) => s.self).join(' ')}" Name="${esc(input.title)}" ZeroPoint="0 0" ActiveLayer="${layer}" CMYKProfile="Coated FOGRA39 (ISO 12647-2:2004)" RGBProfile="sRGB IEC61966-2.1" SolidColorIntent="UseColorSettings" AfterBlendingIntent="UseColorSettings" DefaultImageIntent="UseColorSettings" RGBPolicy="PreserveEmbeddedProfiles" CMYKPolicy="CombinationOfPreserveAndSafeCmyk" AccurateLABSpots="false">\n` +
    `<Language Self="Language/$ID/[No Language]" Name="$ID/[No Language]" SingleQuotes="&apos;&apos;" DoubleQuotes="&quot;&quot;" PrimaryLanguageName="$ID/[No Language]" SublanguageName="$ID/[No Language]" Id="0" HyphenationVendor="$ID/" SpellingVendor="$ID/" />\n` +
    `<idPkg:Graphic src="Resources/Graphic.xml" />\n<idPkg:Fonts src="Resources/Fonts.xml" />\n<idPkg:Styles src="Resources/Styles.xml" />\n<idPkg:Preferences src="Resources/Preferences.xml" />\n` +
    Object.entries(variables)
      .map(
        ([kind, name]) =>
          `<TextVariable Self="dTextVariablen${esc(name)}" Name="${esc(name)}" VariableType="MatchParagraphStyleType"><MatchParagraphStylePreference TextBefore="" TextAfter="" AppliedParagraphStyle="${headingRefs[kind === 'chapter' ? 0 : 1]}" SearchStrategy="FirstOnPage" ChangeCase="None" DeleteEndPunctuation="false" /></TextVariable>\n`,
      )
      .join('') +
    `<Layer Self="${layer}" Name="Oversells" Visible="true" Locked="false" IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="true" />\n` +
    masterSpreads.map((m) => `<idPkg:MasterSpread src="MasterSpreads/MasterSpread_${m.self}.xml" />\n`).join('') +
    spreads.map((s) => `<idPkg:Spread src="Spreads/Spread_${s.self}.xml" />\n`).join('') +
    `<Section Self="usection" Length="${pageCount}" Name="" ContinueNumbering="false" IncludeSectionPrefix="false" Marker="" PageStart="${pageIds[0]}" SectionPrefix="" PageNumberStyle="${pageNumberStyle}" PageNumberStart="1" />\n` +
    `<idPkg:BackingStory src="XML/BackingStory.xml" />\n` +
    stories.map((s) => `<idPkg:Story src="Stories/Story_${s.self}.xml" />\n`).join('') +
    `</Document>\n`;

  const styleXml = (kind: 'Paragraph' | 'Character', s: StyleOut) => {
    const attrs = Object.entries(s.attrs)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}="${esc(String(v))}"`)
      .join(' ');
    return `<${kind}Style Self="${s.self}" Name="${s.name}"${attrs ? ' ' + attrs : ''}>${s.props.length ? `<Properties>${s.props.join('')}</Properties>` : ''}</${kind}Style>`;
  };
  const normalAttrs = paragraphAttrs({ size: base, leading: base * 1.2, align: 'justify', indent: (base * 1.5) / MM, hyphenate: true });
  const styles =
    `${HEAD}\n<idPkg:Styles ${PKG} DOMVersion="${DOM}">\n` +
    `<RootCharacterStyleGroup Self="ucstyles">\n<CharacterStyle Self="${NO_CHAR}" Name="$ID/[No character style]" />\n` +
    cStyles.map((s) => styleXml('Character', s)).join('\n') +
    `\n</RootCharacterStyleGroup>\n<RootParagraphStyleGroup Self="upstyles">\n` +
    `<ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]" />\n` +
    `<ParagraphStyle Self="${NORMAL}" Name="$ID/NormalParagraphStyle" ${Object.entries(normalAttrs.attrs)
      .map(([k, v]) => `${k}="${esc(String(v))}"`)
      .join(' ')} FillColor="Color/Black"><Properties><AppliedFont type="string">${esc(mainFont)}</AppliedFont>${normalAttrs.props.join('')}<AppliedLanguage type="object">Language/$ID/[No Language]</AppliedLanguage></Properties></ParagraphStyle>\n` +
    pStyles.map((s) => styleXml('Paragraph', s)).join('\n') +
    `\n</RootParagraphStyleGroup>\n` +
    `<RootCellStyleGroup Self="ucells"><CellStyle Self="CellStyle/$ID/[None]" Name="$ID/[None]" /></RootCellStyleGroup>\n` +
    `<RootTableStyleGroup Self="utables"><TableStyle Self="TableStyle/$ID/[No table style]" Name="$ID/[No table style]" /><TableStyle Self="TableStyle/$ID/[Basic Table]" Name="$ID/[Basic Table]" /></RootTableStyleGroup>\n` +
    `<RootObjectStyleGroup Self="uobjects"><ObjectStyle Self="ObjectStyle/$ID/[None]" Name="$ID/[None]" /><ObjectStyle Self="ObjectStyle/$ID/[Normal Graphics Frame]" Name="$ID/[Normal Graphics Frame]" /><ObjectStyle Self="ObjectStyle/$ID/[Normal Text Frame]" Name="$ID/[Normal Text Frame]" /></RootObjectStyleGroup>\n` +
    `</idPkg:Styles>\n`;

  const graphic =
    `${HEAD}\n<idPkg:Graphic ${PKG} DOMVersion="${DOM}">\n` +
    `<Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" ColorOverride="Specialblack" Name="Black" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937" />\n` +
    `<Color Self="Color/Paper" Model="Process" Space="CMYK" ColorValue="0 0 0 0" ColorOverride="Specialpaper" Name="Paper" ColorEditable="true" ColorRemovable="false" Visible="true" SwatchCreatorID="7937" />\n` +
    `<Color Self="Color/Registration" Model="Registration" Space="CMYK" ColorValue="100 100 100 100" ColorOverride="Specialregistration" Name="Registration" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937" />\n` +
    [...colours.entries()]
      .map(([hex, self]) => {
        const v = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ');
        return `<Color Self="${esc(self)}" Model="Process" Space="RGB" ColorValue="${v}" ColorOverride="Normal" Name="${esc(self.slice('Color/'.length))}" ColorEditable="true" ColorRemovable="true" Visible="true" SwatchCreatorID="7937" />\n`;
      })
      .join('') +
    `<Swatch Self="Swatch/None" Name="None" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937" />\n` +
    `<StrokeStyle Self="StrokeStyle/$ID/Solid" Name="$ID/Solid" />\n` +
    `</idPkg:Graphic>\n`;

  const preferences =
    `${HEAD}\n<idPkg:Preferences ${PKG} DOMVersion="${DOM}">\n` +
    `<DocumentPreference PageHeight="${num(H)}" PageWidth="${num(W)}" PagesPerDocument="1" FacingPages="${pg.facing}" DocumentBleedTopOffset="${num(3 * MM)}" DocumentBleedBottomOffset="${num(3 * MM)}" DocumentBleedInsideOrLeftOffset="${num(3 * MM)}" DocumentBleedOutsideOrRightOffset="${num(3 * MM)}" DocumentBleedUniformSize="false" PageBinding="LeftToRight" Intent="PrintIntent" CreatePrimaryTextFrame="false" AllowPageShuffle="true" />\n` +
    `<MarginPreference ColumnCount="1" ColumnGutter="12" Top="${num(pg.top * MM)}" Bottom="${num(pg.bottom * MM)}" Left="${num(pg.inner * MM)}" Right="${num(pg.outer * MM)}" ColumnDirection="Horizontal" ColumnsPositions="0 ${num(textWidth)}" />\n` +
    `<TextPreference SmartTextReflow="true" AddPages="EndOfStory" LimitToMasterTextFrames="false" PreserveFacingPageSpreads="false" DeleteEmptyPages="true" />\n` +
    `<ViewPreference HorizontalMeasurementUnits="Millimeters" VerticalMeasurementUnits="Millimeters" TypographicMeasurementUnits="Points" TextSizeMeasurementUnits="Points" />\n` +
    `<FootnoteOption StartAt="1" Prefix="" Suffix="" RestartNumbering="DontRestart" FootnoteNumberingStyle="Arabic" ShowPrefixSuffix="NoPrefixSuffix" />\n` +
    `</idPkg:Preferences>\n`;

  const parts: Record<string, string> = {
    mimetype: 'application/vnd.adobe.indesign-idml-package',
    'META-INF/container.xml': `${HEAD}\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="designmap.xml" media-type="text/xml"></rootfile></rootfiles></container>\n`,
    'designmap.xml': designmap,
    'Resources/Graphic.xml': graphic,
    'Resources/Fonts.xml': `${HEAD}\n<idPkg:Fonts ${PKG} DOMVersion="${DOM}" />\n`,
    'Resources/Styles.xml': styles,
    'Resources/Preferences.xml': preferences,
    'XML/BackingStory.xml': `${HEAD}\n<idPkg:BackingStory ${PKG} DOMVersion="${DOM}"><XmlStory Self="ubacking" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n"><ParagraphStyleRange AppliedParagraphStyle="${NORMAL}"><CharacterStyleRange AppliedCharacterStyle="${NO_CHAR}" /></ParagraphStyleRange></XmlStory></idPkg:BackingStory>\n`,
  };
  for (const m of masterSpreads) parts[`MasterSpreads/MasterSpread_${m.self}.xml`] = m.xml;
  for (const s of spreads) parts[`Spreads/Spread_${s.self}.xml`] = s.xml;
  for (const s of stories) parts[`Stories/Story_${s.self}.xml`] = s.xml;
  return { parts, pages: pageCount, warnings };
}

/**
 * Pages the text needs, roughly (InDesign fonts differ from the PDF's): lines from the length of
 * each paragraph, headings and pictures as some lines, new pages for \newpage and chapters
 * (odd pages in a two-sided book), and 15 % to spare so the last frame is not overset.
 */
export function estimatePages(blocks: Block[], m: { lineChars: number; lines: number; chapters: boolean; oddChapters: boolean }): number {
  let page = 1;
  let used = 0;
  const newPage = (odd: boolean) => {
    if (used > 0) {
      page++;
      used = 0;
    }
    if (odd && page % 2 === 0) page++;
  };
  for (const b of blocks) {
    const chapter = b.kind === 'heading' && b.level === 1 && m.chapters;
    if (b.newPage || chapter) newPage(chapter && m.oddChapters);
    let lines = 0;
    for (const r of b.runs) {
      if (r.type === 'text') lines += r.text.length / m.lineChars;
      else if (r.type === 'picture') lines += m.lines * 0.45;
      else if (r.type === 'footnote') lines += r.paragraphs.reduce((n, p) => n + p.runs.reduce((k, x) => k + (x.type === 'text' ? x.text.length : 0), 0), 0) / m.lineChars * 0.8 + 1;
      else lines += 1;
    }
    lines = Math.ceil(lines) + (b.kind === 'heading' ? 3 : 0.3);
    used += lines;
    while (used > m.lines) {
      page++;
      used -= m.lines;
    }
  }
  return Math.ceil(page * 1.15);
}

function characterAttrs(c: CharacterStyle, colour: (hex?: string) => string | undefined): Omit<StyleOut, 'self' | 'name'> {
  const attrs: StyleOut['attrs'] = {};
  const props: string[] = [];
  if (c.bold !== undefined || c.italic !== undefined) attrs.FontStyle = fontStyleOf(c.bold, c.italic);
  if (c.smallCaps) attrs.Capitalization = 'SmallCaps';
  if (c.color) attrs.FillColor = colour(c.color);
  if (c.tracking) attrs.Tracking = Math.round(c.tracking);
  if (c.font) props.push(`<AppliedFont type="string">${esc(fontFamily(c.font))}</AppliedFont>`);
  return { attrs, props };
}

function footOnly(): MasterPage['odd'] {
  const empty = { kind: 'empty' as const };
  return { head: { left: empty, center: empty, right: empty }, foot: { left: empty, center: { kind: 'page' }, right: empty } };
}

function storyXml(self: string, body: string): string {
  return (
    `${HEAD}\n<idPkg:Story ${PKG} DOMVersion="${DOM}">\n` +
    `<Story Self="${self}" UserText="true" IsEndnoteStory="false" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">\n` +
    `<StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection" />\n` +
    `${body}\n</Story>\n</idPkg:Story>\n`
  );
}

/** Corners of a rectangle as IDML path points: top-left, bottom-left, bottom-right, top-right. */
function pathPoints(x: number, y: number, w: number, h: number): string {
  return [
    [x, y],
    [x, y + h],
    [x + w, y + h],
    [x + w, y],
  ]
    .map(([a, b]) => `<PathPointType Anchor="${num(a!)} ${num(b!)}" LeftDirection="${num(a!)} ${num(b!)}" RightDirection="${num(a!)} ${num(b!)}" />`)
    .join('');
}

function pageXml(self: string, name: string, master: string, x0: number, W: number, H: number, left: number, right: number, top: number, bottom: number): string {
  return (
    `<Page Self="${self}" Name="${esc(name)}" AppliedMaster="${master}" MasterPageTransform="1 0 0 1 0 0" GeometricBounds="0 0 ${num(H)} ${num(W)}" ItemTransform="1 0 0 1 ${num(x0)} ${num(-H / 2)}">` +
    `<MarginPreference ColumnCount="1" ColumnGutter="12" Top="${num(top)}" Bottom="${num(bottom)}" Left="${num(left)}" Right="${num(right)}" ColumnDirection="Horizontal" ColumnsPositions="0 ${num(W - left - right)}" />` +
    `</Page>`
  );
}

function textFrameXml(self: string, story: string, prev: string, next: string, x: number, y: number, w: number, h: number): string {
  return (
    `<TextFrame Self="${self}" ParentStory="${story}" PreviousTextFrame="${prev}" NextTextFrame="${next}" ContentType="TextType" ItemLayer="ulayer" AppliedObjectStyle="ObjectStyle/$ID/[Normal Text Frame]" ItemTransform="1 0 0 1 0 0">` +
    `<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>${pathPoints(x, y, w, h)}</PathPointArray></GeometryPathType></PathGeometry></Properties>` +
    `<TextFramePreference TextColumnCount="1" />` +
    `</TextFrame>`
  );
}

/**
 * Size of a PNG, JPEG or PDF from the start of its file: pixels and the pixels per inch it
 * stores (72 when none; a PDF's first MediaBox in points, at 72). Null when it is none of these.
 */
export function imageInfo(data: Uint8Array): Omit<IdmlPicture, 'uri'> | null {
  const u16 = (i: number) => (data[i]! << 8) | data[i + 1]!;
  const u32 = (i: number) => ((data[i]! << 24) >>> 0) + (data[i + 1]! << 16) + (data[i + 2]! << 8) + data[i + 3]!;
  if (data.length > 24 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    let ppi = 72;
    for (let i = 8; i + 12 <= data.length; ) {
      const len = u32(i);
      const type = String.fromCharCode(data[i + 4]!, data[i + 5]!, data[i + 6]!, data[i + 7]!);
      if (type === 'pHYs' && data[i + 16] === 1) ppi = Math.round(u32(i + 8) * 0.0254) || 72;
      if (type === 'IDAT' || type === 'IEND') break;
      i += 12 + len;
    }
    return { widthPx: u32(16), heightPx: u32(20), ppi, format: 'png' };
  }
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let ppi = 72;
    for (let i = 2; i + 9 < data.length; ) {
      if (data[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = data[i + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = u16(i + 2);
      // JFIF density in dots per inch (units 1) or per cm (units 2).
      if (marker === 0xe0 && String.fromCharCode(...data.subarray(i + 4, i + 8)) === 'JFIF') {
        const units = data[i + 11];
        const x = u16(i + 12);
        if (units === 1 && x > 1) ppi = x;
        else if (units === 2 && x > 1) ppi = Math.round(x * 2.54);
      }
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { widthPx: u16(i + 7), heightPx: u16(i + 5), ppi, format: 'jpeg' };
      }
      i += 2 + len;
    }
    return null;
  }
  const head = new TextDecoder('latin1').decode(data.subarray(0, Math.min(data.length, 400_000)));
  if (head.startsWith('%PDF')) {
    const box = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(head);
    if (!box) return { widthPx: 595, heightPx: 842, ppi: 72, format: 'pdf' };
    return { widthPx: Math.abs(Number(box[3]) - Number(box[1])), heightPx: Math.abs(Number(box[4]) - Number(box[2])), ppi: 72, format: 'pdf' };
  }
  return null;
}
