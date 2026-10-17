import { createHash } from 'node:crypto';
import {
  DESIGN_BOXES,
  DESIGN_DRAWINGS,
  DESIGN_HEADERS,
  DESIGN_HEADINGS,
  DESIGN_LANGUAGES,
  DESIGN_MARGINS,
  DESIGN_MATH_FONTS,
  DESIGN_TEXT_FONTS,
  type DesignLanguage,
  type DesignSpec,
} from '@oversells/shared';
import { z } from 'zod';

/**
 * Turns a DesignSpec into `dizayn.sty`, the package a project loads with
 * \usepackage{dizayn}. The package is self-contained (only packages from the
 * compiler image), works when loaded after the usual preamble (amsmath,
 * amsthm, tikz, pgfplots, geometry, hyperref) and re-defines environments of
 * the same name, so applying a design to an existing document restyles it.
 */

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Colour must be #RRGGBB');

export const designSpecSchema = z
  .object({
    fonts: z
      .object({
        body: z.enum(DESIGN_TEXT_FONTS),
        heading: z.enum(DESIGN_TEXT_FONTS),
        math: z.enum(DESIGN_MATH_FONTS),
        mathLetters: z.enum(['math', 'text']),
        size: z.union([z.literal(10), z.literal(11), z.literal(12)]),
      })
      .strict(),
    colors: z.object({ primary: hex, secondary: hex, accent: hex, ink: hex }).strict(),
    headings: z.enum(DESIGN_HEADINGS),
    boxes: z.enum(DESIGN_BOXES),
    page: z.object({ margins: z.enum(DESIGN_MARGINS), header: z.enum(DESIGN_HEADERS) }).strict(),
    drawings: z.enum(DESIGN_DRAWINGS),
    icons: z.boolean(),
    titleBanner: z.boolean(),
  })
  .strict();

export const designLanguageSchema = z.enum(DESIGN_LANGUAGES);

/** Font files, so letters in formulas can come from the text font (range=...). */
const TEXT_FONT_FILES: Record<DesignSpec['fonts']['body'], { regular: string; italic: string; sans: boolean }> = {
  'Noto Serif': { regular: 'NotoSerif-Regular.ttf', italic: 'NotoSerif-Italic.ttf', sans: false },
  'Noto Sans': { regular: 'NotoSans-Regular.ttf', italic: 'NotoSans-Italic.ttf', sans: true },
  'DejaVu Serif': { regular: 'DejaVuSerif.ttf', italic: 'DejaVuSerif-Italic.ttf', sans: false },
  'DejaVu Sans': { regular: 'DejaVuSans.ttf', italic: 'DejaVuSans-Oblique.ttf', sans: true },
  Inter: { regular: 'Inter-Regular.otf', italic: 'Inter-Italic.otf', sans: true },
  Lato: { regular: 'Lato-Regular.ttf', italic: 'Lato-Italic.ttf', sans: true },
};

const MATH_FONT_FILES: Record<DesignSpec['fonts']['math'], string> = {
  'Latin Modern Math': 'latinmodern-math.otf',
  'TeX Gyre Pagella Math': 'texgyrepagella-math.otf',
  'TeX Gyre DejaVu Math': 'texgyredejavu-math.otf',
};

type TitleKey =
  | 'teorema'
  | 'tarif'
  | 'lemma'
  | 'natija'
  | 'isbot'
  | 'misol'
  | 'yechim'
  | 'eslatma'
  | 'diqqat'
  | 'bilasizmi'
  | 'tarix'
  | 'mashqlar'
  | 'javoblar'
  | 'muhim';

/** Box titles in the document language. */
export const TITLES: Record<DesignLanguage, Record<TitleKey, string>> = {
  'uz-latn': {
    teorema: 'Teorema',
    tarif: 'Taʼrif',
    lemma: 'Lemma',
    natija: 'Natija',
    isbot: 'Isbot',
    misol: 'Misol',
    yechim: 'Yechim',
    eslatma: 'Eslatma',
    diqqat: 'Diqqat',
    bilasizmi: 'Bilasizmi?',
    tarix: 'Tarixdan',
    mashqlar: 'Mashqlar',
    javoblar: 'Javoblar',
    muhim: 'Muhim formula',
  },
  'uz-cyrl': {
    teorema: 'Теорема',
    tarif: 'Таъриф',
    lemma: 'Лемма',
    natija: 'Натижа',
    isbot: 'Исбот',
    misol: 'Мисол',
    yechim: 'Ечим',
    eslatma: 'Эслатма',
    diqqat: 'Диққат',
    bilasizmi: 'Биласизми?',
    tarix: 'Тарихдан',
    mashqlar: 'Машқлар',
    javoblar: 'Жавоблар',
    muhim: 'Муҳим формула',
  },
  ru: {
    teorema: 'Теорема',
    tarif: 'Определение',
    lemma: 'Лемма',
    natija: 'Следствие',
    isbot: 'Доказательство',
    misol: 'Пример',
    yechim: 'Решение',
    eslatma: 'Замечание',
    diqqat: 'Внимание',
    bilasizmi: 'Знаете ли вы?',
    tarix: 'Из истории',
    mashqlar: 'Упражнения',
    javoblar: 'Ответы',
    muhim: 'Важная формула',
  },
  en: {
    teorema: 'Theorem',
    tarif: 'Definition',
    lemma: 'Lemma',
    natija: 'Corollary',
    isbot: 'Proof',
    misol: 'Example',
    yechim: 'Solution',
    eslatma: 'Note',
    diqqat: 'Caution',
    bilasizmi: 'Did you know?',
    tarix: 'From history',
    mashqlar: 'Exercises',
    javoblar: 'Answers',
    muhim: 'Key formula',
  },
};

