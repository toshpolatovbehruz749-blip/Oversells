/**
 * Test generator: reads a bank of multiple-choice questions written in LaTeX
 *
 *   \begin{savol}
 *     $2+3\cdot 4$ ni hisoblang.
 *     \togri{$14$}
 *     \variant{$20$}
 *     \variant{$24$}
 *   \end{savol}
 *
 * and writes a printable test: variants A, B, C... with questions and answers
 * shuffled (reproducibly, from a seed), an answer sheet with bubbles and an
 * answer key. The layout macros live in testlar.sty (TESTLAR_STY).
 */

export interface TestOption {
  text: string;
  correct: boolean;
}

export interface TestQuestion {
  text: string;
  options: TestOption[];
  /** 1-based line of \begin{savol} in the bank. */
  line: number;
}

export interface BankProblem {
  line: number;
  code: 'no_correct' | 'several_correct' | 'too_few_options' | 'too_many_options' | 'unclosed';
}

export interface TestOptions {
  title: string;
  /** Number of variants (1..26). */
  variants: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  answerSheet: boolean;
  answerKey: boolean;
  seed: number;
  /** Load dizayn.sty too (the project has a design). */
  design: boolean;
}

export interface GeneratedTest {
  tex: string;
  /** key[variant][question] = letter of the correct answer. */
  key: string[][];
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const MAX_OPTIONS = 6;

/** Removes % comments (not \%), keeping line breaks. */
function stripComments(text: string): string {
  return text.replace(/(^|[^\\])%.*$/gm, '$1');
}

/** Content of the balanced {...} that starts at `open`, and the index after it. */
function braced(text: string, open: number): { body: string; end: number } | null {
  if (text[open] !== '{') return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return { body: text.slice(open + 1, i), end: i + 1 };
  }
  return null;
}

/** Questions of a bank, and what is wrong with the ones that cannot be used. */
export function parseBank(source: string): { questions: TestQuestion[]; problems: BankProblem[] } {
  const text = stripComments(source);
  const questions: TestQuestion[] = [];
  const problems: BankProblem[] = [];
  const lineAt = (i: number) => text.slice(0, i).split('\n').length;
  const begin = /\\begin\{savol\}(?:\[[^\]]*\])?/g;
  for (let m = begin.exec(text); m; m = begin.exec(text)) {
    const start = m.index + m[0].length;
    const end = text.indexOf('\\end{savol}', start);
    const line = lineAt(m.index);
    if (end === -1) {
      problems.push({ line, code: 'unclosed' });
      break;
    }
    const body = text.slice(start, end);
    begin.lastIndex = end;
    const options: TestOption[] = [];
    let first = -1;
    const opt = /\\(togri|variant)\s*(?=\{)/g;
    for (let o = opt.exec(body); o; o = opt.exec(body)) {
      const arg = braced(body, o.index + o[0].length);
      if (!arg) continue;
      if (first === -1) first = o.index;
      options.push({ text: arg.body.trim(), correct: o[1] === 'togri' });
      opt.lastIndex = arg.end;
    }
    const correct = options.filter((o) => o.correct).length;
    if (correct === 0) problems.push({ line, code: 'no_correct' });
    else if (correct > 1) problems.push({ line, code: 'several_correct' });
    else if (options.length < 2) problems.push({ line, code: 'too_few_options' });
    else if (options.length > MAX_OPTIONS) problems.push({ line, code: 'too_many_options' });
    else questions.push({ text: body.slice(0, first).trim(), options, line });
  }
  return { questions, problems };
}

/** Small seeded PRNG (mulberry32): the same seed gives the same test. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rnd: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Answers per row: four short ones, two medium, one long (by their visible length). */
function columns(options: TestOption[]): number {
  const visible = (s: string) => s.replace(/\\[A-Za-z]+/g, 'x').replace(/[{}$^_]/g, '').length;
  const longest = Math.max(...options.map((o) => visible(o.text)));
  if (longest <= 18 && options.length % 4 === 0) return 4;
  if (longest <= 18 && options.length === 3) return 3;
  if (longest <= 40) return 2;
  return 1;
}

