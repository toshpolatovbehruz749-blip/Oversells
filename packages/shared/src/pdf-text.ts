import { escapeLatex } from './page-design.js';

/**
 * «Sahifa dizayni»: a PDF imported as text. pdftotext runs in the compile
 * sandbox (the script travels with the job); this module turns its output into
 * LaTeX paragraphs. Pictures, fonts and the layout are not taken over.
 */

/** Shell script for the sandbox: input.pdf in, a tar of out/ (text.txt, info.txt) on stdout. */
export const PDF_TEXT_SCRIPT = [
  'set -u',
  'cd /work || exit 2',
  'tar -x -f - --no-same-owner --no-same-permissions >&2 || exit 3',
  '[ -f input.pdf ] || { echo "import: input.pdf missing" >&2; exit 4; }',
  'mkdir -p out',
  'pdfinfo input.pdf > out/info.txt 2>&2 || exit 5',
  'pdftotext -q -layout -enc UTF-8 input.pdf out/text.txt || exit 6',
  'cd out && tar -c -f - text.txt info.txt',
].join('\n');

const letter = /\p{L}/u;
const lowerStart = /^[\p{Ll}]/u;

/** Lines that repeat at the top or bottom of many pages (running heads, page numbers). */
function repeatedEdges(pages: string[][]): Set<string> {
  const count = new Map<string, number>();
  for (const lines of pages) {
    const text = lines.filter((l) => l.trim());
    const edges = new Set([...text.slice(0, 2), ...text.slice(-2)].map((l) => l.trim().replace(/\d+/g, '#')));
    for (const e of edges) if (e) count.set(e, (count.get(e) ?? 0) + 1);
  }
  const min = Math.max(2, Math.ceil(pages.length / 3));
  return new Set([...count].filter(([, n]) => n >= min).map(([e]) => e));
}

/** A short line on its own that looks like a heading: all capitals, or "3-bob", "II BOʻLIM", "Chapter 4". */
function isHeading(line: string): boolean {
  const s = line.trim();
  if (s.length < 2 || s.length > 70 || /[,;:]$/.test(s) || !letter.test(s)) return false;
  const letters = s.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase() && !/[.]$/.test(s)) return true;
  return (
    /^(\d+|[IVXLC]+)[-.\s]*(bob|boʻlim|bo'lim|qism|mavzu|глава|раздел|chapter|part)\b/iu.test(s) || /^(bob|глава|chapter)\s+\d+/iu.test(s)
  );
}

const indentOf = (line: string) => line.length - line.trimStart().length;

/** Joins the lines of a paragraph, mending words broken at the line end. */
function joinLines(lines: string[]): string {
  let para = '';
  for (const line of lines) {
    if (!para) {
      para = line;
      continue;
    }
    const broken = /(\p{L}+)-$/u.exec(para);
    if (broken && lowerStart.test(line)) {
      // "kun-" + "lar" → "kunlar"; "bir-" + "biriga" (a doubled word) keeps its hyphen.
      const doubled = line.toLowerCase().startsWith(broken[1]!.toLowerCase());
      para = doubled ? para + line : para.slice(0, -1) + line;
    } else para += ` ${line}`;
  }
  return para;
}

export interface PdfTextResult {
  mainTex: string;
  /** Paragraphs and headings found. */
  paragraphs: number;
  headings: number;
}

/** pdftotext -layout output (pages split by form feeds) as main.tex. */
export function pdfTextToLatex(text: string, title: string, pageSize?: { w: number; h: number }): PdfTextResult {
  const pages = text
    .replace(/\r/g, '')
    .split('\f')
    .map((p) => p.split('\n').map((l) => l.replace(/\s+$/, '')));
  const repeated = repeatedEdges(pages.filter((p) => p.some((l) => l.trim())));
  type Block = { heading: boolean; lines: string[] };
  const blocks: Block[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) blocks.push({ heading: false, lines: current });
    current = [];
  };
  for (const page of pages) {
    const textLines = page.filter((l) => l.trim());
    if (!textLines.length) continue;
    const margin = Math.min(...textLines.map(indentOf));
    const edges = new Set([...textLines.slice(0, 2), ...textLines.slice(-2)]);
    // Without the running heads and page numbers, and without the blank lines at the page's ends.
    const lines = page.filter((l) => {
      const s = l.trim();
      return !(s && edges.has(l) && (repeated.has(s.replace(/\d+/g, '#')) || /^[-–—]?\s*\d{1,4}\s*[-–—]?$/.test(s)));
    });
    while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
    while (lines.length && !lines[0]!.trim()) lines.shift();
    for (const line of lines) {
      if (!line.trim()) {
        flush();
        continue;
      }
      const s = line.trim();
      const indent = indentOf(line) - margin;
      if (isHeading(s) && (current.length === 0 || indent > 6)) {
        flush();
        blocks.push({ heading: true, lines: [s] });
        continue;
      }
      // A first-line indent starts a new paragraph.
      if (indent >= 2 && current.length) flush();
      current.push(s);
    }
    // A paragraph may go on over the page break: keep it open unless it ended a sentence.
    const last = current[current.length - 1];
    if (last && /[.!?:»"”)]$/.test(last)) flush();
  }
  flush();

  const out = blocks.map((b) => (b.heading ? `\\section*{${escapeLatex(b.lines[0]!)}}` : escapeLatex(joinLines(b.lines))));
  const headings = blocks.filter((b) => b.heading).length;
  const geometry = pageSize
    ? `\\usepackage[paperwidth=${Math.round((pageSize.w * 25.4) / 72)}mm,paperheight=${Math.round((pageSize.h * 25.4) / 72)}mm]{geometry}`
    : '\\usepackage[a4paper]{geometry}';
  const mainTex = [
    `% Imported from PDF (text only): ${escapeLatex(title)}`,
    '% Pictures, tables and fonts of the PDF are not taken over; headings are guessed (\\section*).',
    '\\documentclass[11pt]{article}',
    geometry,
    '\\usepackage{fontspec}',
    '\\setmainfont{Noto Serif}',
    '\\usepackage{babel}',
    '\\babelprovide[import=uz-Latn, main]{uzbek}',
    '\\def\\uzbekhyphenmins{22}',
    '',
    '\\begin{document}',
    '',
    out.join('\n\n') || '% The PDF has no text layer (a scan?): nothing was found.',
    '',
    '\\end{document}',
    '',
  ].join('\n');
  return { mainTex, paragraphs: out.length - headings, headings };
}

/** The page size from pdfinfo ("Page size: 419.528 x 595.276 pts"), PDF points. */
export function pdfPageSize(info: string): { w: number; h: number } | undefined {
  const m = /^Page size:\s+([\d.]+) x ([\d.]+) pts/m.exec(info);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : undefined;
}
