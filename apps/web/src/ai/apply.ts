/** Helpers that turn AI answers into small edits of the collaborative text. */

/**
 * Offset of `original` in `text`, expected to start at `startLine` (1-based).
 * Falls back to a unique occurrence elsewhere (lines were added above it);
 * null when the text no longer contains it unambiguously.
 */
export function locateExcerpt(text: string, startLine: number, original: string): number | null {
  let at = 0;
  for (let line = 1; line < startLine && at !== -1; line++) {
    at = text.indexOf('\n', at);
    if (at !== -1) at++;
  }
  if (at !== -1 && text.startsWith(original, at)) return at;
  const first = text.indexOf(original);
  if (first === -1 || text.indexOf(original, first + 1) !== -1) return null;
  return first;
}

export interface TextEdit {
  at: number;
  remove: number;
  insert: string;
}

/** The smallest single edit that turns `a` into `b` (common prefix and suffix kept). */
export function minimalEdit(a: string, b: string): TextEdit {
  let pre = 0;
  const max = Math.min(a.length, b.length);
  while (pre < max && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < max - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  return { at: pre, remove: a.length - pre - suf, insert: b.slice(pre, b.length - suf) };
}

/** Insertion of preamble lines right before \begin{document}; null without one. */
export function preambleInsertion(text: string, lines: string[]): TextEdit | null {
  const missing = lines.filter((l) => !text.includes(l));
  if (missing.length === 0) return null;
  const at = text.search(/^[ \t]*\\begin\{document\}/m);
  if (at === -1) return null;
  return { at, remove: 0, insert: `${missing.join('\n')}\n` };
}
