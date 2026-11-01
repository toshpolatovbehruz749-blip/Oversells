/**
 * Preflight: checks of a compiled PDF before it goes to the printing house.
 * The facts come from poppler (pdfinfo, pdffonts, pdfimages -list, pdftotext)
 * run in the compile sandbox, and from the LaTeX log; this module only reads
 * their text output.
 */

export type PreflightCheckId = 'fonts' | 'image-dpi' | 'image-color' | 'page-count' | 'overfull' | 'empty-pages';
export type PreflightStatus = 'ok' | 'warning' | 'error';

export interface PreflightItem {
  page?: number;
  file?: string;
  line?: number;
  /** What was found: a font name, "picture 2, 96 dpi", the overfull amount... */
  text: string;
}

export interface PreflightCheck {
  id: PreflightCheckId;
  status: PreflightStatus;
  items: PreflightItem[];
  /** A fix Oversells can make. */
  fix?: { kind: 'blankPages'; count: number };
}

export interface PreflightReport {
  pages: number;
  checks: PreflightCheck[];
}

export interface PreflightInput {
  /** pdfinfo output. */
  info: string;
  /** pdffonts output. */
  fonts: string;
  /** pdfimages -list output. */
  images: string;
  /** One line per page: "<page> <number of non-space characters>". */
  pageText: string;
  /** Overfull boxes from the LaTeX log. */
  overfull: { file: string | null; line: number | null; message: string }[];
  /** Page count must divide by this (printing sheets). */
  multiple: 16 | 32;
  /** Pictures below this print as visibly soft; default 300. */
  goodDpi?: number;
  /** Below this they are an error; default 150. */
  minDpi?: number;
}

const status = (items: unknown[], bad: PreflightStatus): PreflightStatus => (items.length ? bad : 'ok');

/** Pages a document needs added to reach a multiple of `multiple`. */
export function blankPagesNeeded(pages: number, multiple: number): number {
  return pages % multiple === 0 ? 0 : multiple - (pages % multiple);
}

export function buildPreflight(input: PreflightInput): PreflightReport {
  const pages = Number(/^Pages:\s+(\d+)/m.exec(input.info)?.[1] ?? 0);
  const goodDpi = input.goodDpi ?? 300;
  const minDpi = input.minDpi ?? 150;

  // pdffonts: name type encoding emb sub uni object ID (the type may contain spaces: "CID Type 0C").
  const notEmbedded: PreflightItem[] = [];
  for (const line of input.fonts.split('\n').slice(2)) {
    const m = /^(\S+)\s+.+?\s+(yes|no)\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/.exec(line.trim());
    if (m && m[2] === 'no') notEmbedded.push({ text: m[1]! });
  }

  // pdfimages -list: page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio
  const lowDpi: PreflightItem[] = [];
  let worstDpi = Infinity;
  const rgb: PreflightItem[] = [];
  const pagesWithImages = new Set<number>();
  for (const line of input.images.split('\n').slice(2)) {
    const c = line.trim().split(/\s+/);
    if (c.length < 14 || !/^\d+$/.test(c[0]!) || c[2] !== 'image') continue;
    const page = Number(c[0]);
    pagesWithImages.add(page);
    const dpi = Math.min(Number(c[12]), Number(c[13]));
    if (Number.isFinite(dpi) && dpi < goodDpi) {
      lowDpi.push({ page, text: `${c[3]}×${c[4]} px, ${dpi} dpi` });
      worstDpi = Math.min(worstDpi, dpi);
    }
    if (c[5] === 'rgb' || c[5] === 'icc' || c[5] === 'index') rgb.push({ page, text: `${c[3]}×${c[4]} px, ${c[5]}` });
  }

  // Pages with neither text nor pictures.
  const empty: PreflightItem[] = [];
  for (const line of input.pageText.split('\n')) {
    const m = /^(\d+)\s+(\d+)$/.exec(line.trim());
    if (m && m[2] === '0' && !pagesWithImages.has(Number(m[1]))) empty.push({ page: Number(m[1]), text: '' });
  }

  const overfull = input.overfull
    .map((o) => ({ o, pt: Number(/\(([\d.]+)pt too wide\)/.exec(o.message)?.[1] ?? 0) }))
    // Under 1pt nobody sees it.
    .filter((x) => x.pt >= 1)
    .map(({ o, pt }): PreflightItem => ({ file: o.file ?? undefined, line: o.line ?? undefined, text: `${pt}pt` }));

  const need = blankPagesNeeded(pages, input.multiple);
  const checks: PreflightCheck[] = [
    { id: 'fonts', status: status(notEmbedded, 'error'), items: notEmbedded },
    { id: 'image-dpi', status: lowDpi.length ? (worstDpi < minDpi ? 'error' : 'warning') : 'ok', items: lowDpi },
    { id: 'image-color', status: status(rgb, 'warning'), items: rgb },
    {
      id: 'page-count',
      status: need ? 'warning' : 'ok',
      items: need ? [{ text: `${pages} → ${pages + need}` }] : [],
      ...(need ? { fix: { kind: 'blankPages' as const, count: need } } : {}),
    },
    { id: 'overfull', status: status(overfull, 'warning'), items: overfull },
    // Blank pages before chapters are usually wanted: a warning to look at, not an error.
    { id: 'empty-pages', status: status(empty, 'warning'), items: empty },
  ];
  return { pages, checks };
}

/** The main file with `count` blank pages (\bosbet) before \end{document}; null without one. */
export function withBlankPages(main: string, count: number): string | null {
  const m = /^[ \t]*\\end\{document\}/m.exec(main);
  if (!m || count < 1) return null;
  const pages = Array.from({ length: count }, () => '\\bosbet').join('\n');
  return `${main.slice(0, m.index)}% Preflight: bet soni bosma taboqqa karrali boʻlishi uchun\n${pages}\n${main.slice(m.index)}`;
}

/**
 * Shell script for the sandbox (the compiler image has poppler): reads out.pdf,
 * writes info.txt, fonts.txt, images.txt and pages.txt into out/, as a tar on stdout.
 */
export const PREFLIGHT_SCRIPT = [
  'set -u',
  'cd /work || exit 2',
  'tar -x -f - --no-same-owner --no-same-permissions >&2 || exit 3',
  '[ -f out.pdf ] || { echo "preflight: out.pdf missing" >&2; exit 4; }',
  'mkdir -p out',
  'pdfinfo out.pdf > out/info.txt 2>&2',
  'pdffonts out.pdf > out/fonts.txt 2>&2',
  'pdfimages -list out.pdf > out/images.txt 2>&2',
  // Text of each page, separated by form feeds: the number of non-space characters per page.
  "pdftotext -q out.pdf - | awk 'BEGIN { RS = \"\\f\" } { gsub(/[ \\t\\r\\n]/, \"\"); print NR, length($0) }' > out/pages.txt",
  'cd out && tar -c -f - info.txt fonts.txt images.txt pages.txt',
].join('\n');
