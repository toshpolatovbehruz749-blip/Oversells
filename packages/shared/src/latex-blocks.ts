/**
 * LaTeX prose → paragraphs with styles and runs, for layout programs (InDesign IDML export).
 * Not a TeX engine: it knows the structure a textbook or a novel written in Oversells uses
 * (sectioning, «Sahifa dizayni» styles, lists, quotes, footnotes, pictures, bold/italic) and
 * keeps the text of everything else. Maths, drawings and tables cannot become InDesign objects:
 * formulas keep their LaTeX source (counted as warnings), drawings leave a placeholder, table
 * cells are separated by tabs.
 */

export type BlockAlign = 'left' | 'center' | 'right' | 'justify';

export interface TextRun {
  type: 'text';
  text: string;
  bold?: boolean;
  italic?: boolean;
  smallCaps?: boolean;
  underline?: boolean;
  /** A «Sahifa dizayni» character style id (\matnuslubi). */
  charStyle?: string;
  /** LaTeX source of a formula. */
  formula?: boolean;
}
export interface FootnoteRun {
  type: 'footnote';
  paragraphs: Block[];
}
export interface PictureRun {
  type: 'picture';
  file: string;
  /** Width as a share of the text width (0–1), or in mm. */
  widthShare?: number;
  widthMm?: number;
}
/** A forced line break (\\). */
export interface BreakRun {
  type: 'break';
}
export type Run = TextRun | FootnoteRun | PictureRun | BreakRun;

export type BlockKind = 'body' | 'heading' | 'style' | 'list' | 'quote' | 'caption' | 'title';
export interface Block {
  kind: BlockKind;
  /** heading: 1–3. */
  level?: 1 | 2 | 3;
  /** style: a «Sahifa dizayni» paragraph style id. */
  style?: string;
  align?: BlockAlign;
  /** Starts on a new page (\newpage, \clearpage, a chapter). */
  newPage?: boolean;
  runs: Run[];
}

export interface BlocksResult {
  blocks: Block[];
  formulas: number;
  drawings: number;
  tables: number;
  /** Pictures referred to (project paths, as written). */
  pictures: string[];
  /** The document class has \chapter (book, report, memoir…). */
  chapters: boolean;
}

interface Style {
  bold?: boolean;
  italic?: boolean;
  smallCaps?: boolean;
  underline?: boolean;
  charStyle?: string;
}

