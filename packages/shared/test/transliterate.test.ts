import { describe, expect, it } from 'vitest';
import {
  babelForScript,
  cyrillicToLatin,
  latinToCyrillic,
  latinToYangi,
  transliterateLatex,
  yangiToLatin,
} from '../src/transliterate.js';

const pairs: Array<[string, string]> = [
  ['Oʻzbekiston', 'Ўзбекистон'],
  ['toʻgʻri', 'тўғри'],
  ['shahar choʻl', 'шаҳар чўл'],
  ['SHAHAR', 'ШАҲАР'],
  ['Shahar', 'Шаҳар'],
  ['maʼno sanʼat', 'маъно санъат'],
  ['yer yoz yulduz yangi', 'ер ёз юлдуз янги'],
  ['ertak poema', 'эртак поэма'],
  ['kitob qishloq xalq', 'китоб қишлоқ халқ'],
  ['dengiz tenglama', 'денгиз тенглама'],
  ['Isʼhoq', 'Исҳоқ'],
  ['ayol', 'аёл'],
];

describe('Uzbek Latin <-> Cyrillic', () => {
  it.each(pairs)('%s <-> %s', (latn, cyrl) => {
    expect(latinToCyrillic(latn)).toBe(cyrl);
    expect(cyrillicToLatin(cyrl)).toBe(latn);
  });

  it('accepts typed apostrophes and handles ц and ь', () => {
    expect(latinToCyrillic("O'zbek g'alaba ma'no")).toBe('Ўзбек ғалаба маъно');
    expect(cyrillicToLatin('цирк милиция')).toBe('sirk militsiya');
    expect(cyrillicToLatin('компьютер')).toBe('kompyuter');
    expect(cyrillicToLatin('Ёшлар ЮРТИ')).toBe('Yoshlar YURTI');
  });

  it('changes only the prose of a LaTeX file', () => {
    const tex = String.raw`\documentclass{article}
\usepackage{babel}
\babelprovide[import=uz-Latn, main]{uzbek}
\title{Oʻzbek tili}
\date{\today}
\begin{document}
\section{Kirish} Matn $x^2 + y = 0$ va \ref{sec:kirish}.
\begin{tabular}{cc} bir & ikki \end{tabular}
% izoh qoladi
\end{document}`;
    const cyr = transliterateLatex(tex, 'cyrl');
    expect(cyr).toContain('\\title{Ўзбек тили}');
    expect(cyr).toContain('\\date{\\today}');
    expect(cyr).toContain('\\section{Кириш} Матн $x^2 + y = 0$ ва \\ref{sec:kirish}.');
    expect(cyr).toContain('бир & икки');
    expect(cyr).toContain('% izoh qoladi');
    expect(cyr).toContain('\\usepackage{babel}');
    expect(transliterateLatex(cyr, 'latn')).toBe(tex.replace('% izoh qoladi', '% izoh qoladi'));
    expect(babelForScript(tex, 'cyrl')).toContain('\\babelprovide[import=uz-Cyrl, main]{uzbek}');
    expect(babelForScript('\\babelprovide[import=uz-Cyrl]{uzbekcyr}', 'latn')).toBe('\\babelprovide[import=uz-Cyrl]{uzbekcyr}');
  });
});

describe('formulas and code inside commands', () => {
  it('keeps \\muhim formulas and \\texttt code, converts the title', () => {
    const tex = '\\begin{document}\n\\muhim[Nyuton formulasi]{F(b) - F(a)} va \\texttt{amsmath} paketi.\n\\end{document}';
    const cyr = transliterateLatex(tex, 'cyrl');
    expect(cyr).toContain('\\muhim[Нютон формуласи]{F(b) - F(a)} ва \\texttt{amsmath} пакети.');
  });
});

