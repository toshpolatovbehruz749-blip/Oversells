import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { Dictionary, SpellLanguage } from '@oversells/shared';
import type { SpellClient } from './client';
import { dictionaryFor } from './dictionaries';
import { scriptOf, tokenize } from './tokenize';

export interface SpellMenuRequest {
  x: number;
  y: number;
  word: string;
  from: number;
  to: number;
  dict: Dictionary;
}

const setErrors = StateEffect.define<Array<{ from: number; to: number; word: string; dict: Dictionary }>>();

const errorsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrors)) {
        deco = Decoration.set(
          e.value.map((r) =>
            Decoration.mark({
              class: 'cm-spell-error',
              attributes: { 'data-word': r.word, 'data-dict': r.dict },
            }).range(r.from, r.to),
          ),
          true,
        );
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const CHECK_DELAY_MS = 400;
const MAX_CHECKED_CHARS = 400_000;

/**
 * Underlines misspelled words (checked in a web worker) and opens a
 * suggestions menu on right-click.
 */
export function spellcheck(client: SpellClient, language: SpellLanguage, onMenu: (r: SpellMenuRequest) => void): Extension {
  if (language === 'off') return [];

  const plugin = ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      private readonly onChange = () => this.schedule();

      constructor(private readonly view: EditorView) {
        client.addEventListener('change', this.onChange);
        this.schedule();
      }

      update(u: ViewUpdate) {
        if (u.docChanged) this.schedule();
      }

      schedule() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.run(), CHECK_DELAY_MS);
      }

      async run() {
        const doc = this.view.state.doc;
        const text = doc.sliceString(0, Math.min(doc.length, MAX_CHECKED_CHARS));
        const tokens = tokenize(text).flatMap((t) => {
          const dict = dictionaryFor(language, scriptOf(t.word));
          return dict ? [{ ...t, dict }] : [];
        });
        const unique = new Map(tokens.map((t) => [`${t.dict}\u0000${t.word}`, { word: t.word, dict: t.dict }]));
        let wrong: Set<string>;
        try {
          wrong = await client.check([...unique.values()]);
        } catch {
          return; // dictionary not available: no underlines
        }
        // Ignore stale results; a newer check is scheduled.
        if (this.view.state.doc !== doc) return;
        const errors = tokens.filter((t) => wrong.has(t.word)).map((t) => ({ from: t.from, to: t.to, word: t.word, dict: t.dict }));
        this.view.dispatch({ effects: setErrors.of(errors) });
      }

      destroy() {
        if (this.timer) clearTimeout(this.timer);
        client.removeEventListener('change', this.onChange);
      }
    },
  );

  return [
    errorsField,
    plugin,
    EditorView.domEventHandlers({
      contextmenu(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        let hit: SpellMenuRequest | null = null;
        view.state.field(errorsField).between(pos, pos, (from, to, deco) => {
          const attrs = (deco.spec as { attributes?: Record<string, string> }).attributes ?? {};
          hit = { x: event.clientX, y: event.clientY, word: attrs['data-word']!, from, to, dict: attrs['data-dict'] as Dictionary };
        });
        if (!hit) return false;
        event.preventDefault();
        onMenu(hit);
        return true;
      },
    }),
  ];
}
