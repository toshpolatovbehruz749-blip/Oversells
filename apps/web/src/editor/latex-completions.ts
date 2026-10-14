import { snippet, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { SNIPPETS } from '../designs/snippets';

/**
 * LaTeX completions with ready-made code: commands with their arguments as
 * tab stops (\frac{}{} -> Tab between numerator and denominator), whole
 * environments, ~40 ready formulas found by their Uzbek names (pifagor, viet,
 * diskriminant...), Greek letters and symbols, and the design package's boxes.
 *
 * Templates use CodeMirror's snippet syntax: #{name} is a field, #{} an empty
 * one; a literal \{ or \} in LaTeX is written \\{ and \\} here.
 */

type Kind = 'math' | 'text' | 'env' | 'formula' | 'symbol' | 'design';

export interface LatexItem {
  /** Command with backslash (\frac) or environment name for \begin{...}. */
  label: string;
  template: string;
  /** Short Uzbek description. */
  detail: string;
  /** Uzbek words that find the item (typed after \ or, in formulas, alone). */
  aliases?: string[];
  kind: Kind;
}

const r = String.raw;

const MATH: LatexItem[] = [
  { label: r`\frac`, template: r`\frac{#{num}}{#{den}}`, detail: 'kasr', aliases: ['kasr'], kind: 'math' },
  { label: r`\dfrac`, template: r`\dfrac{#{num}}{#{den}}`, detail: 'katta kasr', aliases: ['kasr'], kind: 'math' },
  { label: r`\sqrt`, template: r`\sqrt{#{}}`, detail: 'kvadrat ildiz', aliases: ['ildiz'], kind: 'math' },
  { label: r`\sqrt[n]`, template: r`\sqrt[#{n}]{#{}}`, detail: 'n-darajali ildiz', aliases: ['ildiz'], kind: 'math' },
  { label: r`\sum`, template: r`\sum_{#{i}=1}^{#{n}} #{}`, detail: 'yigʻindi', aliases: ['yigindi'], kind: 'math' },
  { label: r`\prod`, template: r`\prod_{#{i}=1}^{#{n}} #{}`, detail: 'koʻpaytma', aliases: ['kopaytma'], kind: 'math' },
  { label: r`\int`, template: r`\int_{#{a}}^{#{b}} #{f(x)}\,d#{x}`, detail: 'aniq integral', aliases: ['integral'], kind: 'math' },
  { label: r`\int dx`, template: r`\int #{f(x)}\,d#{x}`, detail: 'aniqmas integral', aliases: ['integral', 'aniqmas'], kind: 'math' },
  { label: r`\iint`, template: r`\iint_{#{D}} #{f(x,y)}\,dx\,dy`, detail: 'ikki karrali integral', aliases: ['integral'], kind: 'math' },
  { label: r`\oint`, template: r`\oint_{#{C}} #{}`, detail: 'yopiq kontur boʻyicha integral', aliases: ['integral'], kind: 'math' },
  { label: r`\lim`, template: r`\lim_{#{x} \to #{a}} #{}`, detail: 'limit', aliases: ['limit'], kind: 'math' },
  { label: r`\lim n`, template: r`\lim_{n \to \infty} #{}`, detail: 'ketma-ketlik limiti', aliases: ['limit'], kind: 'math' },
  { label: r`\frac{d}{dx}`, template: r`\frac{d#{}}{d#{x}}`, detail: 'hosila', aliases: ['hosila'], kind: 'math' },
  { label: r`\partial`, template: r`\frac{\partial #{f}}{\partial #{x}}`, detail: 'xususiy hosila', aliases: ['hosila', 'xususiy'], kind: 'math' },
  { label: r`\left(`, template: r`\left( #{} \right)`, detail: 'moslashuvchan qavslar ( )', aliases: ['qavs'], kind: 'math' },
  { label: r`\left[`, template: r`\left[ #{} \right]`, detail: 'moslashuvchan qavslar [ ]', aliases: ['qavs'], kind: 'math' },
  { label: r`\left\{`, template: r`\left\\{ #{} \right\\}`, detail: 'moslashuvchan qavslar { }', aliases: ['qavs', 'figurali'], kind: 'math' },
  { label: r`\left|`, template: r`\left| #{} \right|`, detail: 'modul', aliases: ['modul', 'absolyut'], kind: 'math' },
  { label: r`\binom`, template: r`\binom{#{n}}{#{k}}`, detail: 'binomial koeffitsiyent', aliases: ['binom', 'kombinatsiya'], kind: 'math' },
  { label: r`\vec`, template: r`\vec{#{a}}`, detail: 'vektor', aliases: ['vektor'], kind: 'math' },
  { label: r`\overrightarrow`, template: r`\overrightarrow{#{AB}}`, detail: 'vektor AB', aliases: ['vektor'], kind: 'math' },
  { label: r`\overline`, template: r`\overline{#{}}`, detail: 'ustiga chiziq', aliases: ['chiziq'], kind: 'math' },
  { label: r`\hat`, template: r`\hat{#{}}`, detail: 'qalpoqcha', kind: 'math' },
  { label: r`\bar`, template: r`\bar{#{}}`, detail: 'ustiga qisqa chiziq', kind: 'math' },
  { label: r`\tilde`, template: r`\tilde{#{}}`, detail: 'tilda', kind: 'math' },
  { label: r`\log`, template: r`\log_{#{a}} #{}`, detail: 'logarifm', aliases: ['logarifm'], kind: 'math' },
  { label: r`\ln`, template: r`\ln #{}`, detail: 'natural logarifm', aliases: ['logarifm'], kind: 'math' },
  { label: r`\lg`, template: r`\lg #{}`, detail: 'oʻnli logarifm', aliases: ['logarifm'], kind: 'math' },
  { label: r`\sin`, template: r`\sin #{}`, detail: 'sinus', aliases: ['sinus'], kind: 'math' },
  { label: r`\cos`, template: r`\cos #{}`, detail: 'kosinus', aliases: ['kosinus'], kind: 'math' },
  { label: r`\tg`, template: r`\tg #{}`, detail: 'tangens (dizayn paketi)', aliases: ['tangens'], kind: 'math' },
  { label: r`\ctg`, template: r`\ctg #{}`, detail: 'kotangens (dizayn paketi)', aliases: ['kotangens'], kind: 'math' },
  { label: r`\tan`, template: r`\tan #{}`, detail: 'tangens (xalqaro)', aliases: ['tangens'], kind: 'math' },
  { label: r`\arcsin`, template: r`\arcsin #{}`, detail: 'arksinus', kind: 'math' },
  { label: r`\arccos`, template: r`\arccos #{}`, detail: 'arkkosinus', kind: 'math' },
  { label: r`\arctg`, template: r`\arctg #{}`, detail: 'arktangens (dizayn paketi)', kind: 'math' },
  { label: r`\max`, template: r`\max_{#{}} #{}`, detail: 'maksimum', kind: 'math' },
  { label: r`\min`, template: r`\min_{#{}} #{}`, detail: 'minimum', kind: 'math' },
  { label: r`\text`, template: r`\text{#{}}`, detail: 'formula ichida matn', aliases: ['matn'], kind: 'math' },
  { label: r`\mathbb`, template: r`\mathbb{#{R}}`, detail: 'toʻplam harfi (ℝ, ℕ, ℤ)', aliases: ['toplam'], kind: 'math' },
  { label: r`\mathrm`, template: r`\mathrm{#{}}`, detail: 'tik harflar', kind: 'math' },
  { label: r`^\circ`, template: r`^{\circ}`, detail: 'gradus (30°)', aliases: ['gradus'], kind: 'math' },
  { label: r`\cases`, template: r`\begin{cases}⏎  #{} & #{}, \\⏎  #{} & #{}.⏎\end{cases}`, detail: 'tenglamalar tizimi', aliases: ['tizim', 'sistema'], kind: 'math' },
  { label: r`\pmatrix`, template: r`\begin{pmatrix}⏎  #{a} & #{b} \\⏎  #{c} & #{d}⏎\end{pmatrix}`, detail: 'matritsa ( )', aliases: ['matritsa'], kind: 'math' },
  { label: r`\bmatrix`, template: r`\begin{bmatrix}⏎  #{a} & #{b} \\⏎  #{c} & #{d}⏎\end{bmatrix}`, detail: 'matritsa [ ]', aliases: ['matritsa'], kind: 'math' },
  { label: r`\vmatrix`, template: r`\begin{vmatrix}⏎  #{a} & #{b} \\⏎  #{c} & #{d}⏎\end{vmatrix}`, detail: 'determinant', aliases: ['determinant'], kind: 'math' },
  { label: r`\aligned`, template: r`\begin{aligned}⏎  #{} &= #{} \\⏎  &= #{}⏎\end{aligned}`, detail: 'bir necha qator (tekislangan)', aliases: ['qatorlar'], kind: 'math' },
];

/** name, symbol, Uzbek description, aliases */
const SYMBOLS: Array<[string, string, string, string[]?]> = [
  ['infty', '∞', 'cheksizlik', ['cheksiz']],
  ['pm', '±', 'plyus-minus'],
  ['mp', '∓', 'minus-plyus'],
  ['cdot', '·', 'koʻpaytirish nuqtasi', ['kopaytirish']],
  ['times', '×', 'koʻpaytirish xochi', ['kopaytirish']],
  ['div', '÷', 'boʻlish'],
  ['leq', '≤', 'kichik yoki teng', ['kichik']],
  ['geq', '≥', 'katta yoki teng', ['katta']],
  ['neq', '≠', 'teng emas'],
  ['approx', '≈', 'taxminan teng', ['taxminan']],
  ['equiv', '≡', 'aynan teng'],
  ['sim', '∼', 'oʻxshash'],
  ['in', '∈', 'tegishli'],
  ['notin', '∉', 'tegishli emas'],
  ['subset', '⊂', 'qism toʻplam'],
  ['subseteq', '⊆', 'qism toʻplam yoki teng'],
  ['cup', '∪', 'birlashma', ['birlashma']],
  ['cap', '∩', 'kesishma', ['kesishma']],
  ['emptyset', '∅', 'boʻsh toʻplam', ['bosh']],
  ['forall', '∀', 'har qanday'],
  ['exists', '∃', 'mavjud'],
  ['Rightarrow', '⇒', 'kelib chiqadi'],
  ['Leftrightarrow', '⇔', 'teng kuchli'],
  ['to', '→', 'intiladi'],
  ['mapsto', '↦', 'akslantiradi'],
  ['angle', '∠', 'burchak', ['burchak']],
  ['triangle', '△', 'uchburchak', ['uchburchak']],
  ['perp', '⊥', 'perpendikulyar', ['perpendikulyar']],
  ['parallel', '∥', 'parallel', ['parallel']],
  ['cdots', '⋯', 'koʻp nuqta (oʻrtada)'],
  ['ldots', '…', 'koʻp nuqta'],
  ['partial', '∂', 'xususiy hosila belgisi'],
  ['nabla', '∇', 'nabla'],
  ['circ', '∘', 'kompozitsiya / gradus'],
  ['ne', '≠', 'teng emas'],
];

const GREEK = [
  ['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ'], ['delta', 'δ'], ['varepsilon', 'ε'], ['epsilon', 'ϵ'], ['zeta', 'ζ'],
  ['eta', 'η'], ['theta', 'θ'], ['varphi', 'φ'], ['phi', 'ϕ'], ['iota', 'ι'], ['kappa', 'κ'], ['lambda', 'λ'], ['mu', 'μ'],
  ['nu', 'ν'], ['xi', 'ξ'], ['pi', 'π'], ['rho', 'ρ'], ['sigma', 'σ'], ['tau', 'τ'], ['upsilon', 'υ'], ['chi', 'χ'],
  ['psi', 'ψ'], ['omega', 'ω'], ['Gamma', 'Γ'], ['Delta', 'Δ'], ['Theta', 'Θ'], ['Lambda', 'Λ'], ['Xi', 'Ξ'], ['Pi', 'Π'],
  ['Sigma', 'Σ'], ['Phi', 'Φ'], ['Psi', 'Ψ'], ['Omega', 'Ω'],
];

/** Ready formulas, found by their Uzbek names. */
const FORMULAS: Array<[string, string, string[]]> = [
  ['Kvadrat tenglama ildizlari', r`x_{1,2}=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`, ['kvadrat', 'ildizlar', 'tenglama']],
  ['Diskriminant', r`D=b^2-4ac`, ['diskriminant']],
  ['Viyet teoremasi', r`x_1+x_2=-\frac{b}{a},\qquad x_1x_2=\frac{c}{a}`, ['viyet', 'viet']],
  ['Pifagor teoremasi', r`a^2+b^2=c^2`, ['pifagor']],
  ['Yigʻindining kvadrati', r`(a+b)^2=a^2+2ab+b^2`, ['qisqa', 'kvadrat', 'yigindi']],
  ['Ayirmaning kvadrati', r`(a-b)^2=a^2-2ab+b^2`, ['qisqa', 'kvadrat', 'ayirma']],
  ['Kvadratlar ayirmasi', r`a^2-b^2=(a-b)(a+b)`, ['qisqa', 'kvadratlar']],
  ['Yigʻindining kubi', r`(a+b)^3=a^3+3a^2b+3ab^2+b^3`, ['qisqa', 'kub']],
  ['Kublar yigʻindisi', r`a^3+b^3=(a+b)(a^2-ab+b^2)`, ['qisqa', 'kublar']],
  ['Asosiy trigonometrik ayniyat', r`\sin^2\alpha+\cos^2\alpha=1`, ['trigonometrik', 'ayniyat', 'sinus']],
  ['Ikki burchak sinusi', r`\sin 2\alpha=2\sin\alpha\cos\alpha`, ['ikki', 'burchak', 'sinus']],
  ['Ikki burchak kosinusi', r`\cos 2\alpha=\cos^2\alpha-\sin^2\alpha`, ['ikki', 'burchak', 'kosinus']],
  ['Yigʻindi sinusi', r`\sin(\alpha+\beta)=\sin\alpha\cos\beta+\cos\alpha\sin\beta`, ['qoshish', 'sinus']],
  ['Sinuslar teoremasi', r`\frac{a}{\sin\alpha}=\frac{b}{\sin\beta}=\frac{c}{\sin\gamma}=2R`, ['sinuslar', 'teorema']],
  ['Kosinuslar teoremasi', r`c^2=a^2+b^2-2ab\cos\gamma`, ['kosinuslar', 'teorema']],
  ['Uchburchak yuzi', r`S=\frac{1}{2}ah_a=\frac{1}{2}ab\sin\gamma`, ['uchburchak', 'yuza']],
  ['Geron formulasi', r`S=\sqrt{p(p-a)(p-b)(p-c)},\qquad p=\frac{a+b+c}{2}`, ['geron', 'yuza']],
  ['Doira yuzi va aylana uzunligi', r`S=\pi r^2,\qquad C=2\pi r`, ['doira', 'aylana', 'yuza']],
  ['Arifmetik progressiya', r`a_n=a_1+(n-1)d,\qquad S_n=\frac{(a_1+a_n)\,n}{2}`, ['arifmetik', 'progressiya']],
  ['Geometrik progressiya', r`b_n=b_1q^{n-1},\qquad S_n=\frac{b_1(1-q^n)}{1-q}`, ['geometrik', 'progressiya']],
  ['Cheksiz kamayuvchi geometrik progressiya', r`S=\frac{b_1}{1-q},\qquad |q|<1`, ['geometrik', 'cheksiz']],
  ['Logarifm xossalari', r`\log_a(xy)=\log_a x+\log_a y,\qquad \log_a\frac{x}{y}=\log_a x-\log_a y`, ['logarifm', 'xossa']],
  ['Logarifmning yangi asosga oʻtish', r`\log_a b=\frac{\log_c b}{\log_c a}`, ['logarifm', 'asos']],
  ['Hosilaning taʼrifi', r`f'(x)=\lim_{\Delta x\to 0}\frac{f(x+\Delta x)-f(x)}{\Delta x}`, ['hosila', 'tarif']],
  ['Koʻpaytmaning hosilasi', r`(uv)'=u'v+uv'`, ['hosila', 'kopaytma']],
  ['Boʻlinmaning hosilasi', r`\left(\frac{u}{v}\right)'=\frac{u'v-uv'}{v^2}`, ['hosila', 'bolinma']],
  ['Murakkab funksiya hosilasi', r`\bigl(f(g(x))\bigr)'=f'(g(x))\,g'(x)`, ['hosila', 'murakkab']],
  ['Nyuton–Leybnis formulasi', r`\int_a^b f(x)\,dx=F(b)-F(a)`, ['nyuton', 'leybnis', 'integral']],
  ['Birinchi ajoyib limit', r`\lim_{x\to 0}\frac{\sin x}{x}=1`, ['ajoyib', 'limit']],
  ['Ikkinchi ajoyib limit', r`\lim_{n\to\infty}\left(1+\frac{1}{n}\right)^n=e`, ['ajoyib', 'limit']],
  ['Teylor qatori', r`f(x)=\sum_{k=0}^{\infty}\frac{f^{(k)}(a)}{k!}(x-a)^k`, ['teylor', 'qator']],
  ['Nyuton binomi', r`(a+b)^n=\sum_{k=0}^{n}\binom{n}{k}a^{n-k}b^k`, ['binom', 'nyuton']],
  ['Ikki nuqta orasidagi masofa', r`d=\sqrt{(x_2-x_1)^2+(y_2-y_1)^2}`, ['masofa']],
  ['Toʻgʻri chiziq tenglamasi', r`y=kx+b`, ['togri', 'chiziq']],
  ['Aylana tenglamasi', r`(x-a)^2+(y-b)^2=R^2`, ['aylana', 'tenglama']],
  ['Kombinatsiyalar soni', r`C_n^k=\frac{n!}{k!\,(n-k)!}`, ['kombinatsiya']],
  ['Oʻrinlashtirishlar soni', r`A_n^k=\frac{n!}{(n-k)!}`, ['orinlashtirish']],
  ['Ehtimollik', r`P(A)=\frac{m}{n}`, ['ehtimollik']],
  ['Moduli taʼrifi', r`|x|=\begin{cases} x, & x\ge 0,\\ -x, & x<0.\end{cases}`, ['modul']],
];

const TEXT: LatexItem[] = [
  { label: r`\section`, template: r`\section{#{}}`, detail: 'boʻlim', aliases: ['bolim'], kind: 'text' },
  { label: r`\subsection`, template: r`\subsection{#{}}`, detail: 'kichik boʻlim', aliases: ['bolim'], kind: 'text' },
  { label: r`\subsubsection`, template: r`\subsubsection{#{}}`, detail: 'band', kind: 'text' },
  { label: r`\chapter`, template: r`\chapter{#{}}`, detail: 'bob', aliases: ['bob'], kind: 'text' },
  { label: r`\paragraph`, template: r`\paragraph{#{}}`, detail: 'paragraf sarlavhasi', kind: 'text' },
  { label: r`\textbf`, template: r`\textbf{#{}}`, detail: 'qalin', aliases: ['qalin'], kind: 'text' },
  { label: r`\textit`, template: r`\textit{#{}}`, detail: 'kursiv', aliases: ['kursiv'], kind: 'text' },
  { label: r`\emph`, template: r`\emph{#{}}`, detail: 'urgʻu', kind: 'text' },
  { label: r`\underline`, template: r`\underline{#{}}`, detail: 'tagiga chizish', kind: 'text' },
  { label: r`\texttt`, template: r`\texttt{#{}}`, detail: 'mashinka shrifti', kind: 'text' },
  { label: r`\footnote`, template: r`\footnote{#{}}`, detail: 'sahifa ostidagi izoh', aliases: ['izoh'], kind: 'text' },
  { label: r`\label`, template: r`\label{#{}}`, detail: 'belgi (havola uchun)', kind: 'text' },
  { label: r`\ref`, template: r`\ref{#{}}`, detail: 'havola', aliases: ['havola'], kind: 'text' },
  { label: r`\eqref`, template: r`\eqref{#{}}`, detail: 'formulaga havola', aliases: ['havola'], kind: 'text' },
  { label: r`\cite`, template: r`\cite{#{}}`, detail: 'adabiyotga havola', kind: 'text' },
  { label: r`\url`, template: r`\url{#{}}`, detail: 'veb-manzil', kind: 'text' },
  { label: r`\href`, template: r`\href{#{url}}{#{matn}}`, detail: 'havola matni bilan', kind: 'text' },
  { label: r`\includegraphics`, template: r`\includegraphics[width=0.8\linewidth]{#{rasm}}`, detail: 'rasm qoʻyish', aliases: ['rasm'], kind: 'text' },
  { label: r`\input`, template: r`\input{#{}}`, detail: 'faylni qoʻshish', kind: 'text' },
  { label: r`\include`, template: r`\include{#{}}`, detail: 'bobni qoʻshish (yangi sahifadan)', kind: 'text' },
  { label: r`\item`, template: r`\item #{}`, detail: 'roʻyxat bandi', kind: 'text' },
  { label: r`\usepackage`, template: r`\usepackage{#{}}`, detail: 'paket', kind: 'text' },
  { label: r`\newpage`, template: r`\newpage`, detail: 'yangi sahifa', kind: 'text' },
  { label: r`\tableofcontents`, template: r`\tableofcontents`, detail: 'mundarija', aliases: ['mundarija'], kind: 'text' },
  { label: r`\maketitle`, template: r`\maketitle`, detail: 'sarlavha sahifasi', kind: 'text' },
  { label: r`\foreignlanguage`, template: r`\foreignlanguage{uzbekcyr}{#{}}`, detail: 'kirill matn', aliases: ['kirill'], kind: 'text' },
  { label: r`\[`, template: r`\[⏎  #{}⏎\]`, detail: 'alohida qatordagi formula', aliases: ['formula'], kind: 'text' },
];

/** Environments for \begin{...}: name, body template, Uzbek description, aliases. */
const ENVS: Array<[string, string, string, string[]?]> = [
  ['equation', '#{}', 'raqamlangan formula', ['formula']],
  ['equation*', '#{}', 'raqamsiz formula', ['formula']],
  ['align', '#{} &= #{} \\\\\n  &= #{}', 'tekislangan formulalar', ['formulalar']],
  ['align*', '#{} &= #{} \\\\\n  &= #{}', 'tekislangan formulalar (raqamsiz)', ['formulalar']],
  ['gather', '#{} \\\\\n  #{}', 'markazlangan formulalar'],
  ['itemize', '\\item #{}\n  \\item #{}', 'belgili roʻyxat', ['royxat']],
  ['enumerate', '\\item #{}\n  \\item #{}', 'raqamli roʻyxat', ['royxat']],
  ['figure', '\\centering\n  \\includegraphics[width=0.7\\linewidth]{#{rasm}}\n  \\caption{#{}}\n  \\label{fig:#{}}', 'rasm (sarlavhasi bilan)', ['rasm']],
  ['table', '\\centering\n  \\caption{#{}}\n  \\begin{tabular}{|c|c|}\n    \\hline\n    #{} & #{} \\\\ \\hline\n  \\end{tabular}', 'jadval', ['jadval']],
  ['tabular', '{|c|c|c|}\n  \\hline\n  #{} & #{} & #{} \\\\ \\hline', 'jadval (oddiy)', ['jadval']],
  ['center', '#{}', 'markazlash'],
  ['minipage', '{0.48\\linewidth}\n  #{}', 'kichik sahifa (ustunlar)'],
  ['tikzpicture', '#{}', 'TikZ chizmasi', ['chizma']],
  ['otherlanguage', '{uzbekcyr}\n  #{}', 'kirill yozuvidagi matn', ['kirill']],
  ['proof', '#{}', 'isbot (amsthm)'],
  ['abstract', '#{}', 'annotatsiya'],
  ['quote', '#{}', 'iqtibos'],
  ['verbatim', '#{}', 'kodni oʻzgarishsiz chiqarish'],
];

function design(): LatexItem[] {
  const names: Record<string, string> = {
    teorema: 'teorema', tarif: 'taʼrif', misol: 'misol va yechim', eslatma: 'eslatma', diqqat: 'diqqat', bilasizmi: 'bilasizmi?',
    tarix: 'tarixiy maʼlumot', muhim: 'muhim formula (ramkada)', mashqlar: 'mashqlar', javoblar: 'javoblar', grafik: 'funksiya grafigi',
    trig: 'sinus va kosinus grafigi', uchburchak: 'uchburchak chizmasi', pifagor: 'toʻgʻri burchakli uchburchak', aylana: 'aylana',
    sonoqi: 'son oʻqi', kasr: 'kasr doiralari', venn: 'Venn diagrammasi', vektor: 'vektorlar', katak: 'katakli koordinata tekisligi',
    tizim: 'tenglamalar tizimi', jadval: 'qiymatlar jadvali',
  };
  return SNIPPETS.map((s) => ({
    label: `\\${s.id}`,
    template: s.code.replace(/\\([{}])/g, '\\\\$1').replace(/\n$/, '') + '#{}',
    detail: `${names[s.id] ?? s.id} (dizayn)`,
    aliases: [s.id],
    kind: 'design' as const,
  }));
}

const ascii = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ʻʼ'‘’`]/g, '')
    .replace(/–/g, '-');

const lines = (items: LatexItem[]) => items.map((i) => ({ ...i, template: i.template.replace(/⏎/g, '\n') }));

export const ITEMS: LatexItem[] = [
  ...lines(MATH),
  ...SYMBOLS.map(([name, sym, detail, aliases]) => ({ label: `\\${name}`, template: `\\${name}`, detail: `${sym}  ${detail}`, aliases, kind: 'symbol' as const })),
  ...GREEK.map(([name, sym]) => ({ label: `\\${name}`, template: `\\${name}`, detail: `${sym}  yunon harfi`, kind: 'symbol' as const })),
  ...FORMULAS.map(([title, tex, aliases]) => ({ label: title, template: tex.replace(/\\([{}])/g, '\\\\$1'), detail: tex, aliases, kind: 'formula' as const })),
  ...lines(TEXT),
  ...design(),
];

const BOOST: Record<Kind, number> = { math: 0, symbol: -5, formula: -10, text: 0, env: 0, design: -5 };

/** Is `pos` inside a formula? A heuristic over the text before it. */
export function inMath(text: string, pos: number): boolean {
  const from = Math.max(0, pos - 4000);
  const s = text.slice(from, pos);
  let math = false;
  let close = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '%' && s[i - 1] !== '\\') {
      const nl = s.indexOf('\n', i);
      if (nl === -1) break;
      i = nl;
      continue;
    }
    if (c === '\\') {
      const m = /^\\(begin|end)\{(equation|align|gather|multline|flalign|eqnarray|math|displaymath)\*?\}/.exec(s.slice(i, i + 30));
      if (m) {
        math = m[1] === 'begin';
        close = '';
        i += m[0].length - 1;
        continue;
      }
      const n = s[i + 1];
      if (!math && (n === '[' || n === '(')) {
        math = true;
        close = n === '[' ? '\\]' : '\\)';
      } else if (math && close && s.startsWith(close, i)) {
        math = false;
        close = '';
      }
      i++;
      continue;
    }
    if (c === '$') {
      const double = s[i + 1] === '$';
      if (!math) {
        math = true;
        close = double ? '$$' : '$';
      } else if (close === '$' || close === '$$') {
        math = false;
        close = '';
      }
      if (double) i++;
    }
  }
  return math;
}

