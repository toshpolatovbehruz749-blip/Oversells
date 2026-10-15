/** Excerpt of a book design (mathpro.sty) whose chapters open with \\bob. */
export const MATHPRO = String.raw`\documentclass[11pt,twoside,openright]{book}
\makeatletter
% Excerpt of a book design (mathpro.sty) whose chapters open with \bob.
\newcounter{bob}
\newcounter{mavzu}[bob]
\newcommand\sahifasarlavha[1]{\clearpage\thispagestyle{oddiy}\mp@sahifasarlavha{#1}}
\NewDocumentCommand\bob{O{bobQizil} m m g}{%
  \cleardoublepage
  \colorlet{mpAccent}{#1}%
  \refstepcounter{bob}%
  \addcontentsline{toc}{chapter}{\protect\textcolor{#1}{\ikkixona{bob}}\quad #2}%
  \clearpage}
\NewDocumentCommand\mavzu{m}{%
  \clearpage
  \refstepcounter{mavzu}%
  \addcontentsline{toc}{section}{\protect\numberline{\arabic{bob}.\arabic{mavzu}}#1}}
\newcommand\muqova{%
  \thispagestyle{bosh}
  \clearpage}
\makeatother
\begin{document}
\frontmatter
\muqova
\sahifasarlavha{Muqaddima}
Hurmatli oʻquvchi va ustozlar!
\mainmatter
\bob[bobQizil]{Sonlar}{Natural sonlar.}
\mavzu{Natural sonlar}
\bob[bobFiruza]{Koʻrsatkichli va logarifmik funksiyalar}{Daraja va logarifm xossalari.}
\mavzu{Koʻrsatkichli funksiya. Koʻrsatkichli tenglamalar}
\savol[javob=B,daraja=1]{$2^x=8$ tenglamani yeching.}
\end{document}
`;
