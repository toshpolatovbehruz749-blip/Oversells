import { isPicture } from '../images/prepare';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  type DecorationSet,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import {
  StreamLanguage,
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import type { FileSession } from '../collab/session';
import type { SpellLanguage } from '@oversells/shared';
import type { SpellClient } from '../spell/client';
import { spellcheck, type SpellMenuRequest } from '../spell/extension';
import { latexCompletions } from '../editor/latex-completions';

export interface CodeEditorHandle {
  /** Moves the cursor to the given 1-based line and focuses the editor. */
  gotoLine(line: number): void;
  /** Selects and shows a character range. */
  showRange(from: number, to: number): void;
  /** Current main selection. */
  selection(): { from: number; to: number };
  /** 1-based line of the cursor. */
  cursorLine(): number;
  /** Replaces [from, to) if it still contains `expected`; returns false otherwise. */
  replaceRange(from: number, to: number, text: string, expected?: string): boolean;
  /** Inserts text at the cursor (replacing the selection). */
  insertAtCursor(text: string): void;
  /** Applies non-overlapping edits in one step if the text is still `expected`. */
  applyEdits(edits: { from: number; to: number; insert: string }[], expected: string): boolean;
  /** The whole document text. */
  text(): string;
}

/** A comment range to highlight. */
export interface CommentRange {
  id: string;
  from: number;
  to: number;
  active: boolean;
}

interface Props {
  /** The collaboratively edited file (Y.Text + provider). Remount the component per file. */
  session: FileSession;
  /** Viewers get a read-only editor. */
  readOnly?: boolean;
  comments: CommentRange[];
  /** Spell checking (fixed for the component's lifetime; remount to change the language). */
  spell?: { client: SpellClient; language: SpellLanguage; onMenu(r: SpellMenuRequest): void };
  onCommentClick?(id: string): void;
  onCompile(): void;
  /** Pictures dropped or pasted into the text, with the position they go to. */
  onPictures?(files: File[], pos: number): void;
}

const setComments = StateEffect.define<CommentRange[]>();

/** Comment highlights; mapped through edits until the next refresh from Yjs positions. */
const commentField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setComments)) continue;
      const len = tr.state.doc.length;
      deco = Decoration.set(
        e.value
          .filter((r) => r.to > r.from && r.to <= len)
          .map((r) =>
            Decoration.mark({
              class: r.active ? 'cm-comment cm-comment-active' : 'cm-comment',
              attributes: { 'data-comment-id': r.id },
            }).range(r.from, r.to),
          ),
        true,
      );
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function extensions(
  props: Props,
  handlers: { current: Pick<Props, 'onCompile' | 'onCommentClick' | 'spell' | 'onPictures' | 'readOnly'> },
): Extension[] {
  const { session, readOnly = false } = props;
  return [
    ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion({ override: [latexCompletions], icons: false, maxRenderedOptions: 60 }),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    StreamLanguage.define(stex),
    EditorView.lineWrapping,
    commentField,
    ...(props.spell ? [spellcheck(props.spell.client, props.spell.language, (r) => handlers.current.spell?.onMenu(r))] : []),
    // Shared editing: Y.Text <-> editor, remote cursors with names, Yjs undo.
    yCollab(session.text, session.provider.awareness, { undoManager: session.undoManager }),
    keymap.of([
      { key: 'Mod-Enter', run: () => (handlers.current.onCompile(), true), preventDefault: true },
      // Saving is continuous; swallow the browser's "save page" dialog.
      { key: 'Mod-s', run: () => true, preventDefault: true },
      ...yUndoManagerKeymap,
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    EditorView.domEventHandlers({
      drop: (event, view) => {
        const files = [...(event.dataTransfer?.files ?? [])].filter(isPicture);
        if (files.length === 0 || !handlers.current.onPictures || handlers.current.readOnly) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
        handlers.current.onPictures(files, pos);
        return true;
      },
      paste: (event, view) => {
        const files = [...(event.clipboardData?.files ?? [])].filter(isPicture);
        if (files.length === 0 || !handlers.current.onPictures || handlers.current.readOnly) return false;
        event.preventDefault();
        handlers.current.onPictures(files, view.state.selection.main.head);
        return true;
      },
      click: (event) => {
        const id = (event.target as HTMLElement).closest('[data-comment-id]')?.getAttribute('data-comment-id');
        if (id) handlers.current.onCommentClick?.(id);
        return false;
      },
    }),
  ];
}

/**
 * CodeMirror 6 editor with LaTeX highlighting bound to a shared Y.Text
 * (y-codemirror.next): edits from other people appear live with their
 * cursors; undo/redo only touches your own changes.
 */
export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const handlers = useRef(props);
  handlers.current = props;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({ doc: props.session.text.toString(), extensions: extensions(props, handlers) }),
    });
    view.current = v;
    v.focus();
    return () => {
      v.destroy();
      view.current = null;
    };
    // The component is keyed by file; session and readOnly are fixed for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: setComments.of(props.comments) });
  }, [props.comments]);

  useImperativeHandle(ref, () => ({
    gotoLine(line: number) {
      const v = view.current;
      if (!v) return;
      const target = v.state.doc.line(Math.min(Math.max(1, line), v.state.doc.lines));
      v.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: 'center' }) });
      v.focus();
    },
    showRange(from: number, to: number) {
      const v = view.current;
      if (!v) return;
      const len = v.state.doc.length;
      const a = Math.min(from, len);
      const b = Math.min(to, len);
      v.dispatch({ selection: { anchor: a, head: b }, effects: EditorView.scrollIntoView(a, { y: 'center' }) });
      v.focus();
    },
    replaceRange(from: number, to: number, text: string, expected?: string) {
      const v = view.current;
      if (!v || to > v.state.doc.length) return false;
      if (expected !== undefined && v.state.sliceDoc(from, to) !== expected) return false;
      v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      v.focus();
      return true;
    },
    insertAtCursor(text: string) {
      const v = view.current;
      if (!v) return;
      const { from, to } = v.state.selection.main;
      v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      v.focus();
    },
    applyEdits(edits: { from: number; to: number; insert: string }[], expected: string) {
      const v = view.current;
      if (!v || v.state.doc.toString() !== expected) return false;
      v.dispatch({ changes: [...edits].sort((a, b) => a.from - b.from) });
      v.focus();
      return true;
    },
    text() {
      return view.current?.state.doc.toString() ?? '';
    },
    cursorLine() {
      const v = view.current;
      return v ? v.state.doc.lineAt(v.state.selection.main.head).number : 1;
    },
    selection() {
      const sel = view.current?.state.selection.main;
      return { from: sel?.from ?? 0, to: sel?.to ?? 0 };
    },
  }));

  return <div className="code-editor" ref={host} data-testid="code-editor" />;
});