/** Commands whose arguments are not text: dropped with all their arguments. */
const DROP = new Set([
  'label', 'index', 'vspace', 'hspace', 'vskip', 'hskip', 'setlength', 'addtolength', 'thispagestyle', 'pagestyle',
  'pagenumbering', 'setcounter', 'addtocounter', 'stepcounter', 'bobbezagi', 'sahifausta', 'bosbet', 'null',
  'noindent', 'indent', 'centering', 'raggedright', 'raggedleft', 'smallskip', 'medskip', 'bigskip', 'vfill',
  'hfill', 'tableofcontents', 'listoffigures', 'listoftables', 'maketitle', 'frontmatter', 'mainmatter',
  'backmatter', 'appendix', 'nopagebreak', 'pagebreak', 'linebreak', 'nolinebreak', 'allowbreak', 'protect',
  'phantomsection', 'addcontentsline', 'markboth', 'markright', 'selectlanguage', 'usetikzlibrary', 'graphicspath',
  'newcommand', 'renewcommand', 'providecommand', 'newenvironment', 'renewenvironment', 'def', 'let', 'color',
  'normalfont', 'normalsize', 'small', 'footnotesize', 'scriptsize', 'tiny', 'large', 'Large', 'LARGE', 'huge',
  'Huge', 'bfseries', 'itshape', 'mdseries', 'upshape', 'rmfamily', 'sffamily', 'ttfamily', 'scshape', 'par',
  'nobreak', 'clearpage', 'newpage', 'cleardoublepage', 'item', 'ref', 'pageref', 'eqref', 'cite', 'include', 'input',
  'babelprovide', 'nocite', 'bibliography', 'bibliographystyle', 'printbibliography', 'yozishchiziqlari', 'javobjoyi',
  'katakjoy', 'caption', 'includegraphics', 'rasmramka', 'torrasm', 'footnote', 'textbf', 'textit', 'emph', 'textsc',
  'underline', 'matnuslubi', 'textcolor', 'colorbox', 'fbox', 'mbox', 'hbox', 'text', 'textrm', 'textsf', 'texttt',
  'textup', 'textmd', 'textnormal', 'url', 'href',
]);
/** Text-producing commands without arguments. */
const SYMBOLS: Record<string, string> = {
  ldots: '…', dots: '…', textellipsis: '…', LaTeX: 'LaTeX', TeX: 'TeX', textbackslash: '\\', textasciitilde: '~',
  textasciicircum: '^', textendash: '–', textemdash: '—', textquoteleft: '‘', textquoteright: '’', guillemotleft: '«',
  guillemotright: '»', S: '§', P: '¶', copyright: '©', textregistered: '®', textdegree: '°', ss: 'ß', quad: ' ',
  qquad: '  ', enspace: ' ', thinspace: ' ', today: '', slash: '/', textbar: '|', textless: '<',
  textgreater: '>', textbullet: '•', textperiodcentered: '·', textnumero: '№', No: '№',
};
const ESCAPED = new Set(['%', '&', '$', '#', '_', '{', '}', ' ', ',', ';', ':', '!', '-', '/', '@']);
/** \, is a thin space; \- \! \/ \@ print nothing. */
const ESCAPED_TEXT: Record<string, string> = { ' ': ' ', ',': ' ', ';': ' ', ':': ' ', '!': '', '-': '', '/': '', '@': '' };
const MATH_ENVS = new Set([
  'equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*', 'gather', 'gather*', 'multline', 'multline*',
  'flalign', 'flalign*', 'eqnarray', 'eqnarray*', 'math', 'displaymath',
]);
const DRAWING_ENVS = new Set(['tikzpicture', 'axis', 'koordinata', 'chizma', 'pspicture', 'picture']);
const SKIP_ENVS = new Set(['comment', 'thebibliography']);
const VERBATIM_ENVS = new Set(['verbatim', 'Verbatim', 'lstlisting', 'minted']);
const TABLE_ENVS = new Set(['tabular', 'tabular*', 'tabularx', 'longtable', 'array']);
const LIST_ENVS = new Set(['itemize', 'enumerate', 'description']);
const QUOTE_ENVS = new Set(['quote', 'quotation', 'verse']);
const ALIGN_ENVS: Record<string, BlockAlign> = { center: 'center', flushleft: 'left', flushright: 'right' };
/** Environments whose first mandatory arguments are names, not text. */
const ENV_NAME_ARGS: Record<string, number> = { otherlanguage: 1, 'otherlanguage*': 1, hyphenrules: 1, tcolorbox: 0, mdframed: 0 };

/** Removes comments (an unescaped % to the end of the line, and the line break after it). */
export function stripComments(tex: string): string {
  return tex.replace(/(^|[^\\])((?:\\\\)*)%[^\n]*(\n[ \t]*)?/g, (_m, a: string, b: string) => a + b);
}

/** The body of a document: between \begin{document} and \end{document} (all of it when they are absent). */
export function documentBody(tex: string): string {
  const begin = tex.indexOf('\\begin{document}');
  const end = tex.lastIndexOf('\\end{document}');
  return tex.slice(begin === -1 ? 0 : begin + '\\begin{document}'.length, end === -1 || end < begin ? tex.length : end);
}

/**
 * Paragraphs of a LaTeX document. `readFile` gives the text of \input / \include files
 * (a project path with or without .tex), null when there is none.
 */
export function latexToBlocks(mainTex: string, readFile: (path: string) => string | null = () => null): BlocksResult {
  const preamble = stripComments(mainTex.slice(0, Math.max(0, mainTex.indexOf('\\begin{document}'))));
  const cls = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(preamble)?.[1] ?? 'article';
  const chapters = /book|report|memoir|scrbook|scrreprt/.test(cls);
  const out: BlocksResult = { blocks: [], formulas: 0, drawings: 0, tables: 0, pictures: [], chapters };

  // Inlines \input/\include (depth-limited, each file once per chain).
  const expand = (text: string, depth: number, seen: Set<string>): string =>
    stripComments(text).replace(/\\(input|include)\s*\{([^}]+)\}/g, (_m, _k: string, name: string) => {
      const path = name.trim().replace(/^\.\//, '');
      const file = path.endsWith('.tex') ? path : `${path}.tex`;
      if (depth > 8 || seen.has(file)) return '';
      const t = readFile(file) ?? readFile(path);
      if (t === null) return '';
      const inner = expand(t, depth + 1, new Set([...seen, file]));
      return name === file || path === file ? `\n\n${inner}\n\n` : `\n\n${inner}\n\n`;
    });
  const body = expand(documentBody(mainTex), 0, new Set());
  new Parser(body, out).run();
  return out;
}

class Parser {
  private i = 0;
  private current: Block | null = null;
  private pendingNewPage = false;
  private readonly stack: Array<{ kind: BlockKind; style?: string; align?: BlockAlign; listCounter?: number; listType?: string }> = [];

