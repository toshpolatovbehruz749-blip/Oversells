/**
 * "Faqat shu bob": a document with only the chapter around the cursor, so a
 * 800-page book shows one chapter in seconds.
 *
 * Chapters start with \part, \chapter, \addchap or a command of the document
 * that opens a chapter (its definition clears to a new page and adds a
 * chapter to the contents, or calls \chapter: \bob in mathpro.sty). If the
 * document has none, \section is used. Body lines outside the chapter become
 * empty lines, so line numbers (SyncTeX, errors) stay those of the real
 * file; the counter of each chapter command is set so that the chapter keeps
 * its number.
 */

export interface ChapterCommand {
  name: string;
  /** The counter it steps (chapter, part or the one its definition steps). */
  counter: string | null;
  /** Starred forms (\chapter*) do not step the counter. */
  starredSkips: boolean;
}

export interface ChapterPreview {
  text: string;
  /** The chapter's title (first argument of its command), for the banner. */
  label: string;
  /** 1-based lines of the chapter in the file. */
  from: number;
  to: number;
}

const BUILTIN: ChapterCommand[] = [
  { name: 'part', counter: 'part', starredSkips: true },
  { name: 'chapter', counter: 'chapter', starredSkips: true },
  { name: 'addchap', counter: null, starredSkips: false },
];
const SECTION: ChapterCommand = { name: 'section', counter: 'section', starredSkips: true };

/** Body lines kept outside the chapter: matter switches and one-line settings. */
const KEEP = /^\s*\\(frontmatter|mainmatter|backmatter|appendix|makeatletter|makeatother|(re)?newcommand|providecommand|def|gdef|let|setcounter|setlength|graphicspath|definecolor|colorlet|pagestyle|usetikzlibrary|tikzset|pgfplotsset|hypersetup)\b/;

function balanced(line: string): boolean {
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') i++;
    else if (c === '%') break;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
  }
  return depth === 0;
}

/** Commands of the preamble that open a chapter, with their counters. */
export function chapterCommands(preamble: string): ChapterCommand[] {
  const out = [...BUILTIN];
  const def = /\\(?:newcommand|renewcommand|providecommand|NewDocumentCommand|RenewDocumentCommand|DeclareDocumentCommand|def)\s*\{?\\([A-Za-z@]+)\}?/g;
  const starts = [...preamble.matchAll(def)];
  starts.forEach((m, k) => {
    const name = m[1]!;
    if (name.includes('@') || out.some((c) => c.name === name)) return;
    const body = preamble.slice(m.index! + m[0].length, starts[k + 1]?.index ?? preamble.length);
    const opens =
      /\\chapter\b/.test(body) || /\{toc\}\s*\{chapter\}/.test(body) || (/\\cleardoublepage\b/.test(body) && /\\(ref)?stepcounter\b/.test(body));
    if (!opens) return;
    const counter = /\\(?:ref)?stepcounter\s*\{([A-Za-z@]+)\}/.exec(body)?.[1] ?? (/\\chapter\b/.test(body) ? 'chapter' : null);
    out.push({ name, counter, starredSkips: false });
  });
  return out;
}

/** The first {...} argument of a chapter line (after [..] options), as plain text for a label. */
function firstArgument(line: string): string {
  const m = /^\s*\\[A-Za-z]+\*?\s*(?:\[[^\]]*\]\s*)*\{/.exec(line);
  if (!m) return '';
  let depth = 1;
  let i = m[0].length;
  for (; i < line.length && depth > 0; i++) {
    if (line[i] === '\\') i++;
    else if (line[i] === '{') depth++;
    else if (line[i] === '}') depth--;
  }
  return line
    .slice(m[0].length, i - 1)
    .replace(/\\[A-Za-z]+\*?/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[{}$~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The document reduced to the chapter that contains `line` (1-based), or
 * null when the line is outside the body or the document has no chapters.
 */
export function chapterPreview(text: string, line: number): ChapterPreview | null {
  const lines = text.split('\n');
  const isCode = (l: string) => l.replace(/(^|[^\\])%.*$/, '$1');
  const begin = lines.findIndex((l) => /\\begin\s*\{document\}/.test(isCode(l)));
  const end = lines.findIndex((l, i) => i > begin && /\\end\s*\{document\}/.test(isCode(l)));
  if (begin === -1 || end === -1) return null;
  const preamble = lines.slice(0, begin).join('\n');

  const find = (cmds: ChapterCommand[]) => {
    const re = new RegExp(`^\\s*\\\\(${cmds.map((c) => c.name).join('|')})(\\*?)(?![A-Za-z@])`);
    const starts: Array<{ at: number; cmd: ChapterCommand; starred: boolean }> = [];
    for (let i = begin + 1; i < end; i++) {
      const m = re.exec(lines[i]!);
      if (m) starts.push({ at: i, cmd: cmds.find((c) => c.name === m[1])!, starred: m[2] === '*' });
    }
    return starts;
  };
  let starts = find(chapterCommands(preamble));
  if (starts.length === 0) starts = find([SECTION]);
  if (starts.length === 0) return null;

  const at = line - 1;
  if (at <= begin || at >= end) return null;
  // Before the first chapter: the front matter is the "chapter".
  const k = starts.filter((s) => s.at <= at).length - 1;
  const from = k === -1 ? begin + 1 : starts[k]!.at;
  const to = (k + 1 < starts.length ? starts[k + 1]!.at : end) - 1;

  // Counters of the chapters before this one.
  const counts = new Map<string, number>();
  for (const s of starts) {
    if (s.at >= from) break;
    if (!s.cmd.counter || (s.starred && s.cmd.starredSkips)) continue;
    counts.set(s.cmd.counter, (counts.get(s.cmd.counter) ?? 0) + 1);
  }
  // \part resets nothing we track; \chapter inside a part keeps counting (book class).
  const setCounters = [...counts].map(([c, n]) => `\\setcounter{${c}}{${n}}`).join('');

  const out = lines.map((l, i) => {
    if (i <= begin || i >= end || (i >= from && i <= to)) return l;
    return KEEP.test(l) && balanced(l) ? l : '';
  });
  out[begin] = `${out[begin]}${setCounters}`;
  const label = k === -1 ? '' : firstArgument(lines[from]!);
  return { text: out.join('\n'), label, from: from + 1, to: to + 1 };
}

/** The file a chapter preview of `mainFile` is compiled as (next to it, so relative paths work). */
export function previewPath(mainFile: string): string {
  return mainFile.replace(/(\.tex)?$/, '-bob.tex');
}
