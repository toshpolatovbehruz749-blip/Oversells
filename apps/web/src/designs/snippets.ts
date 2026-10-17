/**
 * Ready-made LaTeX pieces that use the design package (dizayn.sty): boxes,
 * key formulas, exercises and drawings. Titles are i18n keys (snippets.<id>).
 */
export interface Snippet {
  id: string;
  group: 'boxes' | 'formulas' | 'drawings';
  /** Small preview glyph shown in the menu. */
  icon: string;
  code: string;
}

export const SNIPPETS: Snippet[] = [
  // --- boxes ---------------------------------------------------------------
  {
    id: 'teorema',
    group: 'boxes',
    icon: '★',
    code: String.raw`\begin{teorema}[Nomi]
  Teorema matni.
\end{teorema}
\begin{isbot}
  Isbot.
\end{isbot}
`,
  },
  { id: 'tarif', group: 'boxes', icon: '▤', code: String.raw`\begin{tarif}
  \emph{Tushuncha} deb ... ga aytiladi.
\end{tarif}
` },
  {
    id: 'misol',
    group: 'boxes',
    icon: '✎',
    code: String.raw`\begin{misol}
  Masala sharti.
\end{misol}
\begin{yechim}
  Yechim.
\end{yechim}
`,
  },
  { id: 'eslatma', group: 'boxes', icon: 'ℹ', code: String.raw`\begin{eslatma}
  Eslatma matni.
\end{eslatma}
` },
  { id: 'diqqat', group: 'boxes', icon: '⚠', code: String.raw`\begin{diqqat}
  Keng tarqalgan xato haqida ogohlantirish.
\end{diqqat}
` },
  { id: 'bilasizmi', group: 'boxes', icon: '💡', code: String.raw`\begin{bilasizmi}
  Qiziqarli maʼlumot.
\end{bilasizmi}
` },
  { id: 'tarix', group: 'boxes', icon: '📜', code: String.raw`\begin{tarix}
  Tarixiy maʼlumot.
\end{tarix}
` },
  // --- formulas and exercises ------------------------------------------------
  { id: 'muhim', group: 'formulas', icon: '▣', code: String.raw`\muhim[Formula nomi]{a^2 + b^2 = c^2}
` },
  {
    id: 'mashqlar',
    group: 'formulas',
    icon: '①',
    code: String.raw`\begin{mashqlar}
  \item $x^2 - 5x + 6 = 0$ tenglamani yeching. \daraja{1}
  \item $\displaystyle\int_0^1 x^2\,dx$ ni hisoblang. \daraja{2}
  \item Isbotlang: $\sqrt{2}$ — irratsional son. \daraja{3}
\end{mashqlar}
`,
  },
  { id: 'javoblar', group: 'formulas', icon: '✓', code: String.raw`\begin{javoblar}
  \item $x_1 = 2$, $x_2 = 3$.
  \item $\frac13$.
\end{javoblar}
` },
  {
    id: 'tizim',
    group: 'formulas',
    icon: '{',
    code: String.raw`\[
  \begin{cases}
    2x + y = 7, \\
    x - y = -1
  \end{cases}
  \qquad\Longrightarrow\qquad
  \begin{cases}
    x = 2, \\
    y = 3.
  \end{cases}
\]
`,
  },
  {
    id: 'jadval',
    group: 'formulas',
    icon: '▦',
    code: String.raw`\begin{center}
  \renewcommand{\arraystretch}{1.4}
  \begin{tabular}{|c|c|c|c|c|c|}
    \hline
    \textcolor{dzAsosiy}{$x$} & $-2$ & $-1$ & $0$ & $1$ & $2$ \\ \hline
    $y = x^2$ & $4$ & $1$ & $0$ & $1$ & $4$ \\ \hline
  \end{tabular}
\end{center}
`,
  },
  // --- drawings --------------------------------------------------------------
  {
    id: 'grafik',
    group: 'drawings',
    icon: '∿',
    code: String.raw`\begin{koordinata}[xmin=-3, xmax=3, ymin=-1, ymax=5]
  \addplot[domain=-2.2:2.2] {x^2};
  \addplot[domain=-3:3] {x + 1};
\end{koordinata}
`,
  },
  {
    id: 'trig',
    group: 'drawings',
    icon: '〰',
    code: String.raw`\begin{koordinata}[xmin=-0.3, xmax=6.6, ymin=-1.4, ymax=1.4, xtick={0,1.5708,3.1416,4.7124,6.2832},
    xticklabels={$0$,$\frac{\pi}{2}$,$\pi$,$\frac{3\pi}{2}$,$2\pi$}, width=0.8\linewidth, height=0.36\linewidth]
  \addplot[domain=0:2*pi] {sin(deg(x))};
  \addplot[domain=0:2*pi] {cos(deg(x))};
\end{koordinata}
`,
  },
  {
    id: 'uchburchak',
    group: 'drawings',
    icon: '△',
    code: String.raw`\begin{chizma}
  \uchburchak{A}{(0,0)}{B}{(5,0)}{C}{(1.6,3)}
  \burchak{B}{A}{C}{\alpha}
  \burchak{C}{B}{A}{\beta}
  \burchak{A}{C}{B}{\gamma}
\end{chizma}
`,
  },
  {
    id: 'pifagor',
    group: 'drawings',
    icon: '◺',
    code: String.raw`\begin{chizma}
  \uchburchak{A}{(0,0)}{B}{(4,0)}{C}{(0,3)}
  \togriburchak{B}{A}{C}
  \node[below] at ($(A)!0.5!(B)$) {$b$};
  \node[left] at ($(A)!0.5!(C)$) {$a$};
  \node[above right] at ($(B)!0.5!(C)$) {$c$};
\end{chizma}
`,
  },
  {
    id: 'aylana',
    group: 'drawings',
    icon: '◯',
    code: String.raw`\begin{chizma}
  \fill[dz soha] (0,0) circle (2);
  \draw[dz asosiy] (0,0) circle (2);
  \nuqta[below left]{(0,0)}{O}
  \nuqta[right]{(2,0)}{A}
  \draw[dz urgu] (O) -- (A) node[midway, above] {$r$};
  \draw[dz yordamchi] (-2,0) -- (O);
\end{chizma}
`,
  },
  {
    id: 'sonoqi',
    group: 'drawings',
    icon: '↔',
    code: String.raw`\begin{sonoqi}{-4}{4}
  \oraliq*{-2}{3}
  \sonnuqta{0}{O}
\end{sonoqi}
`,
  },
  {
    id: 'kasr',
    group: 'drawings',
    icon: '◔',
    code: String.raw`\begin{center}
  \kasrdoira{1}{2}\ $=\dfrac12$ \qquad \kasrdoira{2}{4}\ $=\dfrac24$ \qquad \kasrdoira{4}{8}\ $=\dfrac48$
\end{center}
`,
  },
  { id: 'venn', group: 'drawings', icon: '⦶', code: String.raw`\begin{center}
  \venn{A}{B} \qquad $A \cap B$
\end{center}
` },
  {
    id: 'vektor',
    group: 'drawings',
    icon: '→',
    code: String.raw`\begin{chizma}
  \draw[dz katak] (-0.5,-0.5) grid (4.5,3.5);
  \vektor{(0,0)}{(3,1)}{\vec a}
  \vektor{(0,0)}{(1,3)}{\vec b}
  \draw[dz urgu, ->] (0,0) -- (4,4) node[above] {$\vec a + \vec b$};
  \draw[dz yordamchi] (3,1) -- (4,4) -- (1,3);
\end{chizma}
`,
  },
  {
    id: 'katak',
    group: 'drawings',
    icon: '▦',
    code: String.raw`\begin{chizma}[scale=0.5]
  \draw[dz katak] (-6,-6) grid (6,6);
  \draw[->, dz chiziq] (-6.4,0) -- (6.6,0) node[right] {$x$};
  \draw[->, dz chiziq] (0,-6.4) -- (0,6.6) node[above] {$y$};
  \node[below left, font=\scriptsize] at (0,0) {$0$};
\end{chizma}
`,
  },
];
