import { diffChars } from 'diff';
import type * as Y from 'yjs';

/** Name of the Y.Text holding a file's content (the web client uses the same). */
export const TEXT_NAME = 'content';

/** Above this size a single replace of the changed middle is used instead of a character diff. */
const MAX_DIFF_CHARS = 200_000;

/**
 * Turns `ytext` into `next` with minimal edits, so that unchanged text (and
 * comment anchors and remote cursors in it) is preserved. Runs in one
 * transaction with the given origin. Returns false when nothing changed.
 */
export function applyText(ytext: Y.Text, next: string, origin: unknown = null): boolean {
  const prev = ytext.toString();
  if (prev === next) return false;
  const doc = ytext.doc!;
  doc.transact(() => {
    if (prev.length + next.length > MAX_DIFF_CHARS) {
      replaceMiddle(ytext, prev, next);
      return;
    }
    let index = 0;
    for (const part of diffChars(prev, next)) {
      if (part.added) {
        ytext.insert(index, part.value);
        index += part.value.length;
      } else if (part.removed) {
        ytext.delete(index, part.value.length);
      } else {
        index += part.value.length;
      }
    }
  }, origin);
  return true;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** Replaces only the part between the common prefix and suffix. */
function replaceMiddle(ytext: Y.Text, prev: string, next: string): void {
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
  // Never split a surrogate pair.
  if (start > 0 && isHighSurrogate(prev.charCodeAt(start - 1))) start--;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  if (endPrev < prev.length && isHighSurrogate(prev.charCodeAt(endPrev - 1))) {
    endPrev++;
    endNext++;
  }
  if (endPrev > start) ytext.delete(start, endPrev - start);
  if (endNext > start) ytext.insert(start, next.slice(start, endNext));
}
