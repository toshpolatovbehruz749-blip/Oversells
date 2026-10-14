import { describe, expect, it } from 'vitest';
import { babelForScript, cyrillicToLatin, latinToCyrillic, transliterateLatex } from '../src/transliterate.js';

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