const htmlColor = (c: string) => c.slice(1).toUpperCase();

/** pdfLaTeX cannot typeset ʻ ʼ; it gets the closest ASCII-safe quotes. */
function pdfSafe(text: string): string {
  return text.replace(/ʻ/g, '`').replace(/ʼ/g, "'");
}

const MARGINS: Record<DesignSpec['page']['margins'], string> = {
  narrow: 'top=2cm, bottom=2.2cm, left=1.9cm, right=1.9cm',
  normal: 'top=2.4cm, bottom=2.6cm, left=2.4cm, right=2.4cm',
  wide: 'top=2.4cm, bottom=2.6cm, left=2.2cm, right=5.2cm, marginparwidth=3.6cm, marginparsep=0.6cm',
};

function boxStyle(spec: DesignSpec): string {
  // #1 = frame/accent colour of the box kind.
  switch (spec.boxes) {
    case 'rule':
      return String.raw`enhanced, breakable, blanker, before skip=1.1\baselineskip, after skip=1.1\baselineskip,
    borderline north={0.6pt}{0pt}{#1}, borderline south={0.6pt}{0pt}{#1!45},
    top=5pt, bottom=6pt, left=0pt, right=0pt,
    coltitle=#1, fonttitle=\dz@headfont\bfseries, attach title to upper={\ \ }`;
    case 'soft':
      return String.raw`enhanced, breakable, before skip=1.1\baselineskip, after skip=1.1\baselineskip,
    colback=#1!6, colframe=#1, boxrule=0pt, leftrule=3pt, arc=2pt, outer arc=2pt,
    left=8pt, right=8pt, top=6pt, bottom=6pt,
    coltitle=#1, fonttitle=\dz@headfont\bfseries, attach title to upper={\ \ }`;
    case 'card':
      return String.raw`enhanced, breakable, before skip=1.6\baselineskip, after skip=1.1\baselineskip,
    colback=white, colframe=#1!55, boxrule=0.7pt, arc=4pt,
    left=9pt, right=9pt, top=10pt, bottom=7pt,
    attach boxed title to top left={xshift=8pt, yshift=-\tcboxedtitleheight/2},
    boxed title style={colback=#1, colframe=#1, boxrule=0pt, arc=3pt, top=1.5pt, bottom=1.5pt, left=5pt, right=5pt},
    coltitle=white, fonttitle=\dz@headfont\bfseries\small,
    drop fuzzy shadow={#1!35!black!25}`;
    case 'rounded':
      return String.raw`enhanced, breakable, before skip=1.3\baselineskip, after skip=1.1\baselineskip,
    colback=#1!8, colframe=#1, boxrule=1.2pt, arc=9pt, outer arc=9pt,
    left=10pt, right=10pt, top=7pt, bottom=8pt,
    colbacktitle=#1, coltitle=white, titlerule=0pt, toptitle=2pt, bottomtitle=2pt,
    fonttitle=\dz@headfont\bfseries`;
    case 'frame':
      return String.raw`enhanced, breakable, before skip=1.1\baselineskip, after skip=1.1\baselineskip,
    colback=white, colframe=#1, boxrule=0.6pt, arc=0pt, outer arc=0pt,
    left=7pt, right=7pt, top=5pt, bottom=6pt,
    colbacktitle=#1!12, coltitle=#1!70!black, titlerule=0.4pt, toptitle=2pt, bottomtitle=2pt,
    fonttitle=\dz@headfont\bfseries`;
  }
}