  constructor(
    private readonly s: string,
    private readonly out: BlocksResult,
    private readonly target: Block[] = out.blocks,
  ) {}

  run(): void {
    this.parse(this.s.length, {});
    this.endParagraph();
  }

  private context() {
    return this.stack[this.stack.length - 1];
  }

  private block(): Block {
    if (!this.current) {
      const c = this.context();
      this.current = {
        kind: c?.kind ?? 'body',
        ...(c?.style ? { style: c.style } : {}),
        ...(c?.align ? { align: c.align } : {}),
        ...(this.pendingNewPage ? { newPage: true } : {}),
        runs: [],
      };
      this.pendingNewPage = false;
    }
    return this.current;
  }

  private endParagraph(): void {
    const b = this.current;
    this.current = null;
    if (!b) return;
    // Trim spaces and breaks at the edges; drop empty paragraphs.
    while (b.runs.length && (b.runs[0]!.type === 'break' || (b.runs[0]!.type === 'text' && !b.runs[0]!.text.trim()))) b.runs.shift();
    while (b.runs.length && (b.runs.at(-1)!.type === 'break' || (b.runs.at(-1)!.type === 'text' && !(b.runs.at(-1) as TextRun).text.trim()))) b.runs.pop();
    const first = b.runs[0];
    if (first?.type === 'text') first.text = first.text.replace(/^\s+/, '');
    const last = b.runs.at(-1);
    if (last?.type === 'text') last.text = last.text.replace(/\s+$/, '');
    if (b.runs.length) this.target.push(b);
    else if (b.newPage) this.pendingNewPage = true;
  }

  private text(t: string, style: Style, extra: Partial<TextRun> = {}): void {
    if (!t) return;
    const b = this.block();
    const prev = b.runs.at(-1);
    const run: TextRun = { type: 'text', text: t, ...style, ...extra };
    for (const k of Object.keys(run) as (keyof TextRun)[]) if (run[k] === undefined || run[k] === false) delete run[k];
    if (prev?.type === 'text' && sameStyle(prev, run)) prev.text += t;
    else {
      if (!prev && !t.trim()) return;
      b.runs.push(run);
    }
  }

  private peek(n = 0) {
    return this.s[this.i + n];
  }

