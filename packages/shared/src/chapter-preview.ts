/**
 * "Faqat shu bob": a document with only the chapter around the cursor, so a
 * 800-page book shows one chapter in seconds.
 *
 * Chapters start with \part, \chapter, \addchap or a command of the document
 * that opens a chapter (its definition clears to a new page and adds a
 * chapter to the contents, or calls \chapter: \bob in mathpro.sty; or, in
 * an article, starts a new page with a section: \mavzu in workbooks). If the
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

/** The change of brace depth over a line (comments and \{ \} skipped). */
function braceDelta(line: string): number {
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') i++;
    else if (c === '%') break;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
  }
  return depth;
}

/** Environments a line opens minus those it closes (a kept setting must not open a tabular). */
function envDelta(line: string): number {
  const code = line.replace(/(^|[^\\])%.*$/, '$1');
  return (code.match(/\\begin\s*\{/g)?.length ?? 0) - (code.match(/\\end\s*\{/g)?.length ?? 0);
}

/** The longest definition kept from outside the chapter, in lines. */
const MAX_DEFINITION = 300;

/**
 * Commands of the preamble that open a chapter, with their counters; with
 * `topics`, those that open a topic on a new page instead (a new page and a
 * section in the contents: \mavzu of a workbook), used when there are no chapters.
 */
export function chapterCommands(preamble: string, topics = false): ChapterCommand[] {
  const out = topics ? [] : [...BUILTIN];
  const def = /\\(?:newcommand|renewcommand|providecommand|NewDocumentCommand|RenewDocumentCommand|DeclareDocumentCommand|def)\s*\{?\\([A-Za-z@]+)\}?/g;
  const starts = [...preamble.matchAll(def)];
  starts.forEach((m, k) => {
    const name = m[1]!;
    if (name.includes('@') || out.some((c) => c.name === name)) return;
    const body = preamble.slice(m.index! + m[0].length, starts[k + 1]?.index ?? preamble.length);
    const chapter =
      /\\chapter\b/.test(body) || /\{toc\}\s*\{chapter\}/.test(body) || (/\\cleardoublepage\b/.test(body) && /\\(ref)?stepcounter\b/.test(body));
    const topic = !chapter && /\\(clearpage|cleardoublepage|newpage)\b/.test(body) && (/\{toc\}\s*\{section\}/.test(body) || /\\section\b/.test(body));
    if (topics ? !topic : !chapter) return;
    const counter =
      /\\(?:ref)?stepcounter\s*\{([A-Za-z@]+)\}/.exec(body)?.[1] ?? (/\\chapter\b/.test(body) ? 'chapter' : /\\section\b/.test(body) ? 'section' : null);
    out.push({ name, counter, starredSkips: false });
  });
  return out;
}

function group(line: string, open: number): { text: string; end: number } {
  let depth = 1;
  let i = open + 1;
  for (; i < line.length && depth > 0; i++) {
    if (line[i] === '\\') i++;
    else if (line[i] === '{') depth++;
    else if (line[i] === '}') depth--;
  }
  return { text: line.slice(open + 1, i - 1), end: i };
}

const plain = (s: string) =>
  s
    .replace(/\\[A-Za-z]+\*?/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[{}$~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The first {...} argument of a chapter line (after [..] options), as plain text for a label; "2. Qoʻshish" for \mavzu{2}{Qoʻshish}. */
function firstArgument(line: string): string {
  const m = /^\s*\\[A-Za-z]+\*?\s*(?:\[[^\]]*\]\s*)*\{/.exec(line);
  if (!m) return '';
  const first = group(line, m[0].length - 1);
  const label = plain(first.text);
  const next = /^\s*\{/.exec(line.slice(first.end));
  if (/^\d+$/.test(label) && next) {
    const second = plain(group(line, first.end + next[0].length - 1).text);
    if (second) return `${label}. ${second}`;
  }
  return label;
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
  if (starts.length === 0) {
    const topics = chapterCommands(preamble, true);
    if (topics.length > 0) starts = find(topics);
  }
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

  // Outside the chapter only settings and definitions stay; a definition over
  // several lines (\newcommand\SonJuft[3]{... in the body) stays whole.
  const out = lines.map((l, i) => (i <= begin || i >= end || (i >= from && i <= to) ? l : ''));
  // Only top-level lines: a \colorlet inside a tikzpicture is part of the picture.
  const topLevel: boolean[] = [];
  for (let i = begin + 1, envs = 0, braces = 0; i < end; i++) {
    topLevel[i] = envs <= 0 && braces <= 0;
    envs += envDelta(lines[i]!);
    braces += braceDelta(lines[i]!);
  }
  for (let i = begin + 1; i < end; i++) {
    if (i >= from && i <= to) continue;
    if (!topLevel[i] || !KEEP.test(lines[i]!)) continue;
    let depth = 0;
    let envs = 0;
    let j = i;
    for (; j < end && j - i < MAX_DEFINITION && !(j >= from && j <= to); j++) {
      depth += braceDelta(lines[j]!);
      envs += envDelta(lines[j]!);
      if (depth <= 0) break;
    }
    if (depth !== 0 || envs !== 0 || j >= end || (j >= from && j <= to)) continue;
    for (let k = i; k <= j; k++) out[k] = lines[k]!;
    i = j;
  }
  out[begin] = `${out[begin]}${setCounters}`;
  const label = k === -1 ? '' : firstArgument(lines[from]!);
  return { text: out.join('\n'), label, from: from + 1, to: to + 1 };
}

/** The file a chapter preview of `mainFile` is compiled as (next to it, so relative paths work). */
export function previewPath(mainFile: string): string {
  return mainFile.replace(/(\.tex)?$/, '-bob.tex');
}