function headings(spec: DesignSpec): string {
  const sizes = String.raw`
\titlespacing*{\section}{0pt}{2.2ex plus 1ex minus .2ex}{1.3ex plus .2ex}
\titlespacing*{\subsection}{0pt}{1.8ex plus 1ex minus .2ex}{1ex plus .2ex}`;
  switch (spec.headings) {
    case 'classic':
      return String.raw`\titleformat{\section}{\dz@headfont\Large\bfseries\color{dzSiyoh}}{\textcolor{dzAsosiy}{\thesection}}{0.8em}{}[\vspace{0.2ex}{\color{dzAsosiy!50}\titlerule[0.5pt]}]
\titleformat{\subsection}{\dz@headfont\large\bfseries\color{dzSiyoh}}{\textcolor{dzAsosiy}{\thesubsection}}{0.7em}{}
\titleformat{\subsubsection}{\dz@headfont\normalsize\bfseries\itshape\color{dzSiyoh}}{\thesubsubsection}{0.6em}{}` + sizes;
    case 'band':
      return String.raw`\titleformat{\section}{\dz@headfont\Large\bfseries\color{dzAsosiy}}{\dz@numberbox{\thesection}}{0.6em}{}[\vspace{0.1ex}{\color{dzAsosiy!30}\titlerule[1.2pt]}]
\titleformat{\subsection}{\dz@headfont\large\bfseries\color{dzAsosiy!85!black}}{\thesubsection}{0.7em}{}
\titleformat{\subsubsection}{\dz@headfont\normalsize\bfseries\color{dzSiyoh}}{\thesubsubsection}{0.6em}{}` + sizes;
    case 'bar':
      return String.raw`\titleformat{\section}{\dz@headfont\Large\bfseries\color{dzSiyoh}}{\llap{\textcolor{dzAsosiy}{\rule[-0.32ex]{4pt}{1.2em}}\hspace{9pt}}\textcolor{dzAsosiy}{\thesection}}{0.7em}{}
\titleformat{\subsection}{\dz@headfont\large\bfseries\color{dzSiyoh}}{\llap{\textcolor{dzAsosiy!60}{\rule[-0.25ex]{3pt}{1em}}\hspace{9pt}}\textcolor{dzAsosiy}{\thesubsection}}{0.6em}{}
\titleformat{\subsubsection}{\dz@headfont\normalsize\bfseries\color{dzSiyoh}}{\thesubsubsection}{0.6em}{}` + sizes;
    case 'circle':
      return String.raw`\titleformat{\section}{\dz@headfont\Large\bfseries\color{dzAsosiy}}{\dz@numbercircle{\thesection}}{0.6em}{}
\titleformat{\subsection}{\dz@headfont\large\bfseries\color{dzIkkinchi}}{\textcolor{dzUrgu}{\dz@star}\ \thesubsection}{0.6em}{}
\titleformat{\subsubsection}{\dz@headfont\normalsize\bfseries\color{dzSiyoh}}{\thesubsubsection}{0.6em}{}` + sizes;
    case 'underline':
      return String.raw`\titleformat{\section}{\dz@headfont\Large\color{dzSiyoh}}{\textcolor{dzAsosiy}{\bfseries\thesection}}{0.7em}{}[\vspace{-1.6ex}{\color{dzAsosiy}\rule{3cm}{1.6pt}}]
\titleformat{\subsection}{\dz@headfont\large\color{dzSiyoh}}{\textcolor{dzAsosiy}{\thesubsection}}{0.6em}{}
\titleformat{\subsubsection}{\dz@headfont\normalsize\itshape\color{dzSiyoh}}{\thesubsubsection}{0.6em}{}` + sizes;
  }
}

function header(spec: DesignSpec): string {
  if (spec.page.header === 'none') return '';
  const common = String.raw`\RequirePackage{fancyhdr}
\renewcommand{\sectionmark}[1]{\markboth{\ifnum\value{section}>0 \thesection.\ \fi#1}{}}
\fancypagestyle{plain}{\fancyhf{}\renewcommand{\headrulewidth}{0pt}\fancyfoot[C]{\dz@pagenumber}}
\pagestyle{fancy}
\fancyhf{}`;
  if (spec.page.header === 'simple') {
    return common + String.raw`
\renewcommand{\headrulewidth}{0pt}
\fancyfoot[C]{\dz@pagenumber}`;
  }
  return common + String.raw`
\fancyhead[L]{\small\dz@headfont\color{dzSiyoh!60}\nouppercase{\leftmark}}
\fancyhead[R]{\dz@pagenumber}
\renewcommand{\headrulewidth}{0.6pt}
\renewcommand{\headrule}{{\color{dzAsosiy!35}\hrule height\headrulewidth width\headwidth}}
\setlength{\headheight}{18pt}`;
}

function icons(spec: DesignSpec): string {
  if (!spec.icons) {
    return String.raw`\newcommand\dz@icon[1]{}`;
  }
  // Small pictograms drawn with TikZ (no icon fonts needed).
  return String.raw`\newcommand\dz@icon[1]{\csname dz@icon@#1\endcsname\ }
\newcommand\dz@icon@info{\tikz[baseline=-0.55ex,scale=0.9]{\fill[even odd rule] (0,0) circle (0.62em) (-0.075em,-0.4em) rectangle (0.075em,0.12em) (0,0.32em) circle (0.09em);}}
\newcommand\dz@icon@warn{\tikz[baseline=-0.35ex,scale=0.9]{\fill[even odd rule, rounded corners=0.6pt] (-0.7em,-0.52em) -- (0.7em,-0.52em) -- (0,0.72em) -- cycle (-0.07em,-0.18em) rectangle (0.07em,0.34em) (0,-0.33em) circle (0.08em);}}
\newcommand\dz@icon@bulb{\tikz[baseline=-0.4ex,scale=0.9]{\fill (0,0.12em) circle (0.5em);\fill (-0.25em,-0.62em) rectangle (0.25em,-0.25em);\fill (-0.17em,-0.78em) rectangle (0.17em,-0.66em);}}
\newcommand\dz@icon@pencil{\tikz[baseline=-0.4ex,rotate=45,scale=0.9]{\fill (-0.2em,-0.35em) rectangle (0.2em,0.75em);\fill (-0.2em,-0.45em) -- (0.2em,-0.45em) -- (0,-0.85em) -- cycle;}}
\newcommand\dz@icon@book{\tikz[baseline=-0.45ex,scale=0.9]{\fill (-0.7em,-0.5em) rectangle (-0.06em,0.55em);\fill (0.06em,-0.5em) rectangle (0.7em,0.55em);}}
\newcommand\dz@icon@star{\tikz[baseline=-0.5ex]\node[star, star points=5, star point ratio=2.4, fill, inner sep=0pt, minimum size=1.05em]{};}`;
}