  private skipSpaces(): void {
    while (this.i < this.s.length && /[ \t]/.test(this.s[this.i]!)) this.i++;
  }
  /** Spaces and at most one line break (not a blank line) before an argument. */
  private skipArgSpace(): void {
    const save = this.i;
    let newlines = 0;
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) {
      if (this.s[this.i] === '\n') newlines++;
      this.i++;
    }
    if (newlines > 1) this.i = save;
  }

  /** The content of a group starting at this.i ('{' or '['), without the brackets; null when none. */
  private group(open: '{' | '['): string | null {
    const save = this.i;
    this.skipArgSpace();
    if (this.s[this.i] !== open) {
      this.i = save;
      return null;
    }
    const start = this.i + 1;
    let depth = 0;
    for (let j = start; j < this.s.length; j++) {
      const c = this.s[j];
      if (c === '\\') {
        j++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        if (depth === 0 && open === '{') {
          this.i = j + 1;
          return this.s.slice(start, j);
        }
        depth--;
      } else if (c === ']' && open === '[' && depth === 0) {
        this.i = j + 1;
        return this.s.slice(start, j);
      }
    }
    this.i = this.s.length;
    return this.s.slice(start);
  }

  /** Skips optional and mandatory arguments of a command (any number of [...] and {...}). */
  private skipArgs(maxMandatory = 9): void {
    for (let n = 0; n < 12; n++) {
      if (this.group('[') !== null) continue;
      if (maxMandatory > 0 && this.group('{') !== null) {
        maxMandatory--;
        continue;
      }
      break;
    }
  }

  /** Parses a piece of LaTeX inline into the current paragraph, with a style. */
  private inline(src: string, style: Style): void {
    const sub = new Parser(src, this.out, this.target);
    sub.current = this.block();
    sub.stack.push(...this.stack);
    sub.parse(src.length, style);
    // Paragraph breaks inside the argument end paragraphs of this parser too.
    this.current = sub.current;
    this.pendingNewPage = sub.pendingNewPage || this.pendingNewPage;
  }

  /** Paragraphs of a footnote (a parser of its own, writing into its own list). */
  private footnote(src: string): FootnoteRun {
    const paragraphs: Block[] = [];
    const sub = new Parser(src, this.out, paragraphs);
    sub.run();
    return { type: 'footnote', paragraphs };
  }

  private parse(end: number, style: Style): void {
    while (this.i < end) {
      const c = this.s[this.i]!;
      if (c === '\\') {
        this.command(style);
        continue;
      }
      if (c === '\n') {
        // A blank line ends the paragraph.
        let j = this.i + 1;
        while (j < end && /[ \t]/.test(this.s[j]!)) j++;
        if (this.s[j] === '\n') {
          this.endParagraph();
          while (j < end && /\s/.test(this.s[j]!)) j++;
          this.i = j;
        } else {
          this.text(' ', style);
          this.i = j;
        }
        continue;
      }
      if (c === '$') {
        this.math(style);
        continue;
      }
      if (c === '{') {
        const inner = this.group('{') ?? '';
        this.inline(inner, style);
        continue;
      }
      if (c === '}') {
        this.i++;
        continue;
      }
      if (c === '~') {
        this.text(' ', style);
        this.i++;
        continue;
      }
      if (c === '&') {
        this.text('\t', style);
        this.i++;
        continue;
      }
      if (c === '-' && this.peek(1) === '-') {
        const em = this.peek(2) === '-';
        this.text(em ? '—' : '–', style);
        this.i += em ? 3 : 2;
        continue;
      }
      if (c === '`' && this.peek(1) === '`') {
        this.text('“', style);
        this.i += 2;
        continue;
      }
      if (c === "'" && this.peek(1) === "'") {
        this.text('”', style);
        this.i += 2;
        continue;
      }
      if (c === '<' && this.peek(1) === '<') {
        this.text('«', style);
        this.i += 2;
        continue;
      }
      if (c === '>' && this.peek(1) === '>') {
        this.text('»', style);
        this.i += 2;
        continue;
      }
      // Plain text up to the next special character.
      let j = this.i + 1;
      while (j < end && !/[\\\n${}~&`'<>-]/.test(this.s[j]!)) j++;
      this.text(this.s.slice(this.i, j).replace(/[ \t]+/g, ' '), style);
      this.i = j;
    }
  }

  private math(style: Style): void {
    const display = this.peek(1) === '$';
    const open = display ? '$$' : '$';
    const start = this.i + open.length;
    let j = start;
    while (j < this.s.length) {
      if (this.s[j] === '\\') {
        j += 2;
        continue;
      }
      if (this.s.startsWith(open, j)) break;
      j++;
    }
    this.formula(this.s.slice(start, j), display, style);
    this.i = Math.min(this.s.length, j + open.length);
  }

  private formula(src: string, display: boolean, style: Style): void {
    this.out.formulas++;
    const text = formulaText(src);
    if (!text) return;
    if (display) {
      this.endParagraph();
      this.stack.push({ kind: this.context()?.kind ?? 'body', style: this.context()?.style, align: 'center' });
      this.text(text, {}, { formula: true });
      this.endParagraph();
      this.stack.pop();
    } else this.text(text, style, { formula: true });
  }

  private command(style: Style): void {
    const m = /^\\([a-zA-Z@]+\*?|.)/.exec(this.s.slice(this.i, this.i + 40));
    if (!m) {
      this.i++;
      return;
    }
    const raw = m[1]!;
    this.i += m[0].length;
    const star = raw.endsWith('*') && raw.length > 1;
    const name = star ? raw.slice(0, -1) : raw;

    if (raw.length === 1 && !/[a-zA-Z@]/.test(raw)) {
      if (raw === '\\') {
        this.group('['); // \\[2mm]
        this.block().runs.push({ type: 'break' });
      } else if (raw === '[') this.displayUntil('\\]', style);
      else if (raw === '(') this.inlineUntil('\\)', style);
      else if (ESCAPED.has(raw)) this.text(ESCAPED_TEXT[raw] ?? raw, style);
      else if (raw === "'" || raw === '`' || raw === '"' || raw === '^' || raw === '~') this.group('{');
      return;
    }
    // Spaces after a command word are swallowed.
    if (/[a-zA-Z@]$/.test(raw)) this.skipSpaces();

    switch (name) {
      case 'begin':
        return this.environment(style);
      case 'end':
        this.group('{');
        return;
      case 'chapter':
      case 'part':
      case 'section':
      case 'subsection':
      case 'subsubsection':
      case 'paragraph': {
        this.group('[');
        const title = this.group('{') ?? '';
        const level = headingLevel(name, this.out.chapters);
        if (level === null) {
          this.inline(title, { ...style, bold: true });
          this.text(' ', style);
          return;
        }
        this.endParagraph();
        this.stack.push({ kind: 'heading' });
        if (level === 1 && this.out.chapters) this.pendingNewPage = true;
        this.block().level = level;
        this.inline(title, {});
        if (this.current) this.current.level = level;
        this.endParagraph();
        this.stack.pop();
        return;
      }
      case 'title':
      case 'author':
      case 'date': {
        // In the body these are rare; their text is kept as a title paragraph.
        const t = this.group('{');
        if (t !== null) {
          this.endParagraph();
          this.stack.push({ kind: 'title', align: 'center' });
          this.inline(t, {});
          this.endParagraph();
          this.stack.pop();
        }
        return;
      }
      case 'par':
        this.endParagraph();
        return;
      case 'centering':
      case 'raggedright':
      case 'raggedleft': {
        // Until the end of the environment (or group) it is in.
        const ctx = this.context();
        const align: BlockAlign = name === 'centering' ? 'center' : name === 'raggedright' ? 'left' : 'right';
        if (ctx) ctx.align = align;
        if (this.current && !this.current.runs.length) this.current.align = align;
        return;
      }
      case 'newpage':
      case 'clearpage':
      case 'cleardoublepage':
      case 'pagebreak':
      case 'bosbet':
        this.endParagraph();
        this.pendingNewPage = true;
        return;
      case 'item': {
        const label = this.group('[');
        this.endParagraph();
        const ctx = this.context();
        if (ctx && ctx.kind === 'list') {
          ctx.listCounter = (ctx.listCounter ?? 0) + 1;
          const mark = label !== null ? `${label.trim()} ` : ctx.listType === 'enumerate' ? `${ctx.listCounter}.\t` : '•\t';
          if (label !== null && ctx.listType === 'description') this.inline(label, { bold: true });
          else this.text(mark, {});
          if (label !== null && ctx.listType === 'description') this.text(' ', {});
        }
        return;
      }
      case 'textbf':
        return this.styled({ ...style, bold: true });
      case 'textit':
      case 'emph':
      case 'textsl':
        return this.styled({ ...style, italic: !style.italic || name !== 'emph' });
      case 'textsc':
        return this.styled({ ...style, smallCaps: true });
      case 'underline':
        return this.styled({ ...style, underline: true });
      case 'matnuslubi': {
        const id = (this.group('{') ?? '').trim();
        return this.styled({ ...style, ...(/^[a-z][a-z0-9]*$/.test(id) ? { charStyle: id } : {}) });
      }
      case 'textcolor':
        this.group('[');
        this.group('{');
        return this.styled(style);
      case 'text':
      case 'textrm':
      case 'textsf':
      case 'texttt':
      case 'textup':
      case 'textmd':
      case 'textnormal':
      case 'mbox':
      case 'hbox':
      case 'fbox':
      case 'colorbox':
      case 'uppercase':
      case 'MakeUppercase':
      case 'lowercase':
        if (name === 'colorbox') this.group('{');
        if (name === 'uppercase' || name === 'MakeUppercase') {
          const t = this.group('{') ?? '';
          this.inline(t.toUpperCase().replace(/\\([A-Z]+)/g, (x) => x.toLowerCase()), style);
          return;
        }
        return this.styled(style);
      case 'foreignlanguage':
        this.group('[');
        this.group('{');
        return this.styled(style);
      case 'url':
      case 'nolinkurl':
        this.text(this.group('{') ?? '', style);
        return;
      case 'href':
        this.group('{');
        return this.styled(style);
      case 'footnote': {
        this.group('[');
        const t = this.group('{');
        if (t !== null) this.block().runs.push(this.footnote(t));
        return;
      }
      case 'includegraphics':
      case 'rasmramka':
      case 'torrasm': {
        const opts = this.group('[') ?? '';
        const file = (this.group('{') ?? '').trim();
        const caption = name === 'includegraphics' ? null : this.group('{');
        if (/joy\s*=\s*(fon|yoyilma|tola)\b/.test(opts) && name === 'rasmramka') {
          // Full-page and background pictures belong to the page, not the text flow: listed only.
          if (file) this.out.pictures.push(file);
          return;
        }
        this.picture(file, opts, caption);
        return;
      }
      case 'caption': {
        this.group('[');
        const t = this.group('{');
        if (t !== null) {
          this.endParagraph();
          this.stack.push({ kind: 'caption', align: 'center' });
          this.inline(t, {});
          this.endParagraph();
          this.stack.pop();
        }
        return;
      }
      case 'ref':
      case 'pageref':
      case 'eqref':
      case 'cref':
      case 'Cref':
      case 'autoref':
        this.group('{');
        this.text('?', style);
        return;
      case 'cite':
      case 'citep':
      case 'citet':
        this.group('[');
        this.group('[');
        this.text(`[${(this.group('{') ?? '').trim()}]`, style);
        return;
      case 'verb': {
        const delim = this.s[this.i];
        if (!delim) return;
        const close = this.s.indexOf(delim, this.i + 1);
        const stop = close === -1 ? this.s.length : close;
        this.text(this.s.slice(this.i + 1, stop), style);
        this.i = stop + 1;
        return;
      }
    }
    if (name in SYMBOLS) {
      this.text(SYMBOLS[name]!, style);
      if (/[a-zA-Z]$/.test(name) && this.s[this.i] === '{' && this.s[this.i + 1] === '}') this.i += 2;
      return;
    }
    if (DROP.has(name)) {
      this.skipArgs(dropArity(name));
      return;
    }
    // Unknown commands: their arguments are text (\muhim{...}, own macros of a book).
    this.group('[');
    let any = false;
    for (let n = 0; n < 4; n++) {
      const save = this.i;
      const g = this.group('{');
      if (g === null) {
        this.i = save;
        break;
      }
      if (any) this.text(' ', style);
      this.inline(g, style);
      any = true;
    }
  }

  private styled(style: Style): void {
    const t = this.group('{');
    if (t !== null) this.inline(t, style);
  }

  private displayUntil(close: string, style: Style): void {
    const j = this.s.indexOf(close, this.i);
    const stop = j === -1 ? this.s.length : j;
    this.formula(this.s.slice(this.i, stop), true, style);
    this.i = stop + close.length;
  }
  private inlineUntil(close: string, style: Style): void {
    const j = this.s.indexOf(close, this.i);
    const stop = j === -1 ? this.s.length : j;
    this.formula(this.s.slice(this.i, stop), false, style);
    this.i = stop + close.length;
  }

  private picture(file: string, opts: string, caption: string | null): void {
    if (!file) return;
    this.out.pictures.push(file);
    const share = /width\s*=\s*([\d.]+)\s*\\(?:linewidth|textwidth|columnwidth)/.exec(opts);
    const en = /(?:^|,)\s*(?:en|width)\s*=\s*([\d.]+)\s*(mm|cm|pt|in)\b/.exec(opts);
    const pic: PictureRun = { type: 'picture', file };
    if (share) pic.widthShare = Math.min(1, Number(share[1]));
    else if (/width\s*=\s*\\(?:linewidth|textwidth|columnwidth)/.test(opts)) pic.widthShare = 1;
    else if (en) pic.widthMm = toMm(Number(en[1]), en[2]!);
    this.endParagraph();
    this.stack.push({ kind: this.context()?.kind ?? 'body', style: this.context()?.style, align: 'center' });
    this.block().runs.push(pic);
    this.endParagraph();
    this.stack.pop();
    if (caption && caption.trim()) {
      this.stack.push({ kind: 'caption', align: 'center' });
      this.inline(caption, {});
      this.endParagraph();
      this.stack.pop();
    }
  }

  /** The text between this.i and the matching \end{name} (nesting counted); moves past it. */
  private environmentBody(name: string): string {
    const open = `\\begin{${name}}`;
    const close = `\\end{${name}}`;
    let depth = 1;
    let j = this.i;
    while (j < this.s.length) {
      const o = this.s.indexOf(open, j);
      const c = this.s.indexOf(close, j);
      if (c === -1) {
        j = this.s.length;
        break;
      }
      if (o !== -1 && o < c) {
        depth++;
        j = o + open.length;
        continue;
      }
      depth--;
      if (depth === 0) {
        const inner = this.s.slice(this.i, c);
        this.i = c + close.length;
        return inner;
      }
      j = c + close.length;
    }
    const inner = this.s.slice(this.i);
    this.i = this.s.length;
    return inner;
  }

  private environment(style: Style): void {
    const name = (this.group('{') ?? '').trim();
    if (!name) return;
    if (VERBATIM_ENVS.has(name)) {
      const body = this.environmentBody(name);
      this.endParagraph();
      for (const line of body.replace(/^\n/, '').replace(/\n$/, '').split('\n')) {
        this.text(line, {});
        this.endParagraph();
      }
      return;
    }
    if (SKIP_ENVS.has(name)) {
      this.environmentBody(name);
      return;
    }
    if (MATH_ENVS.has(name)) {
      this.formula(this.environmentBody(name), true, style);
      return;
    }
    if (DRAWING_ENVS.has(name)) {
      this.environmentBody(name);
      this.out.drawings++;
      this.endParagraph();
      this.stack.push({ kind: 'body', align: 'center' });
      this.text('[Chizma]', {});
      this.endParagraph();
      this.stack.pop();
      return;
    }
    if (TABLE_ENVS.has(name)) {
      if (name === 'tabular*' || name === 'tabularx') this.group('{');
      this.group('[');
      this.group('{'); // column spec
      const body = this.environmentBody(name);
      this.out.tables++;
      this.endParagraph();
      for (const row of body.split(/\\\\(?:\[[^\]]*\])?/)) {
        const clean = row.replace(/\\(hline|toprule|midrule|bottomrule|cline\{[^}]*\}|cmidrule(\([^)]*\))?\{[^}]*\})/g, '').trim();
        if (!clean) continue;
        this.inline(clean, style);
        this.endParagraph();
      }
      return;
    }
    if (name === 'uslub') {
      const id = (this.group('{') ?? '').trim();
      const body = this.environmentBody(name);
      this.endParagraph();
      this.stack.push({ kind: 'style', style: /^[a-z][a-z0-9]*$/.test(id) ? id : undefined });
      this.inline(body, {});
      this.endParagraph();
      this.stack.pop();
      return;
    }
    if (name === 'matnquti' || name === 'figure' || name === 'figure*' || name === 'table' || name === 'wrapfigure' || name === 'rasmtori' || name === 'ustunlar' || name === 'minipage' || name === 'multicols') {
      // Floats, boxes and column blocks keep their content in the flow.
      if (name === 'wrapfigure') {
        this.group('[');
        this.group('{');
        this.group('[');
        this.group('{');
      } else if (name === 'minipage') {
        this.group('[');
        this.group('{');
      } else if (name === 'ustunlar' || name === 'multicols' || name === 'rasmtori') {
        this.group('[');
        this.group('{');
      } else this.group('[');
      const body = this.environmentBody(name);
      this.endParagraph();
      this.inline(body, style);
      this.endParagraph();
      return;
    }
    if (name === 'titlepage') {
      const body = this.environmentBody(name);
      this.endParagraph();
      this.stack.push({ kind: 'title', align: 'center' });
      this.inline(body, {});
      this.endParagraph();
      this.stack.pop();
      this.pendingNewPage = true;
      return;
    }
    const kind: BlockKind | null = LIST_ENVS.has(name) ? 'list' : QUOTE_ENVS.has(name) ? 'quote' : null;
    const align = ALIGN_ENVS[name];
    // Arguments that are names (a language, box options), not text.
    if (ENV_NAME_ARGS[name]) for (let n = 0; n < ENV_NAME_ARGS[name]!; n++) this.group('{');
    // The optional argument of a theorem-like environment is its title: kept in bold.
    const title = kind || align ? null : this.group('[');
    const body = this.environmentBody(name);
    this.endParagraph();
    const ctx = this.context();
    this.stack.push({
      kind: kind ?? ctx?.kind ?? 'body',
      style: kind ? undefined : ctx?.style,
      align: align ?? (kind ? undefined : ctx?.align),
      ...(kind === 'list' ? { listType: name, listCounter: 0 } : {}),
    });
    if (name === 'enumerate' || name === 'itemize') this.group('[');
    if (title && title.trim() && !/=/.test(title)) {
      this.inline(title, { bold: true });
      this.text('. ', {});
    }
    this.inline(body, kind === 'list' || kind === 'quote' ? {} : style);
    this.endParagraph();
    this.stack.pop();
  }
}

