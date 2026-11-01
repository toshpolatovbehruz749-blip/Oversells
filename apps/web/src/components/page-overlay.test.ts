import { describe, expect, it } from 'vitest';
import type { PageLayout } from '@oversells/shared';
import { edgeMargin, marginAfterDrag, trimOffset } from './page-overlay';

const mm = (v: number) => (v * 72) / 25.4;
// A 145×200 mm page with crop marks on a 175×230 mm PDF page; margins inner 22, outer 15, top 20.
const layout: PageLayout = {
  paper: { w: mm(145), h: mm(200) },
  text: { w: mm(108), h: mm(158) },
  oddLeft: mm(37),
  evenLeft: mm(30),
  top: mm(35),
  twoside: true,
  frames: [],
};

describe('visual mode overlay', () => {
  it('knows inner and outer on odd and even pages', () => {
    expect(edgeMargin('left', 1, true)).toBe('inner');
    expect(edgeMargin('right', 1, true)).toBe('outer');
    expect(edgeMargin('left', 2, true)).toBe('outer');
    expect(edgeMargin('right', 2, true)).toBe('inner');
    expect(edgeMargin('left', 2, false)).toBe('inner');
    expect(edgeMargin('bottom', 2, true)).toBe('bottom');
  });

  it('measures margins from the trimmed page, not from the crop marks', () => {
    const off = trimOffset(layout, mm(175), mm(230));
    expect(off.x / mm(1)).toBeCloseTo(15, 5);
    // Left edge where it is now: 22 mm; dragged 3 mm to the right: 25 mm.
    expect(marginAfterDrag(layout, 'left', mm(37), mm(175), mm(230))).toBe(22);
    expect(marginAfterDrag(layout, 'left', mm(40), mm(175), mm(230))).toBe(25);
    // Right edge at 37 + 108 = 145 mm on the PDF page: 15 mm outer margin.
    expect(marginAfterDrag(layout, 'right', mm(145), mm(175), mm(230))).toBe(15);
    expect(marginAfterDrag(layout, 'top', mm(35), mm(175), mm(230))).toBe(20);
    expect(marginAfterDrag(layout, 'bottom', mm(35 + 158), mm(175), mm(230))).toBe(22);
    // Never below 3 mm.
    expect(marginAfterDrag(layout, 'left', 0, mm(175), mm(230))).toBe(3);
  });
});