/** Applies a template; swallows a "}" that closeBrackets put after the cursor. */
function applyTemplate(template: string, eatBrace: boolean) {
  const apply = snippet(template);
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    const extra = eatBrace && view.state.sliceDoc(to, to + 1) === '}' ? 1 : 0;
    apply(view, completion, from, to + extra);
  };
}

function option(item: LatexItem, label: string, math: boolean): Completion {
  const wrongPlace = (item.kind === 'math' || item.kind === 'symbol' || item.kind === 'formula') && !math;
  return {
    label,
    detail: item.kind === 'formula' ? '' : item.detail,
    info: item.kind === 'formula' ? item.detail : undefined,
    displayLabel: label === item.label ? undefined : `${label} → ${item.label}`,
    type: item.kind === 'symbol' ? 'constant' : item.kind === 'formula' ? 'text' : item.kind === 'env' ? 'type' : 'function',
    boost: BOOST[item.kind] - (wrongPlace ? 20 : 0) + (item.kind === 'text' && math ? -20 : 0),
    apply: applyTemplate(item.template, false),
  };
}

export function latexCompletions(ctx: CompletionContext): CompletionResult | null {
  const text = ctx.state.doc.toString();
  const math = inMath(text, ctx.pos);

  // \begin{... and \end{...
  const env = ctx.matchBefore(/\\(begin|end)\{[\w*]*/);
  if (env) {
    const brace = env.from + env.text.indexOf('{') + 1;
    const isBegin = env.text.startsWith('\\begin');
    const all = [...ENVS.map(([name, , detail]) => [name, detail] as const), ...SNIPPETS.filter((s) => s.code.startsWith('\\begin{')).map((s) => [/^\\begin\{([^}]+)\}/.exec(s.code)![1]!, `${s.id} (dizayn)`] as const)];
    return {
      from: brace,
      options: all.map(([name, detail]) => {
        const body = ENVS.find((e) => e[0] === name)?.[1] ?? '${}';
        const template = isBegin ? `${name}}\n  ${body}\n\\end{${name}}` : `${name}}`;
        return { label: name, detail, type: 'type', apply: applyTemplate(template, true) };
      }),
      validFor: /^[\w*]*$/,
    };
  }

  // \command (also found by Uzbek words: \kasr -> \frac{}{})
  const cmd = ctx.matchBefore(/\\[A-Za-z]*/);
  if (cmd && (cmd.from !== cmd.to || ctx.explicit)) {
    const options: Completion[] = [];
    for (const item of ITEMS) {
      if (item.label.startsWith('\\')) options.push(option(item, item.label, math));
      for (const a of item.aliases ?? []) if (`\\${ascii(a)}` !== item.label) options.push(option(item, `\\${ascii(a)}`, math));
    }
    for (const [name, , detail, aliases] of ENVS) {
      const item: LatexItem = { label: `\\begin{${name}}`, template: `\\begin{${name}}\n  ${ENVS.find((e) => e[0] === name)![1]}\n\\end{${name}}`, detail, kind: 'env' };
      options.push(option(item, item.label, math));
      for (const a of aliases ?? []) options.push(option(item, `\\${ascii(a)}`, math));
    }
    return { from: cmd.from, options, validFor: /^\\[A-Za-z]*$/ };
  }

  // In formulas, plain words find ready formulas and commands: "pifagor", "kasr".
  if (math) {
    const word = ctx.matchBefore(/[A-Za-zʻʼ']{3,}/);
    if (!word && !ctx.explicit) return null;
    const options: Completion[] = [];
    for (const item of ITEMS) {
      if (item.kind === 'text' || item.kind === 'design') continue;
      for (const a of item.aliases ?? []) options.push(option(item, ascii(a), true));
    }
    return { from: word?.from ?? ctx.pos, options, validFor: /^[A-Za-zʻʼ']*$/ };
  }
  return null;
}
