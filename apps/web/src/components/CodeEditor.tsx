import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
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
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
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
  type CompletionContext,
} from '@codemirror/autocomplete';
import { stex } from '@codemirror/legacy-modes/mode/stex';

export interface CodeEditorHandle {
  /** Moves the cursor to the given 1-based line and focuses the editor. */
  gotoLine(line: number): void;
  /** Drops the cached state of a document (e.g. after it was replaced on the server). */
  forget(docKey: string): void;
}

interface Props {
  /** Identifies the open document; a new key swaps in that document's state. */
  docKey: string;
  initialDoc: string;
  onChange(doc: string): void;
  onSave(): void;
  onCompile(): void;
}

const LATEX_COMMANDS = [
  'section{}', 'subsection{}', 'subsubsection{}', 'chapter{}', 'paragraph{}', 'textbf{}', 'textit{}',
  'emph{}', 'underline{}', 'texttt{}', 'frac{}{}', 'sqrt{}', 'sum', 'int', 'lim', 'infty', 'cdot',
  'times', 'leq', 'geq', 'neq', 'alpha', 'beta', 'gamma', 'delta', 'varepsilon', 'pi', 'theta',
  'lambda', 'mathbb{}', 'mathrm{}', 'left(', 'right)', 'label{}', 'ref{}', 'eqref{}', 'cite{}',
  'includegraphics[width=\\linewidth]{}', 'input{}', 'include{}', 'item', 'usepackage{}',
  'begin{}', 'end{}', 'caption{}', 'footnote{}', 'hline', 'newpage', 'tableofcontents', 'maketitle',
  'documentclass{}', 'foreignlanguage{uzbekcyr}{}',
];
const ENVIRONMENTS = [
  'equation', 'align', 'align*', 'gather', 'itemize', 'enumerate', 'figure', 'table', 'tabular',
  'center', 'tikzpicture', 'axis', 'theorem', 'proof', 'otherlanguage', 'minipage', 'cases', 'matrix',
  'pmatrix', 'verbatim',
];

function latexCompletions(ctx: CompletionContext) {
  const env = ctx.matchBefore(/\\(begin|end)\{[\w*]*/);
  if (env) {
    const brace = env.text.indexOf('{') + 1;
    return { from: env.from + brace, options: ENVIRONMENTS.map((e) => ({ label: e, type: 'type' })) };
  }
  const cmd = ctx.matchBefore(/\\[A-Za-z]*/);
  if (!cmd || (cmd.from === cmd.to && !ctx.explicit)) return null;
  return {
    from: cmd.from + 1,
    options: LATEX_COMMANDS.map((c) => ({ label: c.replace(/[[{(].*$/, ''), apply: c, type: 'keyword' })),
  };
}

function baseExtensions(handlers: { current: Pick<Props, 'onChange' | 'onSave' | 'onCompile'> }): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion({ override: [latexCompletions] }),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    StreamLanguage.define(stex),
    EditorView.lineWrapping,
    keymap.of([
      { key: 'Mod-Enter', run: () => (handlers.current.onCompile(), true), preventDefault: true },
      { key: 'Mod-s', run: () => (handlers.current.onSave(), true), preventDefault: true },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) handlers.current.onChange(u.state.doc.toString());
    }),
  ];
}

/**
 * CodeMirror 6 editor with LaTeX highlighting. Keeps one EditorState per
 * document so undo history survives switching between files.
 */
export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const states = useRef(new Map<string, EditorState>());
  const currentKey = useRef<string | null>(null);
  const handlers = useRef(props);
  handlers.current = props;
  const extensions = useRef<Extension[] | null>(null);

  useEffect(() => {
    extensions.current = baseExtensions(handlers);
    view.current = new EditorView({ parent: host.current! });
    return () => {
      view.current?.destroy();
      view.current = null;
      currentKey.current = null;
    };
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (currentKey.current) states.current.set(currentKey.current, v.state);
    const state =
      states.current.get(props.docKey) ??
      EditorState.create({ doc: props.initialDoc, extensions: extensions.current! });
    v.setState(state);
    currentKey.current = props.docKey;
    v.focus();
    // initialDoc is only used the first time a document is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.docKey]);

  useImperativeHandle(ref, () => ({
    gotoLine(line: number) {
      const v = view.current;
      if (!v) return;
      const target = v.state.doc.line(Math.min(Math.max(1, line), v.state.doc.lines));
      v.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: 'center' }) });
      v.focus();
    },
    forget(docKey: string) {
      states.current.delete(docKey);
    },
  }));

  return <div className="code-editor" ref={host} data-testid="code-editor" />;
});
