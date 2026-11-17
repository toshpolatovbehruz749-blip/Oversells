/**
 * Finds common typing mistakes in a LaTeX document and proposes fixes:
 * wrong apostrophes in Uzbek words (o' g' ma'no), straight quotes, spaced
 * hyphens instead of dashes, "...", stray spaces, and in formulas function
 * names without a backslash (sin x), * for multiplication, <= >= != ->.
 *
 * Only document text is touched: the preamble, comments, command names, the
 * arguments of commands like \label or \includegraphics and verbatim-like
 * environments are skipped; formula rules apply only inside maths.
 */

import { segments } from '@oversells/shared';

export { segments };

export type FixRule =
  | 'okinaMissing' // Korsatkichli -> Koʻrsatkichli (by the dictionary, see okina-missing.ts)
  | 'okina' // o' g' -> oʻ gʻ
  | 'tutuq' // ma'no -> maʼno, ма'но -> маъно
  | 'quotes' // "so'z" -> «soʻz»
  | 'dash' // a - b -> a~--- b
  | 'ellipsis' // ... -> …
  | 'spaces' // double spaces, space before punctuation, missing space after a comma
  | 'mathFunction' // sin x -> \sin x
  | 'mathTimes' // 2*3 -> 2\cdot 3
  | 'mathRelation'; // <= -> \leq

export const FIX_RULES: FixRule[] = [
  'okinaMissing',
  'okina',
  'tutuq',
  'quotes',
  'dash',
  'ellipsis',
  'spaces',
  'mathFunction',
  'mathTimes',
  'mathRelation',
];

export interface Fix {
  rule: FixRule;
  from: number;
  to: number;
  insert: string;
}

const OKINA = 'ʻ'; // ʻ
const TUTUQ = 'ʼ'; // ʼ
/** Characters people type instead of ʻ / ʼ. */
const APOSTROPHES = new Set(["'", '‘', '’', '`', 'ʼ', 'ʻ']);
const LATIN = /[A-Za-z]/;
const CYRILLIC = /[Ѐ-ӿ]/;
const LETTER = /[A-Za-zÀ-ɏЀ-ӿʻʼ]/;

const MATH_FUNCTIONS = [
  'arcsin', 'arccos', 'arctan', 'arctg', 'arcctg', 'sinh', 'cosh', 'tanh', 'coth', 'sin', 'cos', 'tan', 'cot',
  'tg', 'ctg', 'sec', 'csc', 'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'gcd', 'deg',
];
/** Not defined by LaTeX itself (the design package defines them). */
const NONSTANDARD_FUNCTIONS = new Set(['tg', 'ctg', 'arctg', 'arcctg']);

