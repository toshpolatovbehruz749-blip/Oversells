/**
 * Uzbek words typed without their ʻ: Korsatkichli -> Koʻrsatkichli,
 * togri -> toʻgʻri, sozlar -> soʻzlar.
 *
 * The Uzbek dictionary is a list of words without affixes, so a word is
 * judged by its longest beginning that is a dictionary word: "korsatkichli"
 * has none worth the name, "koʻrsatkichli" begins with "koʻrsatkich". A word
 * gets ʻ after some of its o / g when that makes it a dictionary word, or
 * makes a dictionary word of most of it (at least 4 letters and 60 %), longer
 * than the original word allows, with every added ʻ inside that beginning.
 */

const OKINA = 'ʻ';
const APOSTROPHE = /['`‘’ʻʼ]/;
const MAX_SPOTS = 5;

/** Where ʻ could be missing: after o followed by a letter, after g followed by a letter or at the end. */
function spots(lower: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < lower.length; i++) {
    const next = lower[i + 1];
    if (lower[i] === 'o' && next && /[a-z]/.test(next)) out.push(i);
    else if (lower[i] === 'g' && (!next || /[a-z]/.test(next))) out.push(i);
  }
  return out;
}

/** The word with ʻ restored, keeping its letters' case, or null when nothing is missing. */
export function restoreOkina(word: string, isWord: (lower: string) => boolean): string | null {
  if (APOSTROPHE.test(word) || !/^[A-Za-z]+$/.test(word)) return null;
  const lower = word.toLowerCase();
  if (lower.length < 3 || isWord(lower)) return null;
  const where = spots(lower);
  if (where.length === 0 || where.length > MAX_SPOTS) return null;

  const longest = (s: string) => {
    for (let n = s.length; n >= 3; n--) if (isWord(s.slice(0, n))) return n;
    return 0;
  };
  const base = longest(lower);
  const need = Math.max(4, Math.ceil(lower.length * 0.6));

  let best: { positions: number[]; letters: number } | null = null;
  for (let mask = 1; mask < 1 << where.length; mask++) {
    const positions = where.filter((_, k) => mask & (1 << k));
    // The variant and where its ʻ are.
    let variant = '';
    const okinaAt: number[] = [];
    for (let i = 0; i < lower.length; i++) {
      variant += lower[i];
      if (positions.includes(i)) {
        okinaAt.push(variant.length);
        variant += OKINA;
      }
    }
    let letters: number;
    if (isWord(variant)) letters = lower.length;
    else {
      const n = longest(variant);
      if (n === 0 || okinaAt.some((p) => p >= n)) continue;
      letters = n - okinaAt.length;
      if (letters < need || letters <= base) continue;
    }
    // More letters explained wins; on a tie, fewer added ʻ.
    if (!best || letters > best.letters || (letters === best.letters && positions.length < best.positions.length)) {
      best = { positions, letters };
    }
  }
  if (!best) return null;
  let out = '';
  for (let i = 0; i < word.length; i++) out += word[i] + (best.positions.includes(i) ? OKINA : '');
  return out;
}

/** Latin words of a text with their offsets (apostrophes kept, so o'qish is one word). */
export function latinWords(text: string, from = 0, to = text.length): Array<{ word: string; at: number }> {
  const out: Array<{ word: string; at: number }> = [];
  const re = /[A-Za-z'`‘’ʻʼ]+/g;
  re.lastIndex = from;
  for (let m = re.exec(text); m && m.index < to; m = re.exec(text)) {
    // Not a command name (\section), not part of x2 or a@b.
    if (text[m.index - 1] === '\\' || /[A-Za-z0-9@]/.test(text[m.index - 1] ?? '') || /[0-9@]/.test(text[m.index + m[0].length] ?? '')) continue;
    out.push({ word: m[0], at: m.index });
  }
  return out;
}
