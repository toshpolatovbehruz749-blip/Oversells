import { RAW_ENVS, segments } from './latex-text.js';

/**
 * Uzbek Latin <-> Cyrillic by the rules of the two official alphabets.
 *
 * Latin -> Cyrillic: sh ш, ch ч, oʻ ў, gʻ ғ, ʼ ъ, yo ё, yu ю, ya я, ye е,
 * e at the start of a word or after a vowel э, other e е, h ҳ, x х, q қ,
 * j ж, y й. s'h (Isʼhoq) is с + ҳ.
 * Cyrillic -> Latin: е at the start of a word or after a vowel, ъ or ь is
 * ye, ц after a vowel ts and s elsewhere, ь disappears, ъ ʼ, ы i, э e,
 * сҳ sʼh (so it is not read as sh).
 */

export type Script = 'latn' | 'cyrl';

const OKINA = 'ʻ';
const TUTUQ = 'ʼ';
/** What people type for ʻ and ʼ. */
const MARKS = "'‘’`ʻʼ";

const LAT_VOWELS = 'aeiouAEIOU';
const CYR_VOWELS = 'аеёиоуўэюяАЕЁИОУЎЭЮЯ';

const isUpper = (c: string) => c !== c.toLowerCase();
const isLetter = (c: string | undefined) => !!c && /[A-Za-zЀ-ӿʻʼ]/.test(c);

/** A digraph's case from its first letter and the letter after it (Sh, SH). */
function caseLike(out: string, first: string, next: string | undefined): string {
  if (!isUpper(first)) return out;
  if (next && isLetter(next) && isUpper(next)) return out.toUpperCase();
  return out[0]!.toUpperCase() + out.slice(1);
}

const LAT_SINGLE: Record<string, string> = {
  a: 'а', b: 'б', d: 'д', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о',
  p: 'п', q: 'қ', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', x: 'х', y: 'й', z: 'з', c: 'с', w: 'в',
};

export function latinToCyrillic(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const lc = c.toLowerCase();
    const n = text[i + 1];
    const nl = n?.toLowerCase();
    const after = text[i + 2];
    const up = (cyr: string) => (isUpper(c) ? cyr.toUpperCase() : cyr);
    // oʻ, gʻ (with any typed apostrophe)
    if ((lc === 'o' || lc === 'g') && n && MARKS.includes(n) && n !== TUTUQ) {
      out += up(lc === 'o' ? 'ў' : 'ғ');
      i++;
      continue;
    }
    if (lc === 's' && nl === 'h') {
      out += up('ш');
      i++;
      continue;
    }
    if (lc === 'c' && nl === 'h') {
      out += up('ч');
      i++;
      continue;
    }
    // sʼh: s and h written apart.
    if (lc === 's' && n && MARKS.includes(n) && after?.toLowerCase() === 'h') {
      out += up('с') + (isUpper(after) ? 'Ҳ' : 'ҳ');
      i += 2;
      continue;
    }
    if (lc === 'y' && nl && 'oaue'.includes(nl)) {
      const cyr = { o: 'ё', u: 'ю', a: 'я', e: 'е' }[nl]!;
      out += isUpper(c) ? cyr.toUpperCase() : cyr;
      i++;
      continue;
    }
    if (lc === 'e') {
      const prev = text[i - 1];
      const start = !isLetter(prev) || (prev && LAT_VOWELS.includes(prev));
      out += up(start ? 'э' : 'е');
      continue;
    }
    if (MARKS.includes(c) && isLetter(text[i - 1]) && isLetter(n)) {
      out += 'ъ';
      continue;
    }
    const single = LAT_SINGLE[lc];
    out += single ? up(single) : c;
  }
  return out;
}

const CYR_SINGLE: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', қ: 'q', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ҳ: 'h', ы: 'i', э: 'e',
};
const CYR_MULTI: Record<string, string> = {
  ў: `o${OKINA}`, ғ: `g${OKINA}`, ш: 'sh', ч: 'ch', ё: 'yo', ю: 'yu', я: 'ya', щ: 'sh',
};

export function cyrillicToLatin(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const lc = c.toLowerCase();
    const prev = text[i - 1];
    const next = text[i + 1];
    if (lc === 'е') {
      const ye = !isLetter(prev) || (prev && (CYR_VOWELS.includes(prev) || 'ъьЪЬ'.includes(prev)));
      out += ye ? caseLike('ye', c, next) : isUpper(c) ? 'E' : 'e';
      continue;
    }
    if (lc === 'ц') {
      const ts = prev && CYR_VOWELS.includes(prev);
      out += ts ? caseLike('ts', c, next) : isUpper(c) ? 'S' : 's';
      continue;
    }
    if (lc === 'ь') continue;
    if (lc === 'ъ') {
      out += TUTUQ;
      continue;
    }
    // сҳ -> sʼh, so that it is not read as sh.
    if (lc === 'с' && next?.toLowerCase() === 'ҳ') {
      out += (isUpper(c) ? 'S' : 's') + TUTUQ;
      continue;
    }
    const multi = CYR_MULTI[lc];
    if (multi) {
      // oʻ/gʻ: only the letter takes the case.
      out += multi.includes(OKINA) ? (isUpper(c) ? multi[0]!.toUpperCase() + OKINA : multi) : caseLike(multi, c, next);
      continue;
    }
    const single = CYR_SINGLE[lc];
    out += single ? (isUpper(c) ? single.toUpperCase() : single) : c;
  }
  return out;
}

/** Changes the script of a LaTeX file: only prose and \title/\author/\date in the preamble. */
export function transliterateLatex(text: string, to: Script): string {
  const convert = to === 'cyrl' ? latinToCyrillic : cyrillicToLatin;
  // Tables are prose here (their cells are text).
  const raw = new Set([...RAW_ENVS].filter((e) => e !== 'tabular'));
  const parts = segments(text, { rawEnvs: raw }).filter((s) => !s.math);
  // Title data in the preamble.
  const begin = text.indexOf('\\begin{document}');
  if (begin !== -1) {
    for (const m of text.slice(0, begin).matchAll(/\\(title|author|date|subtitle)\s*\{/g)) {
      const open = m.index! + m[0].length - 1;
      let depth = 0;
      for (let i = open; i < begin; i++) {
        if (text[i] === '\\') {
          i++;
          continue;
        }
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) {
          parts.push({ from: open + 1, to: i, math: false });
          break;
        }
      }
    }
  }
  // Commands and inline maths inside an argument (\date{\today}) stay as they are.
  const prose = (s: string) =>
    s
      .split(/(\\[A-Za-z@]+\*?|\$[^$]*\$)/)
      .map((piece, i) => (i % 2 ? piece : convert(piece)))
      .join('');
  let out = text;
  for (const p of parts.sort((a, b) => b.from - a.from)) {
    out = out.slice(0, p.from) + prose(text.slice(p.from, p.to)) + out.slice(p.to);
  }
  return out;
}

/** babel setup of a main file for the script: the main language takes uz-Latn or uz-Cyrl. */
export function babelForScript(text: string, to: Script): string {
  return text.replace(/\\babelprovide\[([^\]]*)\]/g, (all, opts: string) =>
    /\bmain\b/.test(opts) ? `\\babelprovide[${opts.replace(/uz-(Latn|Cyrl)/, to === 'cyrl' ? 'uz-Cyrl' : 'uz-Latn')}]` : all,
  );
}