/** Escapes text typed by the user (the title) for LaTeX. */
function escapeTex(s: string): string {
  return s.replace(/[\\{}$&#%_^~]/g, (c) => (c === '\\' ? '\\textbackslash{}' : c === '~' ? '\\textasciitilde{}' : c === '^' ? '\\textasciicircum{}' : `\\${c}`));
}

export function generateTest(questions: TestQuestion[], opts: TestOptions): GeneratedTest {
  const variants = Math.max(1, Math.min(26, Math.floor(opts.variants)));
  const key: string[][] = [];
  const out: string[] = [];
  const title = escapeTex(opts.title.trim() || 'Test');

  out.push(
    '% Oversells «Test» tugmasi yaratgan fayl: savollar bankidan variantlar, javob varaqasi va javoblar kaliti.',
    '% Qoʻlda tahrirlamang: test qayta yaratilganda bu fayl yangidan yoziladi; savollarni bank faylida oʻzgartiring.',
    '\\documentclass[11pt,a4paper]{article}',
    '\\usepackage{fontspec}',
    '\\setmainfont{Noto Serif}',
    '\\usepackage{babel}',
    '\\babelprovide[import=uz-Latn, main]{uzbek}',
    '\\def\\uzbekhyphenmins{22}',
    '\\usepackage{amsmath,amssymb}',
    ...(opts.design ? ['\\usepackage{dizayn}'] : ['\\usepackage[top=1.8cm,bottom=1.8cm,left=2cm,right=2cm]{geometry}']),
    '\\usepackage{testlar}',
    '\\begin{document}',
  );

  for (let v = 0; v < variants; v++) {
    const rnd = random(opts.seed * 31 + v * 7919 + 1);
    const order = opts.shuffleQuestions ? shuffled(questions, rnd) : questions;
    const letters: string[] = [];
    out.push('', `% --- ${LETTERS[v]}-variant ---`, `\\testvariant{${title}}{${LETTERS[v]}}`);
    for (const q of order) {
      const options = opts.shuffleOptions ? shuffled(q.options, rnd) : q.options;
      letters.push(LETTERS[options.findIndex((o) => o.correct)]!);
      out.push(
        `\\testsavol{${q.text}}{${columns(options)}}{%`,
        ...options.map((o, i) => `  \\testjavob{${LETTERS[i]}}{${o.text}}%`),
        '}',
      );
    }
    key.push(letters);
  }

  const count = questions.length;
  const optionCount = Math.max(2, ...questions.map((q) => q.options.length));
  if (opts.answerSheet && count > 0) {
    out.push('', '% --- Javob varaqasi ---', `\\testjavobvaraqasi{${title}}{%`);
    out.push(answerSheet(count, optionCount, variants));
    out.push('}');
  }
  if (opts.answerKey && count > 0) {
    out.push('', '% --- Javoblar kaliti ---', `\\testkalit{${title}}{%`);
    for (let start = 0; start < count; start += 15) {
      const n = Math.min(15, count - start);
      out.push(
        `\\begin{tabular}{|c|${'c|'.repeat(n)}}\\hline`,
        `\\textbf{Variant} & ${Array.from({ length: n }, (_, i) => `\\textbf{${start + i + 1}}`).join(' & ')} \\\\\\hline`,
        ...key.map((row, v) => `${LETTERS[v]} & ${row.slice(start, start + n).join(' & ')} \\\\\\hline`),
        '\\end{tabular}\\par\\bigskip',
      );
    }
    out.push('}');
  }
  out.push('', '\\end{document}', '');
  return { tex: out.join('\n'), key };
}

/** TikZ code of the bubbles: variant letters and one row per question, in columns of 25. */
function answerSheet(questions: number, options: number, variants: number): string {
  const lines: string[] = ['\\begin{tikzpicture}[x=0.85cm,y=-0.85cm,every node/.style={font=\\small}]'];
  lines.push('\\node[anchor=west,font=\\small\\bfseries] at (0,0) {Variant:};');
  for (let v = 0; v < variants; v++) lines.push(`\\testpufak{${3.2 + v}}{0}{${LETTERS[v]}}`);
  const perColumn = 25;
  const width = options + 2.4;
  for (let q = 0; q < questions; q++) {
    const col = Math.floor(q / perColumn);
    const row = (q % perColumn) + 2;
    const x0 = col * width;
    lines.push(`\\node[anchor=east,font=\\small\\bfseries] at (${(x0 + 1).toFixed(1)},${row}) {${q + 1}.};`);
    for (let o = 0; o < options; o++) lines.push(`\\testpufak{${(x0 + 1.6 + o).toFixed(1)}}{${row}}{${LETTERS[o]}}`);
  }
  lines.push('\\end{tikzpicture}');
  return lines.join('\n');
}

/** Layout of tests and of a bank shown as a document (testlar.sty). */
export const TESTLAR_STY = String.raw`% testlar.sty: Oversells test layout (the "Test" button writes test.tex with it).
% In a question bank: \begin{savol} ... \togri{right answer} \variant{other answer} ... \end{savol}
\NeedsTeXFormat{LaTeX2e}
\ProvidesPackage{testlar}[2026/10/14 Oversells tests]
\RequirePackage{amssymb}
\RequirePackage{xcolor}
\RequirePackage{tikz}

% --- The bank as a document (teacher's view: right answers are marked) ---------------
\newcounter{savol}
\newenvironment{savol}[1][]{\par\addvspace{0.8\baselineskip}\refstepcounter{savol}\noindent\textbf{\thesavol.}~\ignorespaces}{\par}
\newcommand\togri[1]{\par\hspace*{1.6em}\textcolor{green!45!black}{$\checkmark$}~#1}
\newcommand\variant[1]{\par\hspace*{1.6em}$\circ$~#1}

% --- A variant -------------------------------------------------------------------------
\newcounter{testsavol}
\newlength\testustun
\newcommand\testvariant[2]{\clearpage\setcounter{testsavol}{0}%
  \noindent\begin{tabular*}{\linewidth}{@{}l@{\extracolsep{\fill}}r@{}}
    \textbf{\large #1} & \textbf{\Large #2-variant}\\[6pt]
    F.I.Sh.: \rule{7.5cm}{0.4pt} & Sinf: \rule{2.2cm}{0.4pt}
  \end{tabular*}\par\smallskip\hrule\medskip}
% \testsavol{question}{answers per row}{\testjavob{A}{...}\testjavob{B}{...}...}
\newcommand\testsavol[3]{\par\addvspace{0.7\baselineskip}\stepcounter{testsavol}%
  \noindent\begin{minipage}{\linewidth}
    \hangindent=1.6em\hangafter=1\noindent\makebox[1.6em][l]{\textbf{\thetestsavol.}}#1\par\smallskip
    \setlength\testustun{\dimexpr(\linewidth-1.6em)/#2\relax}%
    \noindent\hspace*{1.6em}\ignorespaces#3\par
  \end{minipage}\par}
\newcommand\testjavob[2]{\parbox[t]{\testustun}{\hangindent=1.6em\hangafter=1\makebox[1.6em][l]{\textbf{#1)}}#2\strut}\hspace{0pt}\ignorespaces}

% --- Answer sheet and key -------------------------------------------------------------------
\newcommand\testpufak[3]{\draw[line width=0.6pt] (#1,#2) circle (0.3); \node[font=\scriptsize] at (#1,#2) {#3};}
\newcommand\testjavobvaraqasi[2]{\clearpage
  \noindent\textbf{\large #1}\hfill\textbf{\Large Javob varaqasi}\par\medskip
  \noindent F.I.Sh.: \rule{8cm}{0.4pt}\hfill Sinf: \rule{2.2cm}{0.4pt}\par\medskip
  \noindent\small Toʻgʻri javob doirachasini toʻliq boʻyang. Variant harfini ham belgilang.\par\bigskip
  \noindent#2\par}
\newcommand\testkalit[2]{\clearpage
  \noindent\textbf{\large #1}\hfill\textbf{\Large Javoblar kaliti}\par\bigskip
  \noindent\renewcommand\arraystretch{1.5}\large #2\par}
\endinput
`;
