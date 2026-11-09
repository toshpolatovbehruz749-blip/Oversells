import {
  defaultPageDesign,
  escapeLatex,
  generatePageDesignPackage,
  normalizePageDesign,
  type Align,
  type CharacterStyle,
  type PageDesignSpec,
  type ParagraphStyle,
} from './page-design.js';

/**
 * InDesign IDML import for «Sahifa dizayni». An .idml file is a ZIP of XML
 * parts; the caller unzips it and passes the parts by path. Taken over: the
 * text of the stories in the order their frames appear on the spreads, the
 * paragraph and character styles (size, leading, alignment, indents, spacing,
 * bold/italic, colour, drop caps, based-on), headings, footnotes, the page size
 * and the margins of the first master. Not taken over: exact frame positions,
 * tables (their text is kept as paragraphs), linked pictures (only listed),
 * fonts (listed: they may not be installed).
 */

// --- a small XML reader (IDML is plain, generated XML: no DTD, no entities of its own) -------

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: (XmlNode | string)[];
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITY[e] ?? m;
  });
}

/** Parses XML into elements and text; comments, processing instructions and DOCTYPE are skipped. */
export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[2] !== undefined) {
      if (stack.length > 1 && top.name === m[2]) stack.pop();
    } else if (m[3] !== undefined) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? '').matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]!] = decode(a[2] ?? a[3] ?? '');
      const node: XmlNode = { name: m[3], attrs, children: [] };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.children.push(decode(m[6]));
  }
  return root;
}

const elements = (n: XmlNode): XmlNode[] => n.children.filter((c): c is XmlNode => typeof c !== 'string');
/** All descendants with that local name (namespace prefixes ignored). */
function findAll(n: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of elements(n)) {
    if (c.name === name || c.name.endsWith(`:${name}`)) out.push(c);
    findAll(c, name, out);
  }
  return out;
}
const child = (n: XmlNode, name: string) => elements(n).find((c) => c.name === name);
/** A style property: an attribute, or <Properties><Name>value</Name></Properties>. */
function prop(n: XmlNode, name: string): string | undefined {
  if (n.attrs[name] !== undefined) return n.attrs[name];
  const p = child(n, 'Properties');
  const v = p && child(p, name);
  return v ? v.children.filter((c): c is string => typeof c === 'string').join('').trim() : undefined;
}

// --- styles -------------------------------------------------------------------------------

const PT_TO_MM = 25.4 / 72;
const round1 = (v: number) => Math.round(v * 10) / 10;
const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v === '' || v === 'Auto') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const clamp = (v: number | undefined, min: number, max: number) => (v === undefined ? undefined : Math.min(max, Math.max(min, v)));

/** The name of a style reference ("ParagraphStyle/Group%3aSarlavha 1") as shown in InDesign. */
function styleName(ref: string): string {
  const raw = ref.replace(/^(Paragraph|Character)Style\//, '');
  const name = safeDecode(raw.replace(/%(?![0-9A-Fa-f]{2})/g, '%25'));
  return name.slice(name.lastIndexOf(':') + 1);
}
/** decodeURIComponent that keeps the text as it is when it is not valid UTF-8 (%FF). */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
/** One line of a TeX comment: no line breaks (a new line would end the comment and run as TeX). */
const commentLine = (s: string) => s.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, ' ');
const isNone = (ref: string | undefined) =>
  !ref || /\$ID\/(\[No (paragraph|character) style\]|NormalParagraphStyle|\[Basic Paragraph\])/.test(ref) || /\[Basic Paragraph\]$/.test(ref);

