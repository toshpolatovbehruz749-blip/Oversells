import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { ITEMS, inMath, latexCompletions } from './latex-completions';

/** What a template inserts: field defaults kept, escaped braces unescaped (CodeMirror's rules). */
function expand(template: string): string {
  return template
    .replace(/[#$]\{(?:\d+(?::([^{}]*))?|((?:\\[{}]|[^{}])*))\}/g, (_, a, b) => (a ?? b ?? '').replace(/\\([{}])/g, '$1'))
    .replace(/\\([{}])/g, '$1');
}

function complete(doc: string, explicit = false): CompletionResult | null {
  const pos = doc.indexOf('|');
  const text = doc.replace('|', '');
  const state = EditorState.create({ doc: text, selection: { anchor: pos } });
  return latexCompletions(new CompletionContext(state, pos, explicit)) as CompletionResult | null;
}
const labels = (r: CompletionResult | null) => r?.options.map((o) => o.label) ?? [];

describe('LaTeX completions', () => {
  it('every template expands to balanced LaTeX', () => {
    for (const item of ITEMS) {
      const tex = expand(item.template);
      expect(tex, item.label).not.toMatch(/\$\{|#\{|⏎/);
      // Braces balance once escaped ones (\{ \}) are left out.
      const bare = tex.replace(/\\[{}]/g, '');
      expect(bare.split('{').length, `${item.label}: ${tex}`).toBe(bare.split('}').length);
    }
  });

  it('keeps LaTeX braces and line breaks right', () => {
    const get = (label: string) => expand(ITEMS.find((i) => i.label === label)!.template);
    expect(get('\\frac')).toBe('\\frac{num}{den}');
    expect(get('\\left\\{')).toBe('\\left\\{  \\right\\}');
    expect(get('\\cases')).toBe('\\begin{cases}\n   & , \\\\\n   & .\n\\end{cases}');
    expect(get('Kvadrat tenglama ildizlari')).toBe('x_{1,2}=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}');
    expect(get('Moduli taʼrifi')).toContain('x\\ge 0,\\\\ -x');
    expect(get('\\teorema')).toContain('\\begin{teorema}[Nomi]');
  });

  it('finds commands by name and by Uzbek words after a backslash', () => {
    expect(labels(complete('$\\fr|$'))).toContain('\\frac');
    expect(labels(complete('$\\kasr|$'))).toContain('\\kasr');
    expect(labels(complete('\\bol|'))).toContain('\\bolim');
    expect(labels(complete('\\rasm|'))).toContain('\\rasm');
  });

  it('suggests ready formulas for plain words inside formulas only', () => {
    expect(labels(complete('$$ pifag| $$'))).toContain('pifagor');
    expect(labels(complete('\\[ diskr| \\]'))).toContain('diskriminant');
    expect(complete('Bu pifag| teoremasi')).toBeNull();
  });

  it('completes environments with their \\end', () => {
    const r = complete('\\begin{ali|');
    expect(labels(r)).toContain('align');
    expect(labels(r)).toContain('teorema');
  });

  it('knows when the cursor is inside a formula', () => {
    expect(inMath('a $b', 4)).toBe(true);
    expect(inMath('a $b$ c', 7)).toBe(false);
    expect(inMath('\\[ x', 4)).toBe(true);
    expect(inMath('\\begin{align} x', 15)).toBe(true);
    expect(inMath('\\begin{align} x \\end{align} y', 29)).toBe(false);
    expect(inMath('narxi 5\\$ dan $x', 16)).toBe(true);
    expect(inMath('% $ izoh\nmatn', 13)).toBe(false);
  });
});