/** All proposed fixes, in document order. */
export function findFixes(text: string): Fix[] {
  const fixes: Fix[] = [];
  const usesDesign = /\\usepackage\s*(\[[^\]]*\])?\s*\{dizayn\}|\\(newcommand|DeclareMathOperator|providecommand)\*?\s*\{?\\tg\b/.test(text);

  for (const seg of segments(text)) {
    const s = text.slice(seg.from, seg.to);
    const at = (k: number) => seg.from + k;
    if (seg.math) {
      // Function names without a backslash: sin x -> \sin x.
      const fn = new RegExp(`(^|[^A-Za-z\\\\])(${MATH_FUNCTIONS.join('|')})(?![A-Za-z])`, 'g');
      for (const m of s.matchAll(fn)) {
        const name = m[2]!;
        const start = m.index! + m[1]!.length;
        const insert = NONSTANDARD_FUNCTIONS.has(name) && !usesDesign ? `\\operatorname{${name}}` : `\\${name}`;
        // \sin2x needs a space after the command; keep "sin(x)" as is.
        const next = s[start + name.length] ?? '';
        fixes.push({ rule: 'mathFunction', from: at(start), to: at(start + name.length), insert: /[A-Za-z0-9]/.test(next) && insert.startsWith('\\') && !insert.endsWith('}') ? `${insert} ` : insert });
      }
      // A command needs a space before a following letter (\\cdot y), not before a space or digit.
      const cmd = (name: string, next: string) => (/[A-Za-z]/.test(next) ? `${name} ` : name);
      for (const m of s.matchAll(/([A-Za-z0-9)\]}])\s*\*\s*(?=[A-Za-z0-9(\\])/g)) {
        const star = m.index! + m[0].indexOf('*');
        fixes.push({ rule: 'mathTimes', from: at(star), to: at(star + 1), insert: cmd('\\cdot', s[star + 1] ?? '') });
      }
      for (const [re, name] of [
        [/<=/g, '\\leq'],
        [/>=/g, '\\geq'],
        [/!=/g, '\\neq'],
        [/->/g, '\\to'],
      ] as const) {
        for (const m of s.matchAll(re)) {
          fixes.push({ rule: 'mathRelation', from: at(m.index!), to: at(m.index! + 2), insert: cmd(name, s[m.index! + 2] ?? '') });
        }
      }
      continue;
    }

    for (let k = 0; k < s.length; k++) {
      const c = s[k]!;
      const prev = s[k - 1] ?? '';
      const next = s[k + 1] ?? '';
      if (APOSTROPHES.has(c)) {
        // `` and '' are LaTeX quotes.
        if ((c === '`' || c === "'") && (next === c || prev === c)) continue;
        // o' g' (also at the end of a word: bog', tog') are the letters oʻ gʻ.
        const okina = LATIN.test(prev) && (/[oO]/.test(prev) ? LETTER.test(next) : /[gG]/.test(prev));
        if (okina) {
          if (c !== OKINA) fixes.push({ rule: 'okina', from: at(k), to: at(k + 1), insert: OKINA });
          continue;
        }
        if (LETTER.test(prev) && LETTER.test(next)) {
          if (CYRILLIC.test(prev) || CYRILLIC.test(next)) {
            fixes.push({ rule: 'tutuq', from: at(k), to: at(k + 1), insert: 'ъ' });
          } else if (c !== TUTUQ) {
            fixes.push({ rule: 'tutuq', from: at(k), to: at(k + 1), insert: TUTUQ });
          }
        }
        continue;
      }
    }

    // Straight double quotes in pairs: "text" -> «text».
    for (const m of s.matchAll(/"([^"\n]{1,200})"/g)) {
      fixes.push({ rule: 'quotes', from: at(m.index!), to: at(m.index! + 1), insert: '«' });
      fixes.push({ rule: 'quotes', from: at(m.index! + m[0].length - 1), to: at(m.index! + m[0].length), insert: '»' });
    }
    // A hyphen between spaces is a dash; keep it on the line with the word before.
    for (const m of s.matchAll(/(\S)[ \t]+(-|--|—|–)[ \t]+(?=\S)/g)) {
      if (m[2] === '---') continue;
      const start = m.index! + m[1]!.length;
      fixes.push({ rule: 'dash', from: at(start), to: at(m.index! + m[0].length), insert: '~--- ' });
    }
    for (const m of s.matchAll(/(?<!\.)\.\.\.(?!\.)/g)) fixes.push({ rule: 'ellipsis', from: at(m.index!), to: at(m.index! + 3), insert: '…' });
    // Spaces: doubled inside a line, before punctuation, missing after a comma.
    for (const m of s.matchAll(/(\S)( {2,})(?=\S)/g)) {
      const start = m.index! + m[1]!.length;
      fixes.push({ rule: 'spaces', from: at(start), to: at(start + m[2]!.length), insert: ' ' });
    }
    for (const m of s.matchAll(/([^\s~\\])( +)([,.;:!?])(?=\s|$)/g)) {
      const start = m.index! + m[1]!.length;
      fixes.push({ rule: 'spaces', from: at(start), to: at(start + m[2]!.length), insert: '' });
    }
    // "so'z ,keyin" -> "so'z, keyin"
    for (const m of s.matchAll(/([^\s~\\])( +)([,;:])(?=[A-Za-zЀ-ӿ])/g)) {
      const start = m.index! + m[1]!.length;
      fixes.push({ rule: 'spaces', from: at(start), to: at(start + m[2]!.length + 1), insert: `${m[3]} ` });
    }
    for (const m of s.matchAll(/([A-Za-zЀ-ӿʻʼ]),(?=[A-Za-zЀ-ӿ])/g)) {
      const comma = m.index! + 1;
      fixes.push({ rule: 'spaces', from: at(comma + 1), to: at(comma + 1), insert: ' ' });
    }
  }
  // Overlapping fixes (e.g. two rules on one character): keep the first.
  fixes.sort((a, b) => a.from - b.from || a.to - b.to);
  const out: Fix[] = [];
  for (const f of fixes) {
    const last = out[out.length - 1];
    if (last && f.from < last.to) continue;
    out.push(f);
  }
  return out;
}

/** Applies fixes (non-overlapping, any order) to a text. */
export function applyFixes(text: string, fixes: Fix[]): string {
  let out = text;
  for (const f of [...fixes].sort((a, b) => b.from - a.from)) out = out.slice(0, f.from) + f.insert + out.slice(f.to);
  return out;
}
