/**
 * Print settings for a printing house: page format, crop marks, CMYK colours,
 * and an ISBN barcode (EAN-13 drawn with TikZ) with the publication data page
 * Uzbek books carry (UOʻK, KBK, format, conventional printed sheets, run).
 * Written into the project as bosma.sty (see bosmaSty).
 */

export interface PrintFormat {
  id: string;
  /** Trimmed page size in mm. */
  width: number;
  height: number;
  /** Paper format as printed in the colophon, e.g. "60×84 1/16". */
  sheet: string;
  /** Pages per printed sheet and the conventional sheet coefficient (sheet area / 60×90 cm). */
  pagesPerSheet: number;
  coefficient: number;
}

export const PRINT_FORMATS: PrintFormat[] = [
  { id: '60x84-16', width: 145, height: 200, sheet: '60×84 1/16', pagesPerSheet: 16, coefficient: 0.93 },
  { id: '70x100-16', width: 170, height: 240, sheet: '70×100 1/16', pagesPerSheet: 16, coefficient: 1.3 },
  { id: '84x108-32', width: 130, height: 200, sheet: '84×108 1/32', pagesPerSheet: 32, coefficient: 1.68 },
  { id: 'a5', width: 148, height: 210, sheet: '60×84 1/16', pagesPerSheet: 16, coefficient: 0.93 },
  { id: 'b5', width: 176, height: 250, sheet: '70×100 1/16', pagesPerSheet: 16, coefficient: 1.3 },
  { id: 'a4', width: 210, height: 297, sheet: '60×84 1/8', pagesPerSheet: 8, coefficient: 0.93 },
];

export interface PrintSpec {
  format: string;
  /** Crop marks around the trimmed page. */
  marks: boolean;
  /** Colours as CMYK (pictures keep their own colours). */
  cmyk: boolean;
  /** ISBN-13 for the barcode, with or without hyphens. */
  isbn?: string;
}

/** Digits of a valid ISBN-13 (978/979, right check digit), or null. */
export function isbnDigits(isbn: string): string | null {
  const d = isbn.replace(/[\s-]/g, '');
  if (!/^97[89]\d{10}$/.test(d)) return null;
  const sum = [...d.slice(0, 12)].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(d[12]) ? d : null;
}

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** The 95 modules of an EAN-13 code ("1" = bar). */
export function ean13Modules(digits: string): string {
  const first = Number(digits[0]);
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (PARITY[first]![i - 1] === 'L' ? L : G)[Number(digits[i])]!;
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[Number(digits[i])]!;
  return bits + '101';
}

/** TikZ code of the barcode with the ISBN above and the digits below (37.3 × 25.9 mm at 100 %). */
export function ean13Tikz(isbn: string): string {
  const digits = isbnDigits(isbn);
  if (!digits) throw new Error('Invalid ISBN-13');
  const bits = ean13Modules(digits);
  const m = 0.33; // module width in mm
  const guards = new Set([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]);
  const bars: string[] = [];
  for (let i = 0; i < bits.length; ) {
    if (bits[i] !== '1') {
      i++;
      continue;
    }
    let j = i;
    while (bits[j] === '1') j++;
    const low = guards.has(i) ? -1.65 : 0;
    bars.push(`\\fill (${(11 * m + i * m).toFixed(2)}mm,${low}mm) rectangle (${(11 * m + j * m).toFixed(2)}mm,22.85mm);`);
    i = j;
  }
  const hyphenated = isbn.trim().replace(/\s+/g, '');
  const digitAt = (x: number, s: string) => `\\node[anchor=north] at (${x.toFixed(2)}mm,0mm) {${s}};`;
  const left = 11 * m + 3 * m;
  const right = 11 * m + 50 * m;
  const text = [
    digitAt(5 * m, digits[0]!),
    digitAt(left + 21 * m, digits.slice(1, 7)),
    digitAt(right + 21 * m, digits.slice(7)),
    `\\node[anchor=south] at (${(11 * m + 47.5 * m).toFixed(2)}mm,23mm) {ISBN ${hyphenated.includes('-') ? hyphenated : digits}};`,
  ];
  return [
    '\\begin{tikzpicture}[x=1mm,y=1mm,every node/.style={inner sep=0.5pt,font=\\fontsize{8}{8}\\selectfont\\sffamily}]',
    ...bars,
    ...text,
    '\\end{tikzpicture}',
  ].join('\n');
}