/** Base size of the text (10/11/12 pt), whatever the class option was (values of size1x.clo). */
const SIZES: Record<10 | 11 | 12, Array<[string, number, number]>> = {
  10: [['tiny', 5, 6], ['scriptsize', 7, 8], ['footnotesize', 8, 9.5], ['small', 9, 11], ['normalsize', 10, 12.5], ['large', 12, 14], ['Large', 14.4, 18], ['LARGE', 17.28, 22], ['huge', 20.74, 25], ['Huge', 24.88, 30]],
  11: [['tiny', 6, 7], ['scriptsize', 8, 9.5], ['footnotesize', 9, 11], ['small', 10, 12], ['normalsize', 10.95, 13.6], ['large', 12, 14], ['Large', 14.4, 18], ['LARGE', 17.28, 22], ['huge', 20.74, 25], ['Huge', 24.88, 30]],
  12: [['tiny', 6, 7], ['scriptsize', 8, 9.5], ['footnotesize', 10, 12], ['small', 10.95, 13.6], ['normalsize', 12, 14.5], ['large', 14.4, 18], ['Large', 17.28, 22], ['LARGE', 20.74, 25], ['huge', 24.88, 30], ['Huge', 24.88, 30]],
};

function fontSizes(size: 10 | 11 | 12): string {
  return SIZES[size]
    .map(([cmd, pt, lead]) => `\\renewcommand\\${cmd}{\\@setfontsize\\${cmd}{${pt}}{${lead}}}`)
    .concat([String.raw`\normalsize`])
    .join('\n');
}

