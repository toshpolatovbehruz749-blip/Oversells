import type { LogEntry } from '@oversells/shared';

/**
 * Extracts errors and warnings from a LaTeX log produced with
 * `-file-line-error` and `max_print_line=10000` (no 79-column wrapping).
 *
 * Recognised forms:
 *   ./chapters/ch1.tex:12: Undefined control sequence.     (file:line: error)
 *   ! LaTeX Error: ...            + "l.12 ..."               (classic error)
 *   LaTeX Warning: ... on input line 12.
 *   Package foo Warning: ... on input line 12.              (multi-line, "(foo)" continuation)
 *   Overfull \hbox (1.2pt too wide) in paragraph at lines 10--12
 *
 * Warnings carry the file from a simple "(./file.tex ... )" stack.
 */

const FILE_LINE_ERROR = /^(\.?\/?[^:\s][^:]*?\.[A-Za-z0-9]+):(\d+): (.*)$/;
const LINE_REF = /^l\.(\d+)(?:\s(.*))?$/;
const INPUT_LINE = /on input line (\d+)\.?/;
const BOX = /^(Overfull|Underfull) \\[hv]box .*?(?:at lines? (\d+)(?:--\d+)?)?$/;
const LATEX_WARNING = /^(LaTeX|Package [\w@.-]+|Class [\w@.-]+|LaTeX Font|pdfTeX|Font) Warning: (.*)$/;
const MAX_ENTRIES = 200;

/** Turns a path from the log into a project-relative path, or null for system files. */
export function projectRelative(path: string): string | null {
  if (path.startsWith('./')) return path.slice(2);
  if (path.startsWith('/')) return path.startsWith('/work/') ? path.slice('/work/'.length) : null;
  return path;
}

/**
 * Updates the file stack with the "(file" / ")" tokens of one log line.
 * Heuristic, like every LaTeX log parser: only tokens that look like paths
 * are pushed; parentheses in ordinary text are ignored when unbalanced.
 */
function trackFiles(line: string, stack: string[]): void {
  const re = /\((\.{0,2}\/[^\s()]*|[\w-]+\.(?:tex|sty|cls|aux|bbl|toc|out|def|cfg|fd|clo|ldf))|\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m[0] === ')') {
      if (stack.length > 0) stack.pop();
    } else {
      stack.push(m[1]!);
    }
  }
}

function currentProjectFile(stack: string[]): string | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const rel = projectRelative(stack[i]!);
    if (rel !== null && /\.(tex|ltx|bib|sty|cls|tikz)$/.test(rel)) return rel;
  }
  return null;
}

export function parseLatexLog(log: string): LogEntry[] {
  const lines = log.replace(/\r\n?/g, '\n').split('\n');
  const entries: LogEntry[] = [];
  const stack: string[] = [];
  const seen = new Set<string>();

  const push = (e: LogEntry) => {
    const key = `${e.level}|${e.file}|${e.line}|${e.message}`;
    if (seen.has(key) || entries.length >= MAX_ENTRIES) return;
    seen.add(key);
    entries.push(e);
  };

  /** Collects context lines after an error until "l.<n>" or a blank line. */
  const errorContext = (start: number): { line: number | null; context: string[]; end: number } => {
    const context: string[] = [];
    let lineNo: number | null = null;
    let i = start;
    for (; i < lines.length && i < start + 12; i++) {
      const l = lines[i]!;
      const ref = LINE_REF.exec(l);
      if (ref) {
        lineNo = Number(ref[1]);
        context.push(l);
        // The line after "l.N ..." shows the rest of the source line.
        if (lines[i + 1]?.trim()) context.push(lines[i + 1]!);
        break;
      }
      if (l.trim() === '' && context.length > 0) break;
      if (FILE_LINE_ERROR.test(l) || l.startsWith('! ')) break;
      context.push(l);
    }
    return { line: lineNo, context, end: i };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const fle = FILE_LINE_ERROR.exec(line);
    if (fle && !/^\(/.test(line)) {
      const { context } = errorContext(i + 1);
      push({
        level: 'error',
        message: fle[3]!.trim(),
        file: projectRelative(fle[1]!),
        line: Number(fle[2]),
        context: context.join('\n'),
      });
      continue;
    }

    if (line.startsWith('! ')) {
      const { line: lineNo, context } = errorContext(i + 1);
      push({
        level: 'error',
        message: line.slice(2).trim(),
        file: currentProjectFile(stack),
        line: lineNo,
        context: context.join('\n'),
      });
      continue;
    }

    const warn = LATEX_WARNING.exec(line);
    if (warn) {
      // Package warnings continue on lines starting with "(pkg)".
      let message = warn[2]!;
      let j = i + 1;
      while (j < lines.length && /^\([\w@.-]+\)\s/.test(lines[j]!)) {
        message += ` ${lines[j]!.replace(/^\([\w@.-]+\)\s+/, '')}`;
        j++;
      }
      // Classic warnings may still wrap onto the next line when very long.
      if (!INPUT_LINE.test(message) && j < lines.length && INPUT_LINE.test(lines[j]!) && lines[j]!.trim() !== '') {
        message += ` ${lines[j]!.trim()}`;
        j++;
      }
      const lineMatch = INPUT_LINE.exec(message);
      push({
        level: 'warning',
        message: `${warn[1]} Warning: ${message.replace(/\s+/g, ' ').trim()}`,
        file: currentProjectFile(stack),
        line: lineMatch ? Number(lineMatch[1]) : null,
        context: '',
      });
      i = j - 1;
      continue;
    }

    const box = BOX.exec(line);
    if (box) {
      push({
        level: 'typesetting',
        message: line.trim(),
        file: currentProjectFile(stack),
        line: box[2] ? Number(box[2]) : null,
        context: '',
      });
      continue;
    }

    trackFiles(line, stack);
  }

  // Errors first, then warnings, then typesetting notes; stable within a level.
  const rank = { error: 0, warning: 1, typesetting: 2 } as const;
  return entries
    .map((e, idx) => ({ e, idx }))
    .sort((a, b) => rank[a.e.level] - rank[b.e.level] || a.idx - b.idx)
    .map(({ e }) => e);
}