describe('the new letters Ö Ğ Ş Ç', () => {
  const pairs: Array<[string, string]> = [
    ['Oʻzbekiston', 'Özbekiston'],
    ['toʻgʻri shahar choʻl', 'töğri şahar çöl'],
    ['SHAHAR CHOʻL', 'ŞAHAR ÇÖL'],
    ['Shahar Choʻl Gʻalaba', 'Şahar Çöl Ğalaba'],
    ['maʼno Isʼhoq', 'maʼno Isʼhoq'],
    ['mashq yechish', 'maşq yeçiş'],
  ];
  it.each(pairs)('%s <-> %s', (latn, yangi) => {
    expect(latinToYangi(latn)).toBe(yangi);
    expect(yangiToLatin(yangi)).toBe(latn);
  });

  it('accepts typed apostrophes but not a closing quote', () => {
    expect(latinToYangi("o'g'il to‘g‘ri")).toBe('öğil töğri');
    expect(latinToYangi("``Salom''")).toBe("``Salom''");
    expect(latinToYangi("``Yo''")).toBe("``Yo''");
  });

  it('goes to Cyrillic and back', () => {
    expect(latinToCyrillic('Özbek şahar çöl töğri')).toBe('Ўзбек шаҳар чўл тўғри');
    expect(transliterateLatex('\\begin{document}\nЎзбек шаҳар\n\\end{document}', 'yangi')).toContain('Özbek şahar');
  });

  it('changes only prose, also the text of TikZ nodes', () => {
    const tex = String.raw`\documentclass{article}
\usepackage{tikz}
\begin{document}
\section{Mashqlar} Choʻntak $x$ va \includegraphics{kichik_shakl.pdf}.
\begin{tikzpicture}
 \fill[shade] (0,0) circle (1); % node izohi {shu}
 \node[font=\bfseries,text=ink] (a) at (1,2) {Shoshma, \textbf{choʻl} $x$!};
 \draw (0,0) -- (1,1) node[above] {Chiziq};
 \node at (0,0) {\includegraphics[height=1cm]{kichik.pdf}};
\end{tikzpicture}
\end{document}`;
    const out = transliterateLatex(tex, 'yangi');
    expect(out).toContain('\\section{Maşqlar} Çöntak $x$ va \\includegraphics{kichik_shakl.pdf}.');
    expect(out).toContain('\\node[font=\\bfseries,text=ink] (a) at (1,2) {Şoşma, \\textbf{çöl} $x$!};');
    expect(out).toContain('node[above] {Çiziq}');
    expect(out).toContain('\\fill[shade] (0,0) circle (1); % node izohi {shu}');
    expect(out).toContain('{\\includegraphics[height=1cm]{kichik.pdf}}');
    expect(transliterateLatex(out, 'latn')).toBe(tex);
  });
});

describe('document bounds', () => {
  it('ignores \\begin{document} and \\end{document} written in comments', () => {
    const tex = '% rasmlar \\end{document} dan keyin saqlangan\n\\begin{document}\nShahar\n\\end{document}\n%%B64 shu';
    expect(transliterateLatex(tex, 'yangi')).toBe(tex.replace('Shahar', 'Şahar'));
  });
});

describe('TikZ code in prose', () => {
  it('keeps option lists but converts \\item labels', () => {
    const tex = String.raw`\begin{document}
\foreach \i in {7,8}{\draw[ink,dashed] (0,0) node[anchor=north] {Shar};}
\joy{1}{0}\node[font=\bfseries,anchor=north] at (1,2) {Choy};
\begin{scope}[shift={(0,1)}]\fill[shade] (0,0) circle (1);\end{scope}
\item[Shart] Mashq
\end{document}`;
    const out = transliterateLatex(tex, 'yangi');
    expect(out).toContain('\\draw[ink,dashed] (0,0) node[anchor=north] {Şar};');
    expect(out).toContain('\\node[font=\\bfseries,anchor=north] at (1,2) {Çoy};');
    expect(out).toContain('\\begin{scope}[shift={(0,1)}]\\fill[shade] (0,0) circle (1);');
    expect(out).toContain('\\item[Şart] Maşq');
  });
});
