/**
 * Sizes of the editor's three panes (files, code, PDF) chosen by dragging the
 * borders between them; kept per browser. Pure functions, no DOM.
 */

export interface PaneLayout {
  /** Width of the file tree, px. */
  tree: number;
  /** Share of the code pane in the room left for code and PDF (0..1). */
  code: number;
  /** File tree folded away. */
  treeHidden: boolean;
  /** The tool buttons of the code pane are shown (otherwise folded into one button). */
  tools: boolean;
}

export const DEFAULT_LAYOUT: PaneLayout = { tree: 250, code: 0.5, treeHidden: false, tools: true };
export const TREE_MIN = 150;
export const TREE_MAX = 480;
/** Neither code nor PDF gets narrower than this, px. */
export const PANE_MIN = 260;
const KEY = 'oversells.paneLayout';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** The layout from localStorage text (anything broken falls back to the defaults). */
export function readLayout(raw: string | null): PaneLayout {
  try {
    const v = JSON.parse(raw ?? '{}') as Partial<PaneLayout>;
    return {
      tree: typeof v.tree === 'number' && Number.isFinite(v.tree) ? clamp(v.tree, TREE_MIN, TREE_MAX) : DEFAULT_LAYOUT.tree,
      code: typeof v.code === 'number' && Number.isFinite(v.code) ? clamp(v.code, 0.15, 0.85) : DEFAULT_LAYOUT.code,
      treeHidden: v.treeHidden === true,
      tools: v.tools !== false,
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function loadLayout(): PaneLayout {
  try {
    return readLayout(localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function saveLayout(l: PaneLayout): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    // private mode: the sizes last until the page is closed
  }
}

/** The tree width after dragging its border by dx px. */
export function dragTree(start: number, dx: number): number {
  return Math.round(clamp(start + dx, TREE_MIN, TREE_MAX));
}

/**
 * The code share after dragging the border between code (startCode px wide) and
 * PDF (startPdf px) by dx px; neither gets narrower than PANE_MIN when there is room.
 */
export function dragSplit(startCode: number, startPdf: number, dx: number): number {
  const total = startCode + startPdf;
  if (total <= 0) return DEFAULT_LAYOUT.code;
  const min = Math.min(PANE_MIN, total / 2);
  const code = clamp(startCode + dx, min, total - min);
  return Math.round((code / total) * 1000) / 1000;
}