function sameStyle(a: TextRun, b: TextRun): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.smallCaps === b.smallCaps && a.underline === b.underline && a.charStyle === b.charStyle && a.formula === b.formula;
}

function headingLevel(cmd: string, chapters: boolean): 1 | 2 | 3 | null {
  const order = chapters ? ['chapter', 'section', 'subsection'] : ['section', 'subsection', 'subsubsection'];
  if (cmd === 'part') return 1;
  const i = order.indexOf(cmd);
  return i === -1 ? null : ((i + 1) as 1 | 2 | 3);
}

/** How many mandatory arguments a dropped command takes. */
function dropArity(name: string): number {
  if (['newcommand', 'renewcommand', 'providecommand'].includes(name)) return 2;
  if (['newenvironment', 'renewenvironment'].includes(name)) return 3;
  if (['setlength', 'addtolength', 'setcounter', 'addtocounter', 'markboth', 'colorbox'].includes(name)) return 2;
  if (name === 'addcontentsline') return 3;
  if (['def', 'let', 'par', 'noindent', 'indent', 'centering', 'raggedright', 'raggedleft', 'smallskip', 'medskip', 'bigskip', 'vfill', 'hfill', 'maketitle', 'tableofcontents', 'listoffigures', 'listoftables', 'frontmatter', 'mainmatter', 'backmatter', 'appendix', 'protect', 'phantomsection', 'normalfont', 'normalsize', 'small', 'footnotesize', 'scriptsize', 'tiny', 'large', 'Large', 'LARGE', 'huge', 'Huge', 'bfseries', 'itshape', 'mdseries', 'upshape', 'rmfamily', 'sffamily', 'ttfamily', 'scshape', 'nobreak', 'null', 'allowbreak', 'bobbezagi', 'printbibliography'].includes(name)) return 0;
  return 1;
}

