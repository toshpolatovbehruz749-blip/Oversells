import type { LayoutFrame, PageLayout } from '@oversells/shared';

/**
 * «Sahifa dizayni» visual mode: over a rendered PDF page, the text block
 * (its edges drag the margins) and the frames fixed on that page (drag to
 * move, the corner to resize). The positions come from what sahifa.sty wrote
 * into the log; changes are reported in mm and written into the LaTeX by the
 * caller, so the PDF only follows after the next compile.
 */

export type MarginEdge = 'inner' | 'outer' | 'top' | 'bottom';

export interface OverlayHandlers {
  onMargin(edge: MarginEdge, mm: number): void;
  onFrame(frame: LayoutFrame, change: { x?: number; y?: number; w?: number }): void;
  /** Show the baseline grid of the body text inside the text block. */
  grid?: boolean;
  /** A picture dropped on page `page`: the point in PDF points (for SyncTeX) and in mm on the trimmed page. */
  onDrop?(at: DropPoint, data: DataTransfer): void;
}

export interface DropPoint {
  page: number;
  /** PDF points from the top-left corner of the PDF page. */
  x: number;
  y: number;
  /** mm from the top-left corner of the trimmed page (the keys of \rasmramka[joy=sahifa]). */
  xMm: number;
  yMm: number;
}

/** Where on the page a drop at (px, py) CSS pixels inside the page lands. */
export function dropPoint(layout: PageLayout, page: number, px: number, py: number, scale: number, mediaW: number, mediaH: number): DropPoint {
  const x = px / scale;
  const y = py / scale;
  const off = trimOffset(layout, mediaW, mediaH);
  return { page, x, y, xMm: round1(Math.max(0, (x - off.x) * BP_TO_MM)), yMm: round1(Math.max(0, (y - off.y) * BP_TO_MM)) };
}

/** \rasmramka fixed at the drop point, ending in % so the line adds no space to a paragraph. */
export function droppedFrameCode(path: string, at: DropPoint): string {
  return `\\rasmramka[joy=sahifa,x=${at.xMm}mm,y=${at.yMm}mm,en=60mm]{${path}}{}%`;
}

/** CSS of the baseline grid: a 1px line every `step` px, starting `first` px below the top of the text block. */
export function baselineGridStyle(first: number, step: number, height: number): { top: number; height: number; background: string } | null {
  if (!(step >= 2) || first > height) return null;
  return {
    top: first,
    height: height - first,
    background: `repeating-linear-gradient(to bottom, rgba(214, 48, 49, 0.45) 0, rgba(214, 48, 49, 0.45) 1px, transparent 1px, transparent ${step}px)`,
  };
}

const BP_TO_MM = 25.4 / 72;
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Which margin an edge of the text block is: on odd pages (and in one-sided documents)
 * left = inner, right = outer; on even pages of a two-sided document the other way round.
 */
export function edgeMargin(side: 'left' | 'right' | 'top' | 'bottom', page: number, twoside: boolean): MarginEdge {
  if (side === 'top' || side === 'bottom') return side;
  const evenPage = twoside && page % 2 === 0;
  return (side === 'left') !== evenPage ? 'inner' : 'outer';
}

/** The trimmed page sits in the middle of a larger PDF page when crop marks are on. */
export function trimOffset(layout: PageLayout, mediaW: number, mediaH: number): { x: number; y: number } {
  return { x: (mediaW - layout.paper.w) / 2, y: (mediaH - layout.paper.h) / 2 };
}

/** Margin in mm after moving an edge of the text block to `pos` (PDF points on the PDF page). */
export function marginAfterDrag(
  layout: PageLayout,
  side: 'left' | 'right' | 'top' | 'bottom',
  pos: number,
  mediaW: number,
  mediaH: number,
): number {
  const off = trimOffset(layout, mediaW, mediaH);
  const bp =
    side === 'left' ? pos - off.x : side === 'right' ? layout.paper.w - (pos - off.x) : side === 'top' ? pos - off.y : layout.paper.h - (pos - off.y);
  return round1(Math.max(3, bp * BP_TO_MM));
}