/** A style id from a name: Latin letters and digits, starting with a letter; unique within `taken`. */
function styleId(name: string, taken: Set<string>): string {
  const latin = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '');
  const base = (/^[a-z]/.test(latin) ? latin : `uslub${latin}`).slice(0, 26) || 'uslub';
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}${i}`;
  taken.add(id);
  return id;
}

/** RRGGBB of an IDML colour (CMYK, RGB or LAB values), if it is one. */
function colourHex(c: XmlNode | undefined): string | undefined {
  if (!c) return undefined;
  const v = (c.attrs.ColorValue ?? '').split(/\s+/).map(Number);
  const hex = (r: number, g: number, b: number) =>
    [r, g, b].map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('').toUpperCase();
  if (c.attrs.Space === 'RGB' && v.length >= 3) return hex(v[0]!, v[1]!, v[2]!);
  if (c.attrs.Space === 'CMYK' && v.length >= 4) {
    const [C, M, Y, K] = v.map((x) => x / 100) as [number, number, number, number];
    return hex(255 * (1 - C) * (1 - K), 255 * (1 - M) * (1 - K), 255 * (1 - Y) * (1 - K));
  }
  return undefined;
}

const HEADING = /^(heading|sarlavha|заголовок|header|title|h)\s*([1-3])$/i;
const ALIGN: Record<string, Align> = {
  LeftAlign: 'left',
  CenterAlign: 'center',
  RightAlign: 'right',
  LeftJustified: 'justify',
  CenterJustified: 'justify',
  RightJustified: 'justify',
  FullyJustified: 'justify',
};

export type IdmlWarning =
  | { kind: 'font'; name: string }
  | { kind: 'picture'; name: string }
  | { kind: 'table'; count: number }
  | { kind: 'columns'; count: number }
  | { kind: 'noText' };

export interface IdmlResult {
  mainTex: string;
  design: PageDesignSpec;
  sahifaSty: string;
  warnings: IdmlWarning[];
}

export class IdmlError extends Error {}

/**
 * Converts the parts of an unzipped .idml (path → XML text) into main.tex and a
 * page design. Throws IdmlError when it is not an IDML document.
 */
export function idmlToLatex(parts: Record<string, string>, title: string): IdmlResult {
  const designmap = parts['designmap.xml'];
  if (!designmap || !/<Document\b/.test(designmap)) throw new IdmlError('Not an InDesign IDML document');
  const xml = (path: string) => (parts[path] ? parseXml(parts[path]!) : null);
  const warnings: IdmlWarning[] = [];

  // Colours (Resources/Graphic.xml).
  const colours = new Map<string, string>();
  const graphic = xml('Resources/Graphic.xml');
  if (graphic) for (const c of findAll(graphic, 'Color')) {
    const h = colourHex(c);
    if (h && c.attrs.Self) colours.set(c.attrs.Self, h);
  }
  const colourOf = (ref: string | undefined) => {
    const h = ref ? colours.get(ref) : undefined;
    return h && h !== '000000' && h !== 'FFFFFF' ? h : undefined;
  };

  // Styles (Resources/Styles.xml).
  const styles = xml('Resources/Styles.xml');
  const taken = new Set<string>();
  const paragraphById = new Map<string, ParagraphStyle>();
  const characterById = new Map<string, CharacterStyle>();
  const fonts = new Set<string>();
  const pStyles = styles ? findAll(styles, 'ParagraphStyle') : [];
  const cStyles = styles ? findAll(styles, 'CharacterStyle') : [];
  const fontStyle = (n: XmlNode) => (n.attrs.FontStyle ?? prop(n, 'FontStyle') ?? '').toLowerCase();
  for (const s of pStyles) {
    const ref = s.attrs.Self;
    if (!ref || isNone(ref)) continue;
    const name = s.attrs.Name ? styleName(s.attrs.Name) : styleName(ref);
    const font = prop(s, 'AppliedFont');
    if (font) fonts.add(font);
    const fs = fontStyle(s);
    const heading = HEADING.exec(name.trim());
    const leading = num(prop(s, 'Leading'));
    const dropLines = num(s.attrs.DropCapLines);
    paragraphById.set(
      ref,
      Object.fromEntries(
        Object.entries({
          id: styleId(name, taken),
          name: name.slice(0, 60) || 'Uslub',
          heading: heading ? (Number(heading[2]) as 1 | 2 | 3) : undefined,
          size: clamp(num(s.attrs.PointSize), 4, 96),
          leading: clamp(leading, 4, 144),
          align: ALIGN[s.attrs.Justification ?? ''],
          indent: clamp(num(s.attrs.FirstLineIndent) !== undefined ? round1(num(s.attrs.FirstLineIndent)! * PT_TO_MM) : undefined, 0, 60),
          leftIndent: clamp(num(s.attrs.LeftIndent) !== undefined ? round1(num(s.attrs.LeftIndent)! * PT_TO_MM) : undefined, 0, 100),
          spaceBefore: clamp(num(s.attrs.SpaceBefore), 0, 200),
          spaceAfter: clamp(num(s.attrs.SpaceAfter), 0, 200),
          bold: /bold|semibold|black|heavy/.test(fs) || undefined,
          italic: /italic|oblique/.test(fs) || undefined,
          color: colourOf(s.attrs.FillColor),
          hyphenate: s.attrs.Hyphenation === 'false' ? false : undefined,
          keepWithNext: num(s.attrs.KeepWithNext) ? true : undefined,
          dropCap: dropLines && dropLines >= 2 ? (Math.min(4, dropLines) as 2 | 3 | 4) : undefined,
        }).filter(([, v]) => v !== undefined),
      ) as unknown as ParagraphStyle,
    );
  }
  // basedOn, now that every style has an id; a link that would close a loop (A → B → A) is left out.
  const byId = new Map([...paragraphById.values()].map((p) => [p.id, p]));
  const reaches = (from: ParagraphStyle, to: ParagraphStyle) => {
    for (let s: ParagraphStyle | undefined = from, i = 0; s && i < 100; s = s.basedOn ? byId.get(s.basedOn) : undefined, i++) {
      if (s === to) return true;
    }
    return false;
  };
  for (const s of pStyles) {
    const own = s.attrs.Self ? paragraphById.get(s.attrs.Self) : undefined;
    const base = prop(s, 'BasedOn');
    const parent = base && !isNone(base) ? paragraphById.get(base) : undefined;
    if (own && parent && parent !== own && !own.heading && !reaches(parent, own)) own.basedOn = parent.id;
  }
  for (const s of cStyles) {
    const ref = s.attrs.Self;
    if (!ref || isNone(ref)) continue;
    const name = s.attrs.Name ? styleName(s.attrs.Name) : styleName(ref);
    const font = prop(s, 'AppliedFont');
    if (font) fonts.add(font);
    const fs = fontStyle(s);
    characterById.set(
      ref,
      Object.fromEntries(
        Object.entries({
          id: styleId(name, taken),
          name: name.slice(0, 60) || 'Belgi',
          bold: /bold|semibold|black|heavy/.test(fs) || undefined,
          italic: /italic|oblique/.test(fs) || undefined,
          smallCaps: s.attrs.Capitalization === 'SmallCaps' || undefined,
          color: colourOf(s.attrs.FillColor),
        }).filter(([, v]) => v !== undefined),
      ) as unknown as CharacterStyle,
    );
  }

  // Page size and margins.
  const prefs = xml('Resources/Preferences.xml');
  const docPref = prefs ? findAll(prefs, 'DocumentPreference')[0] : undefined;
  const pageW = num(docPref?.attrs.PageWidth) ?? 595.28;
  const pageH = num(docPref?.attrs.PageHeight) ?? 841.89;
  const facing = docPref?.attrs.FacingPages !== 'false';
  const dm = parseXml(designmap);
  const srcs = (kind: string) => findAll(dm, kind).map((n) => n.attrs.src).filter((s): s is string => !!s);
  const masterPage = srcs('MasterSpread')
    .map((p) => xml(p))
    .flatMap((m) => (m ? findAll(m, 'Page') : []))[0];
  const margin = masterPage ? findAll(masterPage, 'MarginPreference')[0] : undefined;
  const columns = num(margin?.attrs.ColumnCount) ?? 1;
  if (columns > 1) warnings.push({ kind: 'columns', count: columns });

  // Stories in the order their frames appear on the spreads; then any left over.
  const order: string[] = [];
  const pictures = new Set<string>();
  for (const sp of srcs('Spread')) {
    const s = xml(sp);
    if (!s) continue;
    for (const frame of findAll(s, 'TextFrame')) {
      const story = frame.attrs.ParentStory;
      if (story && !order.includes(story)) order.push(story);
    }
    for (const link of findAll(s, 'Link')) {
      const uri = link.attrs.LinkResourceURI ?? '';
      const name = safeDecode(uri.slice(uri.lastIndexOf('/') + 1));
      if (name) pictures.add(name);
    }
  }
  const storyFiles = new Map<string, string>();
  for (const src of srcs('Story')) {
    const self = /Story_(.+)\.xml$/.exec(src)?.[1];
    if (self) storyFiles.set(self, src);
  }
  for (const self of storyFiles.keys()) if (!order.includes(self)) order.push(self);

  // Text.
  const used = { headings: new Set<ParagraphStyle>() };
  let tables = 0;
  const body: string[] = [];
  const inline = (n: XmlNode): string => {
    let out = '';
    for (const c of n.children) {
      if (typeof c === 'string') continue;
      if (c.name === 'Content') out += escapeLatex(c.children.filter((x): x is string => typeof x === 'string').join('').replace(/\u2028/g, '\n').replace(/\t/g, ' ').replace(/[\uFEFF\u200B]/g, '')).replace(/\n/g, '\\\\ ');
      else if (c.name === 'Br') out += '\n\n';
      else if (c.name === 'Footnote') out += `\\footnote{${trimBreaks(paragraphText(c).replace(/\n\n+/g, ' '))}}`;
      else if (c.name === 'CharacterStyleRange') {
        const text = inline(c);
        const ref = c.attrs.AppliedCharacterStyle;
        const style = ref && !isNone(ref) ? characterById.get(ref) : undefined;
        const fs = (c.attrs.FontStyle ?? '').toLowerCase();
        // Paragraph breaks inside a styled run end the style and open it again.
        const wrap = (t: string) => {
          let w = t;
          if (/bold|semibold|black|heavy/.test(fs)) w = `\\textbf{${w}}`;
          if (/italic|oblique/.test(fs)) w = `\\textit{${w}}`;
          if (style) w = `\\matnuslubi{${style.id}}{${w}}`;
          return w;
        };
        out += text
          .split('\n\n')
          .map((t) => (t.trim() ? wrap(t) : t))
          .join('\n\n');
      } else if (c.name === 'Table') {
        tables++;
        out += '\n\n' + findAll(c, 'Cell').map((cell) => paragraphText(cell).trim()).filter(Boolean).join('\n\n') + '\n\n';
      } else out += inline(c);
    }
    return out;
  };
  const paragraphText = (n: XmlNode) => inline(n);
  // A forced line break (U+2028) at the start or end of a paragraph would be «There's no line here to end».
  const trimBreaks = (t: string) => t.replace(/^(\s*\\\\\s*)+/, '').replace(/(\s*\\\\\s*)+$/, '').trim();
  const commands = ['section', 'subsection', 'subsubsection'];
  for (const self of order) {
    const src = storyFiles.get(self);
    const story = src ? xml(src) : null;
    if (!story) continue;
    for (const psr of topRanges(story)) {
      const ref = psr.attrs.AppliedParagraphStyle;
      const style = ref && !isNone(ref) ? paragraphById.get(ref) : undefined;
      for (const para of inline(psr).split(/\n\n+/)) {
        const text = trimBreaks(para);
        if (!text) continue;
        if (style?.heading) {
          used.headings.add(style);
          // A forced line break (\\) inside \section breaks the contents and running heads.
          body.push(`\\${commands[style.heading - 1]}{${text.replace(/\s*\\\\\s*/g, ' ')}}`);
        } else if (style) body.push(`\\begin{uslub}{${style.id}}\n${text}\n\\end{uslub}`);
        else body.push(text);
      }
    }
  }
  if (tables) warnings.push({ kind: 'table', count: tables });
  if (!body.length) warnings.push({ kind: 'noText' });
  for (const f of fonts) warnings.push({ kind: 'font', name: f });
  for (const p of pictures) warnings.push({ kind: 'picture', name: p });

  // The design: the defaults with the IDML styles; geometry from the first master.
  const design = defaultPageDesign(title.slice(0, 120));
  const mm = (v: string | undefined) => (num(v) !== undefined ? clamp(round1(num(v)! * PT_TO_MM), 3, 80) : undefined);
  design.paragraphStyles = [...paragraphById.values()].slice(0, 60);
  design.characterStyles = [...characterById.values()].slice(0, 60);
  design.chapterOpensRight = false;
  const page = { inner: mm(margin?.attrs.Left), outer: mm(margin?.attrs.Right), top: mm(margin?.attrs.Top), bottom: mm(margin?.attrs.Bottom) };
  design.page = Object.fromEntries(Object.entries(page).filter(([, v]) => v !== undefined));
  const spec = normalizePageDesign(design);

  const w = round1(pageW * PT_TO_MM);
  const h = round1(pageH * PT_TO_MM);
  const notes = warnings
    .filter((x) => x.kind === 'font' || x.kind === 'picture')
    .map((x) => `% ${x.kind === 'font' ? 'Shrift' : 'Rasm (IDML ichida emas, alohida yuklang)'}: ${commentLine((x as { name: string }).name)}`);
  const mainTex = [
    `% Imported from InDesign (IDML): ${commentLine(escapeLatex(title))}`,
    '% Styles are in sahifa.sty («Sahifa» button); page size and margins come from the IDML.',
    ...notes,
    `\\documentclass[11pt${facing ? ',twoside' : ''}]{article}`,
    `\\usepackage[paperwidth=${w}mm,paperheight=${h}mm]{geometry}`,
    '\\usepackage{fontspec}',
    '\\setmainfont{Noto Serif}',
    '\\usepackage{babel}',
    '\\babelprovide[import=uz-Latn, main]{uzbek}',
    '\\def\\uzbekhyphenmins{22}',
    '\\usepackage{sahifa} % Oversells sahifa dizayni (sahifa.sty)',
    '',
    '\\begin{document}',
    '',
    body.join('\n\n'),
    '',
    '\\end{document}',
    '',
  ].join('\n');
  return { mainTex, design: spec, sahifaSty: generatePageDesignPackage(spec), warnings };
}

/** The paragraph ranges of a story, not those inside footnotes or tables (their parents write them). */
function topRanges(n: XmlNode, out: XmlNode[] = []): XmlNode[] {
  for (const c of elements(n)) {
    if (c.name === 'ParagraphStyleRange') out.push(c);
    else if (c.name !== 'Footnote' && c.name !== 'Table') topRanges(c, out);
  }
  return out;
}