function toMm(v: number, unit: string): number {
  return unit === 'cm' ? v * 10 : unit === 'in' ? v * 25.4 : unit === 'pt' ? (v * 25.4) / 72.27 : v;
}

/** Signs a formula's LaTeX names, for reading it as text (the rest stays LaTeX). */
const MATH_SIGNS: Record<string, string> = {
  pm: '±', mp: '∓', cdot: '·', times: '×', div: '÷', neq: '≠', ne: '≠', leq: '≤', le: '≤', geq: '≥', ge: '≥',
  approx: '≈', equiv: '≡', sim: '∼', infty: '∞', int: '∫', iint: '∬', oint: '∮', sum: '∑', prod: '∏', partial: '∂',
  nabla: '∇', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅',
  forall: '∀', exists: '∃', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftrightarrow: '⇔', iff: '⇔',
  implies: '⇒', angle: '∠', perp: '⊥', parallel: '∥', circ: '∘', degree: '°', ldots: '…', cdots: '⋯', dots: '…',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ',
  psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω',
  quad: ' ', qquad: '  ', ',': ' ', ';': ' ', ':': ' ', '!': '', '{': '{', '}': '}', '|': '‖',
  sin: 'sin', cos: 'cos', tan: 'tan', tg: 'tg', ctg: 'ctg', cot: 'cot', log: 'log', ln: 'ln', lg: 'lg', lim: 'lim',
  max: 'max', min: 'min', exp: 'exp', arcsin: 'arcsin', arccos: 'arccos', arctg: 'arctg', operatorname: '',
};
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', n: 'ⁿ', i: 'ⁱ', '(': '⁽', ')': '⁾', '=': '⁼' };
const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '(': '₍', ')': '₎', '=': '₌' };