/** The complete dizayn.sty for a design. */
export function generateDesignPackage(spec: DesignSpec, lang: DesignLanguage, name: string): string {
  const titles = TITLES[lang];
  const body = TEXT_FONT_FILES[spec.fonts.body];
  const head = spec.fonts.heading;
  const lw = spec.drawings === 'playful' ? '0.9pt' : '0.6pt';
  const title = (key: TitleKey) => String.raw`\iftutex ${titles[key]}\else ${pdfSafe(titles[key])}\fi`;

  const lines: string[] = [];
  lines.push(String.raw`% dizayn.sty — Oversells design "${name.replace(/[\\{}%#$&^_~\n]/g, '')}".
% Generated by Oversells; choose another design in the editor ("Dizayn") to
% regenerate it. You may also edit this copy freely.
% Compile with XeLaTeX or LuaLaTeX (pdfLaTeX works without the design fonts).
\NeedsTeXFormat{LaTeX2e}
\ProvidesPackage{dizayn}[2026/10/13 Oversells design]
\RequirePackage{iftex}
\RequirePackage{xcolor}
\RequirePackage{amsmath}
% tg, ctg, arctg, arcctg (as written in Uzbek schools).
\providecommand\tg{\operatorname{tg}}\providecommand\ctg{\operatorname{ctg}}
\providecommand\arctg{\operatorname{arctg}}\providecommand\arcctg{\operatorname{arcctg}}
\RequirePackage{tcolorbox}
\tcbuselibrary{skins,breakable,theorems}
\RequirePackage{titlesec}
\RequirePackage{enumitem}
\RequirePackage{multicol}
\RequirePackage{tikz}
\usetikzlibrary{arrows.meta,calc,angles,quotes,patterns,positioning,decorations.pathmorphing,shapes.geometric,babel}
\RequirePackage{pgfplots}
\pgfplotsset{compat=1.18}`);

  // Colours
  lines.push(String.raw`
% --- Ranglar / colours ------------------------------------------------------------
\definecolor{dzAsosiy}{HTML}{${htmlColor(spec.colors.primary)}}
\definecolor{dzIkkinchi}{HTML}{${htmlColor(spec.colors.secondary)}}
\definecolor{dzUrgu}{HTML}{${htmlColor(spec.colors.accent)}}
\definecolor{dzSiyoh}{HTML}{${htmlColor(spec.colors.ink)}}
\colorlet{dzKulrang}{dzSiyoh!55}
\colorlet{dzDiqqat}{red!70!black}
\colorlet{dzTarix}{brown!80!black}`);

  // Page
  lines.push(String.raw`
% --- Sahifa / page ----------------------------------------------------------------
\@ifpackageloaded{geometry}{\geometry{${MARGINS[spec.page.margins]}}}{\RequirePackage[${MARGINS[spec.page.margins]}]{geometry}}
\setlength{\parindent}{1.2em}
\setlength{\parskip}{0.25\baselineskip plus 0.1\baselineskip}
\setlength{\emergencystretch}{3em}
% O'zbekcha bo'g'in ko'chirish: satr oxirida ham, boshida ham kamida 2 harf.
\def\uzbekhyphenmins{22}\def\uzbekcyrhyphenmins{22}
\newcommand\dz@pagenumber{\dz@headfont\small\textcolor{white}{\tikz[baseline=(n.base)]\node[fill=dzAsosiy, rounded corners=2pt, inner sep=2.5pt, minimum width=1.6em](n){\thepage};}}`);

  // Fonts
  const letters =
    spec.fonts.mathLetters === 'text'
      ? String.raw`
  % Harflar va raqamlar formulalarda ham matn shriftidan: matn va formula bir xil koʻrinadi.
  \setmathfont{${body.italic}}[range=it/{latin,Latin}]
  \setmathfont{${body.regular}}[range={up/{latin,Latin,num}}]`
      : '';
  lines.push(String.raw`
% --- Shriftlar / fonts --------------------------------------------------------------
\iftutex
  \RequirePackage{fontspec}
  \setmainfont{${spec.fonts.body}}
  \setsansfont{${body.sans ? spec.fonts.body : head === spec.fonts.body ? 'Noto Sans' : head}}
  \newfontfamily\dz@headfont{${head}}
  \RequirePackage{unicode-math}
  \unimathsetup{math-style=TeX, bold-style=TeX}
  \ExplSyntaxOn\msg_redirect_module:nnn{fontspec}{warning}{info}\ExplSyntaxOff
  \setmathfont{${MATH_FONT_FILES[spec.fonts.math]}}${letters}
  \ExplSyntaxOn\msg_redirect_module:nnn{fontspec}{warning}{}\ExplSyntaxOff
  \linespread{${body.sans ? '1.12' : '1.08'}}
\else
  \newcommand\dz@headfont{\sffamily}
\fi
${fontSizes(spec.fonts.size)}`);

  // Headings, header
  lines.push(String.raw`
% --- Sarlavhalar / headings -------------------------------------------------------------
\newcommand\dz@numberbox[1]{\tikz[baseline=(n.base)]\node[fill=dzAsosiy, text=white, rounded corners=2.5pt, inner xsep=5pt, inner ysep=3pt](n){#1};}
\newcommand\dz@numbercircle[1]{\tikz[baseline=(n.base)]\node[circle, fill=dzAsosiy, text=white, inner sep=1.5pt, minimum size=1.65em, font=\normalsize\bfseries](n){#1};}
\newcommand\dz@star{\tikz[baseline=-0.5ex]\node[star, star points=5, star point ratio=2.4, fill, inner sep=0pt, minimum size=0.95em]{};}
${headings(spec)}
${header(spec)}`);

  // Title banner
  if (spec.titleBanner) {
    lines.push(String.raw`
% --- Sarlavha banneri / title banner ------------------------------------------------------
\renewcommand{\maketitle}{\par
  \begin{tcolorbox}[enhanced, colback=dzAsosiy, colframe=dzAsosiy, arc=6pt, boxrule=0pt,
      left=16pt, right=16pt, top=14pt, bottom=12pt, coltext=white,
      overlay={\fill[dzUrgu] ([xshift=16pt]frame.south west) rectangle ([xshift=96pt,yshift=4pt]frame.south west);}]
    {\dz@headfont\bfseries\Huge\@title\par}
    \vspace{6pt}{\dz@headfont\large\@author\hfill\@date\par}
  \end{tcolorbox}
  \vspace{1.2\baselineskip}\thispagestyle{plain}}`);
  }

  // Boxes
  lines.push(String.raw`
% --- Qutilar: teorema, taʼrif, misol, ... / boxes --------------------------------------
${icons(spec)}
\tcbset{dz box/.style={${boxStyle(spec)}}}
\newcommand\dz@ttl[3]{\dz@icon{#1}#2\IfValueT{#3}{\ \mdseries(#3)}}
\@ifundefined{c@chapter}{\def\dz@within{section}}{\def\dz@within{chapter}}
% "Teorema 2.3" inside section 2, just "Teorema 3" before the first section.
\newcommand\dz@prefix{\ifnum\value{\dz@within}>0 \csname the\dz@within\endcsname.\fi}
\def\dz@format{number freestyle={\noexpand\dz@prefix\noexpand\arabic{\noexpand\tcbcounter}}}
\edef\dz@numbered{auto counter, number within=\dz@within, \unexpanded\expandafter{\dz@format}}
\edef\dz@shared{use counter from=teorema, \unexpanded\expandafter{\dz@format}}
\newcommand\dz@declare[4]{% #1 env, #2 counter options (expanded once), #3 colour, #4 title
  \expandafter\dz@declare@i\expandafter{#2}{#1}{#3}{#4}}
\newcommand\dz@declare@i[4]{\DeclareTColorBox[#1]{#2}{o}{dz box=#3, title={\dz@ttl{\dz@iconof{#2}}{#4}{##1}}}}
\newcommand\dz@iconof[1]{\ifcsname dz@iconname@#1\endcsname\csname dz@iconname@#1\endcsname\else star\fi}
\def\dz@iconname@teorema{star}\def\dz@iconname@tarif{book}\def\dz@iconname@misol{pencil}
\def\dz@iconname@eslatma{info}\def\dz@iconname@diqqat{warn}\def\dz@iconname@bilasizmi{bulb}\def\dz@iconname@tarix{book}
\dz@declare{teorema}{\dz@numbered}{dzAsosiy}{${title('teorema')}~\thetcbcounter}
\dz@declare{lemma}{\dz@shared}{dzAsosiy}{${title('lemma')}~\thetcbcounter}
\dz@declare{natija}{\dz@shared}{dzAsosiy}{${title('natija')}~\thetcbcounter}
\dz@declare{tarif}{\dz@numbered}{dzIkkinchi}{${title('tarif')}~\thetcbcounter}
\dz@declare{misol}{\dz@numbered}{dzUrgu}{${title('misol')}~\thetcbcounter}
\dz@declare{eslatma}{}{dzKulrang}{${title('eslatma')}}
\dz@declare{diqqat}{}{dzDiqqat}{${title('diqqat')}}
\dz@declare{bilasizmi}{}{dzUrgu}{${title('bilasizmi')}}
\dz@declare{tarix}{}{dzTarix}{${title('tarix')}}
% Isbot va yechim: qutisiz, oxirida rangli belgi.
\newcommand\dz@qed{\textcolor{dzAsosiy}{\rule{0.55em}{0.55em}}}
\DeclareDocumentEnvironment{isbot}{o}{\par\addvspace{0.5\baselineskip}\postdisplaypenalty=10000 \noindent{\dz@headfont\bfseries\color{dzAsosiy}\IfValueTF{#1}{#1}{${title('isbot')}}.}\ \ignorespaces}{\nobreak\hfill\dz@qed\par\addvspace{0.5\baselineskip}}
\DeclareDocumentEnvironment{yechim}{o}{\par\addvspace{0.4\baselineskip}\postdisplaypenalty=10000 \noindent{\dz@headfont\bfseries\color{dzUrgu}\IfValueTF{#1}{#1}{${title('yechim')}}.}\ \ignorespaces}{\nobreak\hfill\textcolor{dzUrgu}{\dz@qed}\par\addvspace{0.5\baselineskip}}
\@ifundefined{proof}{}{\RenewDocumentEnvironment{proof}{o}{\begin{isbot}[#1]}{\end{isbot}}}`);

  // Key formulas, exercises
  lines.push(String.raw`
% --- Muhim formulalar / key formulas -------------------------------------------------------
% \muhim{x_{1,2}=\frac{-b\pm\sqrt{D}}{2a}} yoki \muhim[Ildizlar formulasi]{...}
\tcbset{highlight math style={enhanced, colback=dzAsosiy!7, colframe=dzAsosiy, boxrule=0.8pt, arc=4pt, left=6pt, right=6pt, top=4pt, bottom=4pt}}
\NewDocumentCommand\muhim{o m}{%
  \IfValueTF{#1}
    {\[\tcbhighmath[enhanced, attach boxed title to top center={yshift=-2.2mm}, title={#1},
        boxed title style={colback=dzAsosiy, colframe=dzAsosiy, arc=2pt, boxrule=0pt, top=0.5pt, bottom=0.5pt},
        fonttitle=\dz@headfont\footnotesize\bfseries, coltitle=white, top=7pt]{#2}\]}
    {\[\tcbhighmath{#2}\]}}
% Matndagi kichik ajratma: \belgila{matn}
\newcommand\belgila[1]{\tikz[baseline=(t.base)]\node[fill=dzUrgu!22, rounded corners=1.5pt, inner xsep=2pt, inner ysep=1pt](t){\strut#1};}
% Hoshiyadagi eslatma: \yon{matn} (keng hoshiyada — yonida, aks holda — sahifa ostida)
${spec.page.margins === 'wide'
    ? String.raw`\newcommand\yon[1]{\marginpar{\raggedright\footnotesize\color{dzKulrang}\dz@headfont #1}}`
    : String.raw`\newcommand\yon[1]{\footnote{#1}}`}

% --- Roʻyxatlar va mashqlar / lists and exercises --------------------------------------------
\setlist[itemize,1]{label=\textcolor{dzAsosiy}{\small$\blacktriangleright$}}
\setlist[itemize,2]{label=\textcolor{dzUrgu}{\textbullet}}
\setlist[enumerate,1]{label=\textcolor{dzAsosiy}{\bfseries\arabic*.}}
\newcommand\dz@exnum[1]{\tikz[baseline=(n.base)]\node[circle, draw=dzUrgu, line width=0.8pt, text=dzUrgu, inner sep=0pt, minimum size=1.45em, font=\small\bfseries\dz@headfont](n){#1};}
\newenvironment{mashqlar}[1][\iftutex ${titles.mashqlar}\else ${pdfSafe(titles.mashqlar)}\fi]
  {\par\addvspace{\baselineskip}\noindent{\dz@headfont\bfseries\large\color{dzUrgu}\dz@icon{pencil}#1}\par\nobreak\vspace{0.3\baselineskip}%
   \begin{enumerate}[label=\protect\dz@exnum{\arabic*}, leftmargin=2.3em, labelsep=0.6em, itemsep=0.5\baselineskip]}
  {\end{enumerate}}
% Qiyinlik darajasi (1–3 yulduz): \daraja{2}
\newcommand\daraja[1]{\hfill{\color{dzUrgu}\foreach \dz@i in {1,...,3}{\ifnum\dz@i>#1\textcolor{dzKulrang!40}{\dz@star}\else\dz@star\fi}}}
\newenvironment{javoblar}[1][\iftutex ${titles.javoblar}\else ${pdfSafe(titles.javoblar)}\fi]
  {\par\addvspace{\baselineskip}\noindent{\dz@headfont\bfseries\color{dzUrgu}#1}\par\small\begin{multicols}{2}\begin{enumerate}[label=\textcolor{dzUrgu}{\bfseries\arabic*)}, itemsep=1pt]}
  {\end{enumerate}\end{multicols}}`);

  // Drawings
  lines.push(String.raw`
% --- Chizmalar / drawings (TikZ, pgfplots) ---------------------------------------------------
\tikzset{
  >={Stealth[round, length=2.6mm, width=2mm]},
  every picture/.append style={line cap=round, line join=round, line width=${lw}},
  dz chiziq/.style={draw=dzSiyoh, line width=${lw}},
  dz asosiy/.style={draw=dzAsosiy, line width=1.4*${lw}},
  dz urgu/.style={draw=dzUrgu, line width=1.4*${lw}},
  dz yordamchi/.style={draw=dzKulrang, dashed, line width=0.7*${lw}},
  dz soha/.style={fill=dzUrgu, fill opacity=0.14},
  dz vektor/.style={->, draw=dzAsosiy, line width=1.2*${lw}},
  dz nuqta/.style={circle, fill=dzSiyoh, inner sep=0pt, minimum size=${spec.drawings === 'playful' ? '5pt' : '4pt'}},
  dz ochiq nuqta/.style={circle, draw=dzSiyoh, fill=white, line width=0.8pt, inner sep=0pt, minimum size=5pt},
  dz katak/.style={draw=dzAsosiy!18, line width=0.4pt},${spec.drawings === 'playful' ? '\n  dz qolda/.style={decorate, decoration={random steps, segment length=6pt, amplitude=0.5pt}},' : '\n  dz qolda/.style={},'}
}
\pgfplotscreateplotcyclelist{dzranglar}{
  {dzAsosiy, line width=1.4pt},{dzUrgu, line width=1.4pt},{dzIkkinchi, line width=1.4pt},
  {dzAsosiy, dashed, line width=1.4pt},{dzUrgu, dashed, line width=1.4pt}}
\pgfplotsset{
  every axis/.append style={cycle list name=dzranglar, tick label style={font=\small}, label style={font=\small}},
  every axis plot/.append style={samples=120, line width=1.4pt},
  every axis plot no 0/.append style={dzAsosiy},
  every axis plot no 1/.append style={dzUrgu},
  every axis plot no 2/.append style={dzIkkinchi},
  every axis plot no 3/.append style={dzAsosiy, dashed},
  every axis plot no 4/.append style={dzUrgu, dashed},
  dz grafik/.style={axis lines=middle, axis line style={-{Stealth[round, length=2.4mm]}, line width=0.8pt, dzSiyoh},
    xlabel={$x$}, ylabel={$y$}, xlabel style={anchor=north east, at={(ticklabel* cs:1)}},
    ylabel style={anchor=north east, at={(ticklabel* cs:1)}},
    grid=major, major grid style={dzAsosiy!15, line width=0.4pt},
    width=0.62\linewidth, height=0.46\linewidth, enlargelimits=0.06, clip=true, clip mode=individual,
    tick style={dzSiyoh, line width=0.6pt}, axis on top=false},
}
% Koordinata tekisligi: \begin{koordinata}[xmin=-1, xmax=6] \addplot{x^2}; \end{koordinata}
\newenvironment{koordinata}[1][]{\par\begin{center}\begin{tikzpicture}\begin{axis}[dz grafik,#1]}{\end{axis}\end{tikzpicture}\end{center}}
% Erkin chizma: \begin{chizma}[scale=1] ... \end{chizma}
\newenvironment{chizma}[1][]{\par\begin{center}\begin{tikzpicture}[#1]}{\end{tikzpicture}\end{center}}
% Nuqta: \nuqta{(1,2)}{A} (nomli koordinata ham boʻladi), \nuqta[below]{(0,0)}{O}
\NewDocumentCommand\nuqta{O{above right} m m}{\coordinate (#3) at #2; \node[dz nuqta] at (#3) {}; \node[#1, inner sep=2.5pt] at (#3) {$#3$};}
% Uchburchak: \uchburchak{A}{(0,0)}{B}{(4,0)}{C}{(1,3)}
\NewDocumentCommand\uchburchak{m m m m m m}{%
  \coordinate (#1) at #2; \coordinate (#3) at #4; \coordinate (#5) at #6;
  \coordinate (dz@G) at ($1/3*(#1)+1/3*(#3)+1/3*(#5)$);
  \fill[dz soha] (#1) -- (#3) -- (#5) -- cycle;
  \draw[dz asosiy, dz qolda] (#1) -- (#3) -- (#5) -- cycle;
  \foreach \dz@p in {#1,#3,#5} {\node[dz nuqta] at (\dz@p) {}; \node at ($(\dz@p)!-3.6mm!(dz@G)$) {$\dz@p$};}}
% Burchak belgisi: \burchak{B}{A}{C}{\alpha}; toʻgʻri burchak: \togriburchak{B}{A}{C}
\NewDocumentCommand\burchak{O{6mm} m m m m}{\pic[draw=dzUrgu, line width=0.8pt, angle radius=#1, angle eccentricity=1.55, pic text={$#5$}, fill=dzUrgu, fill opacity=0.12, text opacity=1] {angle=#2--#3--#4};}
\NewDocumentCommand\togriburchak{m m m}{\pic[draw=dzUrgu, line width=0.8pt, angle radius=2.4mm] {right angle=#1--#2--#3};}
% Son oʻqi: \begin{sonoqi}{-3}{5} \sonnuqta{2}{A} \oraliq{-1}{3} \end{sonoqi}
\newenvironment{sonoqi}[3][1]{\par\begin{center}\begin{tikzpicture}[x=#1cm]
  \def\dz@min{#2}\def\dz@max{#3}
  \draw[->, dz chiziq] ({#2-0.6},0) -- ({#3+0.7},0) node[below left=2pt] {$x$};
  \foreach \dz@i in {#2,...,#3} {\draw[dzSiyoh] (\dz@i,0.09) -- (\dz@i,-0.09) node[below=2pt, font=\small] {$\dz@i$};}}
  {\end{tikzpicture}\end{center}}
\newcommand\sonnuqta[2]{\node[dz nuqta, fill=dzAsosiy, minimum size=5pt] at (#1,0) {}; \node[above=3pt, text=dzAsosiy] at (#1,0) {$#2$};}
\NewDocumentCommand\oraliq{s m m}{\draw[dzUrgu, line width=2.4pt, opacity=0.75] (#2,0) -- (#3,0);
  \IfBooleanTF{#1}{\node[dz ochiq nuqta, draw=dzUrgu] at (#2,0) {}; \node[dz ochiq nuqta, draw=dzUrgu] at (#3,0) {};}
                  {\node[dz nuqta, fill=dzUrgu] at (#2,0) {}; \node[dz nuqta, fill=dzUrgu] at (#3,0) {};}}
% Kasr doirasi: \kasrdoira{3}{8} — 8 boʻlakdan 3 tasi boʻyalgan
\NewDocumentCommand\kasrdoira{O{1} m m}{\tikz[baseline=-0.5ex, scale=#1]{%
  \foreach \dz@k in {1,...,#3} {\pgfmathsetmacro\dz@a{90-360*(\dz@k-1)/#3}\pgfmathsetmacro\dz@b{90-360*\dz@k/#3}
    \ifnum\dz@k>#2 \def\dz@f{white}\else\def\dz@f{dzUrgu!55}\fi
    \filldraw[fill=\dz@f, draw=dzSiyoh, line width=0.6pt] (0,0) -- (\dz@a:0.9) arc[start angle=\dz@a, end angle=\dz@b, radius=0.9] -- cycle;}}}
% Vektor: \vektor{(0,0)}{(2,1)}{\vec a}
\newcommand\vektor[3]{\draw[dz vektor] #1 -- #2 node[midway, above left=1pt, text=dzAsosiy] {$#3$};}
% Eyler–Venn diagrammasi: \venn{A}{B}
\newcommand\venn[2]{\begin{tikzpicture}[baseline=-0.5ex]
  \fill[dzAsosiy, fill opacity=0.18] (-0.55,0) circle (0.95); \fill[dzUrgu, fill opacity=0.18] (0.55,0) circle (0.95);
  \draw[dzAsosiy, line width=1pt] (-0.55,0) circle (0.95); \draw[dzUrgu, line width=1pt] (0.55,0) circle (0.95);
  \node[text=dzAsosiy] at (-1.05,0.95) {$#1$}; \node[text=dzUrgu] at (1.05,0.95) {$#2$};\end{tikzpicture}}
\endinput`);

  return lines.join('\n') + '\n';
}

/** Stable hash of a design's generated package (for caching previews). */
export function designHash(spec: DesignSpec, lang: DesignLanguage = 'uz-latn'): string {
  return createHash('sha256').update(generateDesignPackage(spec, lang, '')).digest('hex').slice(0, 16);
}
