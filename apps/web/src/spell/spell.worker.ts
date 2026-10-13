/// <reference lib="webworker" />
import nspell from 'nspell';
import type { Dictionary } from '@oversells/shared';
import { normalizeUzbekLatin } from './tokenize';

/**
 * Spell-check worker: loads Hunspell dictionaries on demand (from /dict/) and
 * answers "which of these words are wrong?" and "suggestions for this word".
 * Words the user added to their dictionary are accepted in every language.
 */

export type WorkerRequest =
  | { id: number; type: 'check'; words: Array<{ word: string; dict: Dictionary }> }
  | { id: number; type: 'suggest'; word: string; dict: Dictionary }
  | { id: number; type: 'setUserWords'; words: string[] };

export type WorkerResponse =
  | { id: number; type: 'check'; misspelled: string[] }
  | { id: number; type: 'suggest'; suggestions: string[] }
  | { id: number; type: 'ok' }
  | { id: number; type: 'error'; message: string };

const spellers = new Map<Dictionary, Promise<ReturnType<typeof nspell>>>();
let userWords = new Set<string>();

function speller(dict: Dictionary) {
  let s = spellers.get(dict);
  if (!s) {
    s = Promise.all([fetch(`/dict/${dict}.aff`), fetch(`/dict/${dict}.dic`)]).then(async ([aff, dic]) => {
      if (!aff.ok || !dic.ok) throw new Error(`Dictionary ${dict} is not available`);
      return nspell({ aff: await aff.text(), dic: await dic.text() });
    });
    s.catch(() => spellers.delete(dict));
    spellers.set(dict, s);
  }
  return s;
}

/** Spelling variants to try: as written, Uzbek apostrophes normalised, and lower-cased first letter. */
function variants(word: string, dict: Dictionary): string[] {
  const base = dict === 'uz-latn' ? normalizeUzbekLatin(word) : word;
  const out = [word, base];
  const lower = base[0]!.toLowerCase() + base.slice(1);
  if (lower !== base) out.push(lower);
  if (base === base.toUpperCase()) out.push(base.toLowerCase(), base[0] + base.slice(1).toLowerCase());
  return [...new Set(out)];
}

async function isCorrect(word: string, dict: Dictionary): Promise<boolean> {
  const forms = variants(word, dict);
  if (forms.some((w) => userWords.has(w) || userWords.has(w.toLowerCase()))) return true;
  const s = await speller(dict);
  return forms.some((w) => s.correct(w));
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'setUserWords') {
      userWords = new Set(req.words);
      self.postMessage({ id: req.id, type: 'ok' } satisfies WorkerResponse);
    } else if (req.type === 'check') {
      const misspelled: string[] = [];
      for (const { word, dict } of req.words) if (!(await isCorrect(word, dict))) misspelled.push(word);
      self.postMessage({ id: req.id, type: 'check', misspelled } satisfies WorkerResponse);
    } else {
      const s = await speller(req.dict);
      const word = req.dict === 'uz-latn' ? normalizeUzbekLatin(req.word) : req.word;
      self.postMessage({ id: req.id, type: 'suggest', suggestions: s.suggest(word).slice(0, 7) } satisfies WorkerResponse);
    }
  } catch (err) {
    self.postMessage({ id: req.id, type: 'error', message: (err as Error).message } satisfies WorkerResponse);
  }
};