/**
 * A formula as readable text: \label and spacing commands dropped, \frac{a}{b} as a/b,
 * \sqrt{x} as √x, short powers and indices as ², ₁, signs and Greek letters as characters.
 * Whatever has no plain form keeps its LaTeX.
 */
export function formulaText(src: string): string {
  let t = src
    .replace(/\\(label|tag|nonumber|notag)\b\s*(\{[^}]*\})?/g, '')
    .replace(/\\(left|right)\s*\./g, '')
    .replace(/\\(displaystyle|textstyle|limits|nolimits|left|right|big|Big|bigg|Bigg)(?![a-zA-Z])\s*/g, '')
    .replace(/\\(mathrm|mathbf|mathit|text|textrm|operatorname|mathbb|mathcal)\s*\{([^{}]*)\}/g, '$2')
    .replace(/&|\\\\/g, ' ')
    .replace(/\s+/g, ' ');
  t = t.replace(/\\([a-zA-Z]+|[,;:!{}|])/g, (m, name: string) => (name in MATH_SIGNS ? MATH_SIGNS[name]! + (/[a-z]$/i.test(MATH_SIGNS[name]!) ? ' ' : '') : m));
  const script = (map: Record<string, string>) => (_m: string, a: string | undefined, b: string | undefined) => {
    const s = a ?? b ?? '';
    return [...s].every((c) => map[c]) ? [...s].map((c) => map[c]).join('') : null;
  };
  t = t.replace(/\^(?:\{([^{}]*)\}|([0-9a-z+\-]))/g, (m, a, b) => script(SUP)(m, a, b) ?? m);
  t = t.replace(/_(?:\{([^{}]*)\}|([0-9+\-]))/g, (m, a, b) => script(SUB)(m, a, b) ?? m);
  for (let n = 0; n < 4; n++) {
    t = t
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_m, a: string, b: string) => `${group(a)}/${group(b)}`)
      .replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, (_m, k: string, a: string) => `${k === '3' ? '∛' : k === '4' ? '∜' : `${k}√`}${group(a)}`)
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, (_m, a: string) => `√${group(a)}`);
  }
  return t.replace(/\s+/g, ' ').replace(/ ([⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ])/g, '$1').replace(/\s+([,.;)])/g, '$1').trim();
}

/** A fraction part: in brackets when it is more than one term. */
function group(s: string): string {
  const t = s.trim();
  return /^[\w.√²³α-ωΑ-Ω]+$/u.test(t) ? t : `(${t})`;
}