/** bosma.sty for the given settings. */
export function bosmaSty(spec: PrintSpec): string {
  const f = PRINT_FORMATS.find((x) => x.id === spec.format) ?? PRINT_FORMATS[0]!;
  const lines = [
    '% bosma.sty: Oversells print settings (the "Bosmaxona" button writes this file).',
    `% Format ${f.width}×${f.height} mm (${f.sheet})${spec.marks ? ', crop marks' : ''}${spec.cmyk ? ', CMYK colours' : ''}.`,
    '% Load it right after \\documentclass: \\usepackage{bosma}',
    '\\NeedsTeXFormat{LaTeX2e}',
    '\\ProvidesPackage{bosma}[2026/10/14 Oversells print settings]',
    `\\PassOptionsToPackage{paperwidth=${f.width}mm,paperheight=${f.height}mm}{geometry}`,
  ];
  if (spec.cmyk) lines.push('\\PassOptionsToPackage{cmyk}{xcolor}');
  if (spec.marks) lines.push(`\\RequirePackage[cam,center,width=${f.width + 30}mm,height=${f.height + 30}mm]{crop}`);
  lines.push(
    '\\RequirePackage{refcount}',
    '\\RequirePackage{lastpage}',
    '\\RequirePackage{tikz}',
    '% The page size needs geometry; colours loaded before this package still turn CMYK.',
    '\\AddToHook{begindocument/before}{%',
    '  \\@ifpackageloaded{geometry}{}{\\RequirePackage{geometry}}%',
    ...(spec.cmyk ? ['  \\selectcolormodel{cmyk}%'] : []),
    '}',
    '',
    `\\newcommand\\bosmabichimi{${f.sheet}}`,
    '% Conventional printed sheets: pages / pages per sheet × sheet coefficient.',
    `\\newcommand\\shartlibosmatabogi{\\IfRefUndefinedExpandable{LastPage}{?}{\\fpeval{round(\\getpagerefnumber{LastPage}/${f.pagesPerSheet}*${f.coefficient},1)}}}`,
  );
  const digits = spec.isbn ? isbnDigits(spec.isbn) : null;
  lines.push(
    digits
      ? `\\newcommand\\isbnraqami{${spec.isbn!.trim()}}\n\\newcommand\\isbnshtrixkod{%\n${ean13Tikz(spec.isbn!)}}`
      : '\\newcommand\\isbnraqami{}\n\\newcommand\\isbnshtrixkod{}',
  );
  lines.push(String.raw`
% \nashrmalumotlari{muallif=..., nomi=..., turi=darslik, uok=..., kbk=..., shahar=Toshkent,
%   nashriyot=..., yil=2026, sana=14.10.2026, adadi=1000, buyurtma=...}
\pgfkeys{/bosma/.cd, muallif/.store in=\bosma@muallif, nomi/.store in=\bosma@nomi, turi/.store in=\bosma@turi,
  uok/.store in=\bosma@uok, kbk/.store in=\bosma@kbk, shahar/.store in=\bosma@shahar, nashriyot/.store in=\bosma@nashriyot,
  yil/.store in=\bosma@yil, sana/.store in=\bosma@sana, adadi/.store in=\bosma@adadi, buyurtma/.store in=\bosma@buyurtma,
  muallif=, nomi=, turi=, uok=, kbk=, shahar=Toshkent, nashriyot=, yil=\the\year, sana=, adadi=, buyurtma=}
\newcommand\nashrmalumotlari[1]{\pgfkeys{/bosma/.cd,#1}%
  \par\vspace*{\fill}{\small\setlength\parindent{0pt}\setlength\parskip{0pt}\raggedright
  \ifx\bosma@uok\@empty\else UOʻK~\bosma@uok\par\fi
  \ifx\bosma@kbk\@empty\else KBK~\bosma@kbk\par\fi
  \medskip
  \noindent\textbf{\bosma@muallif}\ifx\bosma@muallif\@empty\else.\fi\
  \bosma@nomi\ifx\bosma@turi\@empty\else: \bosma@turi\fi
  \ifx\bosma@muallif\@empty\else\ /~\bosma@muallif\fi. ---
  \bosma@shahar\ifx\bosma@nashriyot\@empty\else: \bosma@nashriyot\fi, \bosma@yil. ---
  \pageref{LastPage}~b.\par
  \ifx\isbnraqami\@empty\else\smallskip\noindent ISBN~\isbnraqami\par\fi
  \medskip\noindent
  \ifx\bosma@sana\@empty\else Bosishga ruxsat etildi \bosma@sana. \fi
  Bichimi \bosmabichimi. Shartli bosma tabogʻi \shartlibosmatabogi.
  \ifx\bosma@adadi\@empty\else Adadi \bosma@adadi~nusxa. \fi
  \ifx\bosma@buyurtma\@empty\else Buyurtma №~\bosma@buyurtma.\fi\par
  \ifx\isbnraqami\@empty\else\bigskip\noindent\isbnshtrixkod\par\fi}}
\endinput
`);
  return lines.join('\n');
}
