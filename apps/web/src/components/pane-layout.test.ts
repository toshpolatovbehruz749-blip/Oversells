import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, PANE_MIN, TREE_MAX, TREE_MIN, dragSplit, dragTree, readLayout } from './pane-layout';

describe('pane sizes', () => {
  it('reads what was kept, and falls back on anything broken', () => {
    expect(readLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(readLayout('not json')).toEqual(DEFAULT_LAYOUT);
    expect(readLayout('{"tree":9999,"code":2,"treeHidden":true,"tools":false}')).toEqual({ tree: TREE_MAX, code: 0.85, treeHidden: true, tools: false });
  });

  it('keeps the tree and both panes within their limits', () => {
    expect(dragTree(250, 40)).toBe(290);
    expect(dragTree(250, -500)).toBe(TREE_MIN);
    expect(dragSplit(600, 600, 100)).toBeCloseTo(700 / 1200, 3);
    expect(dragSplit(600, 600, 2000)).toBeCloseTo((1200 - PANE_MIN) / 1200, 3);
    expect(dragSplit(600, 600, -2000)).toBeCloseTo(PANE_MIN / 1200, 3);
  });
});
