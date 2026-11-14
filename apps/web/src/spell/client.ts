import type { Dictionary } from '@oversells/shared';
import type { WorkerRequest, WorkerResponse } from './spell.worker';

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void };
type Req = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

/**
 * Talks to the spell-check worker. Results are cached per dictionary and word;
 * listeners are told when the user dictionary changes so editors re-check.
 */
export class SpellClient extends EventTarget {
  private readonly worker = new Worker(new URL('./spell.worker.ts', import.meta.url), { type: 'module' });
  private readonly pending = new Map<number, Pending>();
  private readonly cache = new Map<string, boolean>();
  private nextId = 1;
  private ignored = new Set<string>();

  constructor() {
    super();
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.type === 'error') p.reject(new Error(e.data.message));
      else p.resolve(e.data);
    };
  }

  private send(req: Req): Promise<WorkerResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...req, id } as WorkerRequest);
    });
  }

  /** Returns the misspelled words among `words` (each with its dictionary). */
  async check(words: Array<{ word: string; dict: Dictionary }>): Promise<Set<string>> {
    const wrong = new Set<string>();
    const unknown: Array<{ word: string; dict: Dictionary }> = [];
    for (const w of words) {
      if (this.ignored.has(w.word)) continue;
      const cached = this.cache.get(`${w.dict}\u0000${w.word}`);
      if (cached === false) wrong.add(w.word);
      else if (cached === undefined) unknown.push(w);
    }
    if (unknown.length) {
      const res = await this.send({ type: 'check', words: unknown });
      const misspelled = new Set(res.type === 'check' ? res.misspelled : []);
      for (const w of unknown) {
        const ok = !misspelled.has(w.word);
        this.cache.set(`${w.dict}\u0000${w.word}`, ok);
        if (!ok) wrong.add(w.word);
      }
    }
    return wrong;
  }

  async suggest(word: string, dict: Dictionary): Promise<string[]> {
    const res = await this.send({ type: 'suggest', word, dict });
    return res.type === 'suggest' ? res.suggestions : [];
  }

  /** Uzbek Latin words typed without their ʻ, with the ʻ put back (Korsatkichli -> Koʻrsatkichli). */
  async restoreOkina(words: string[]): Promise<Record<string, string>> {
    const res = await this.send({ type: 'okina', words });
    return res.type === 'okina' ? res.fixes : {};
  }

  /** Personal dictionary words (accepted in every language). */
  async setUserWords(words: string[]): Promise<void> {
    await this.send({ type: 'setUserWords', words });
    this.cache.clear();
    this.dispatchEvent(new Event('change'));
  }

  /** Ignores a word until the page is reloaded. */
  ignore(word: string): void {
    this.ignored.add(word);
    this.dispatchEvent(new Event('change'));
  }

  destroy(): void {
    this.worker.terminate();
  }
}
