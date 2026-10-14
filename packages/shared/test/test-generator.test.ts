import { describe, expect, it } from 'vitest';
import { generateTest, parseBank } from '../src/test-generator.js';

const BANK = String.raw`
\begin{savol}
  $2+3\cdot 4$ ni hisoblang.
  \togri{$14$}
  \variant{$20$}
  \variant{$24$}
  \variant{$9$}
\end{savol}
% \begin{savol} izohdagi savol hisoblanmaydi \end{savol}
\begin{savol}
  Toʻgʻri javobni toping: $\frac{1}{2}+\frac{1}{3}$
  \variant{$\frac{2}{5}$}
  \togri{$\frac{5}{6}$}
  \variant{$\frac{1}{6}$}
\end{savol}
\begin{savol}
  Javobsiz savol.
  \variant{a}
  \variant{b}
\end{savol}
`;

const opts = { title: 'Algebra 8-sinf', variants: 4, shuffleQuestions: true, shuffleOptions: true, answerSheet: true, answerKey: true, seed: 42, design: false };

describe('test generator', () => {
  it('reads questions with their answers and reports broken ones', () => {
    const { questions, problems } = parseBank(BANK);
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({ text: '$2+3\\cdot 4$ ni hisoblang.', line: 2 });
    expect(questions[0]!.options).toEqual([
      { text: '$14$', correct: true },
      { text: '$20$', correct: false },
      { text: '$24$', correct: false },
      { text: '$9$', correct: false },
    ]);
    expect(questions[1]!.options[1]).toEqual({ text: '$\\frac{5}{6}$', correct: true });
    expect(problems).toEqual([{ line: 16, code: 'no_correct' }]);
  });

  it('makes reproducible variants whose key points at the right answers', () => {
    const { questions } = parseBank(BANK);
    const a = generateTest(questions, opts);
    expect(generateTest(questions, opts)).toEqual(a);
    expect(a.key).toHaveLength(4);
    // Every variant: each right answer appears under the letter the key names.
    const blocks = a.tex.split('\\testvariant{').slice(1);
    blocks.forEach((block, v) => {
      const qs = block.split('\\testsavol{').slice(1);
      expect(qs).toHaveLength(2);
      qs.forEach((q, i) => {
        const letter = a.key[v]![i]!;
        const answer = new RegExp(`\\\\testjavob\\{${letter}\\}\\{([^\\n]*)\\}%`).exec(q)![1]!;
        expect(['$14$', '$\\frac{5}{6}$']).toContain(answer);
      });
    });
    // Another seed shuffles differently.
    expect(generateTest(questions, { ...opts, seed: 7 }).tex).not.toBe(a.tex);
    expect(a.tex).toContain('\\testjavobvaraqasi{Algebra 8-sinf}');
    expect(a.tex).toContain('\\testkalit{Algebra 8-sinf}');
    expect(a.tex).toContain('\\begin{tabular}{|c|c|c|}');
  });

  it('keeps the order without shuffling and escapes the title', () => {
    const { questions } = parseBank(BANK);
    const t = generateTest(questions, { ...opts, variants: 1, shuffleQuestions: false, shuffleOptions: false, title: '50% & #1' });
    expect(t.key).toEqual([['A', 'B']]);
    expect(t.tex).toContain('\\testvariant{50\\% \\& \\#1}{A}');
  });
});