/** Pointer drag on an element: move(dx, dy) while dragging, end(dx, dy) on release; deltas in CSS px. */
function draggable(el: HTMLElement, move: (dx: number, dy: number) => void, end: (dx: number, dy: number) => void) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const y0 = e.clientY;
    el.setPointerCapture(e.pointerId);
    // A new layout arriving mid-drag (another compile finished) must not replace this element.
    el.closest('.pdf-page-wrap')?.classList.add('pd-dragging');
    const onMove = (ev: PointerEvent) => move(ev.clientX - x0, ev.clientY - y0);
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.closest('.pdf-page-wrap')?.classList.remove('pd-dragging');
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (Math.abs(dx) + Math.abs(dy) > 2) end(dx, dy);
      else move(0, 0);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  });
}

const box = (el: HTMLElement, x: number, y: number, w: number, h: number) =>
  Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });

/** Draws the overlay of page `n` into its wrapper (replacing an older one). */
export function drawPageOverlay(
  wrap: HTMLElement,
  n: number,
  scale: number,
  mediaW: number,
  mediaH: number,
  layout: PageLayout,
  handlers: OverlayHandlers,
): void {
  if (wrap.classList.contains('pd-dragging')) return;
  wrap.querySelectorAll('.pd-ov').forEach((node) => node.remove());
  const off = trimOffset(layout, mediaW, mediaH);
  const left = layout.twoside && n % 2 === 0 ? layout.evenLeft : layout.oddLeft;
  const tb = { x: left * scale, y: layout.top * scale, w: layout.text.w * scale, h: layout.text.h * scale };

  // The text block and its four edges.
  const block = document.createElement('div');
  block.className = 'pd-ov pd-ov-block';
  box(block, tb.x, tb.y, tb.w, tb.h);
  wrap.appendChild(block);
  if (handlers.grid && layout.baseline) {
    const g = baselineGridStyle(layout.baseline.first * scale, layout.baseline.step * scale, tb.h);
    if (g) {
      const grid = document.createElement('div');
      grid.className = 'pd-ov pd-ov-grid';
      grid.dataset.testid = 'pd-baseline-grid';
      Object.assign(grid.style, { left: `${tb.x}px`, top: `${tb.y + g.top}px`, width: `${tb.w}px`, height: `${g.height}px`, background: g.background });
      wrap.appendChild(grid);
    }
  }
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const edge = document.createElement('div');
    edge.className = `pd-ov pd-ov-edge pd-ov-${side}`;
    edge.dataset.testid = `pd-edge-${side}`;
    const edgeMm = edgeMargin(side, n, layout.twoside);
    edge.title = edgeMm;
    const place = (dx: number, dy: number) => {
      if (side === 'left' || side === 'right') box(edge, (side === 'left' ? tb.x : tb.x + tb.w) + dx - 4, tb.y, 8, tb.h);
      else box(edge, tb.x, (side === 'top' ? tb.y : tb.y + tb.h) + dy - 4, tb.w, 8);
    };
    place(0, 0);
    draggable(
      edge,
      (dx, dy) => place(dx, dy),
      (dx, dy) => {
        const pos =
          side === 'left' ? (tb.x + dx) / scale : side === 'right' ? (tb.x + tb.w + dx) / scale : side === 'top' ? (tb.y + dy) / scale : (tb.y + tb.h + dy) / scale;
        handlers.onMargin(edgeMm, marginAfterDrag(layout, side, pos, mediaW, mediaH));
      },
    );
    wrap.appendChild(edge);
  }

  // Frames fixed on this page.
  for (const f of layout.frames.filter((fr) => fr.page === n)) {
    const r = { x: (f.x + off.x) * scale, y: (f.y + off.y) * scale, w: f.w * scale, h: f.h * scale };
    const el = document.createElement('div');
    el.className = 'pd-ov pd-ov-frame';
    el.dataset.testid = `pd-frame-${f.n}`;
    el.title = `${f.file}:${f.line}`;
    box(el, r.x, r.y, r.w, r.h);
    draggable(
      el,
      (dx, dy) => box(el, r.x + dx, r.y + dy, r.w, r.h),
      (dx, dy) => handlers.onFrame(f, { x: round1((f.x + dx / scale) * BP_TO_MM), y: round1((f.y + dy / scale) * BP_TO_MM) }),
    );
    const corner = document.createElement('div');
    corner.className = 'pd-ov-corner';
    corner.dataset.testid = `pd-frame-${f.n}-corner`;
    draggable(
      corner,
      (dx) => box(el, r.x, r.y, Math.max(10, r.w + dx), Math.max(10, r.h * ((r.w + dx) / r.w))),
      (dx) => handlers.onFrame(f, { w: round1(((r.w + dx) / scale) * BP_TO_MM) }),
    );
    el.appendChild(corner);
    wrap.appendChild(el);
  }
}
