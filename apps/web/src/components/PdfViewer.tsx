import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PdfBox } from '@oversells/shared';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfHighlight {
  page: number;
  boxes: PdfBox[];
  /** Changes on every request so the same place can be shown twice. */
  nonce: number;
}

interface Props {
  /** URL of the PDF to show; null shows the empty state. */
  url: string | null;
  /** Double-click on a page: position in PDF points from the page's top-left corner. */
  onSyncClick?(page: number, x: number, y: number): void;
  /** Boxes to scroll to and flash (source -> PDF). */
  highlight?: PdfHighlight | null;
}

/** One page: a sized placeholder that holds a canvas only while it is near the viewport. */
interface Slot {
  n: number;
  page: pdfjs.PDFPageProxy;
  wrap: HTMLDivElement;
  /** CSS pixels per PDF point. */
  scale: number;
  /** The canvas rendered at the current scale (null: none, or only a stale one). */
  canvas: HTMLCanvasElement | null;
  task: pdfjs.RenderTask | null;
}

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
/** Pages this far outside the viewport are rendered ahead / released. */
const RENDER_MARGIN_PX = 1500;
/** Padding of .pdf-scroller above the first page. */
const SCROLLER_PADDING = 16;

/**
 * Shows a PDF as a column of pages. Only the pages near the viewport have a
 * canvas, so books with a thousand pages stay light; after a recompile or a
 * zoom change the old canvases stand in until the new ones are drawn, and the
 * reader stays on the same spot of the same page.
 */
export function PdfViewer({ url, onSyncClick, highlight }: Props) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [loading, setLoading] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageText, setPageText] = useState('1');
  const slots = useRef<Slot[]>([]);
  const [renderedAt, setRenderedAt] = useState(0);
  const shownNonce = useRef(0);
  const syncClick = useRef(onSyncClick);
  syncClick.current = onSyncClick;

  /** Loading task of the document currently shown (destroying it frees the worker). */
  const shownTask = useRef<pdfjs.PDFDocumentLoadingTask | null>(null);

  // Load the document whenever the URL changes.
  useEffect(() => {
    if (!url) {
      setDoc(null);
      return;
    }
    let loaded = false;
    setLoading(true);
    const task = pdfjs.getDocument({ url });
    task.promise.then(
      (d) => {
        loaded = true;
        void shownTask.current?.destroy();
        shownTask.current = task;
        setDoc(d);
        setPageCount(d.numPages);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => {
      if (!loaded) void task.destroy().catch(() => undefined);
    };
  }, [url]);

  useEffect(() => () => void shownTask.current?.destroy(), []);

  /** Page at the top third of the viewport, and how far into it (0..1) the viewport top is. */
  const anchor = (): { page: number; fraction: number } | null => {
    const sc = scroller.current;
    const list = slots.current;
    if (!sc || list.length === 0) return null;
    const top = sc.scrollTop - SCROLLER_PADDING;
    const probe = top + sc.clientHeight / 3;
    let lo = 0;
    let hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (list[mid]!.wrap.offsetTop <= probe) lo = mid;
      else hi = mid - 1;
    }
    const wrap = list[lo]!.wrap;
    return { page: lo + 1, fraction: wrap.offsetHeight ? (top - wrap.offsetTop) / wrap.offsetHeight : 0 };
  };

  const scrollToPage = (page: number, fraction = 0) => {
    const sc = scroller.current;
    const wrap = slots.current[page - 1]?.wrap;
    if (sc && wrap) sc.scrollTop = SCROLLER_PADDING + wrap.offsetTop + fraction * wrap.offsetHeight;
  };

  // Lay out the pages when the document or zoom changes; render them lazily.
  useEffect(() => {
    const container = pagesRef.current;
    const sc = scroller.current;
    if (!doc || !container || !sc) return;
    let cancelled = false;
    let observer: IntersectionObserver | null = null;
    const previous = slots.current;
    const keep = anchor();

    const release = (slot: Slot) => {
      slot.task?.cancel();
      slot.task = null;
      slot.canvas = null;
      slot.wrap.querySelectorAll('canvas').forEach((c) => c.remove());
      slot.page.cleanup();
    };

    const render = (slot: Slot) => {
      if (slot.canvas || slot.task) return;
      const dpr = window.devicePixelRatio || 1;
      const viewport = slot.page.getViewport({ scale: slot.scale * dpr });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = slot.wrap.style.width;
      canvas.style.height = slot.wrap.style.height;
      canvas.className = 'pdf-page';
      canvas.dataset.page = String(slot.n);
      const task = slot.page.render({ canvasContext: canvas.getContext('2d')!, viewport });
      slot.task = task;
      task.promise.then(
        () => {
          if (slot.task !== task) return;
          slot.task = null;
          if (cancelled) return;
          slot.wrap.querySelectorAll('canvas').forEach((c) => c.remove());
          slot.wrap.prepend(canvas);
          slot.canvas = canvas;
        },
        () => {
          if (slot.task === task) slot.task = null;
        },
      );
    };

    (async () => {
      const pages = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)));
      if (cancelled) return;
      const available = sc.clientWidth - 2 * SCROLLER_PADDING;
      const next: Slot[] = pages.map((page, i) => {
        const n = i + 1;
        const base = page.getViewport({ scale: 1 });
        const scale = zoom === 'fit' ? Math.max(0.25, available / base.width) : zoom;
        const wrap = document.createElement('div');
        wrap.className = 'pdf-page-wrap';
        wrap.dataset.page = String(n);
        wrap.style.width = `${Math.floor(base.width * scale)}px`;
        wrap.style.height = `${Math.floor(base.height * scale)}px`;
        // The old drawing of this page stands in until the new one is ready.
        const stale = previous[i]?.wrap.querySelector('canvas');
        if (stale) {
          stale.style.width = '100%';
          stale.style.height = '100%';
          wrap.append(stale);
        }
        wrap.addEventListener('dblclick', (e) => {
          const rect = wrap.getBoundingClientRect();
          syncClick.current?.(n, (e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale);
        });
        return { n, page, wrap, scale, canvas: null, task: null };
      });
      container.replaceChildren(...next.map((s) => s.wrap));
      slots.current = next;
      if (keep) scrollToPage(Math.min(keep.page, next.length), keep.fraction);
      observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const slot = next[Number((e.target as HTMLElement).dataset.page) - 1];
            if (!slot) continue;
            if (e.isIntersecting) render(slot);
            else if (slot.canvas || slot.task || slot.wrap.querySelector('canvas')) release(slot);
          }
        },
        { root: sc, rootMargin: `${RENDER_MARGIN_PX}px 0px` },
      );
      for (const s of next) observer.observe(s.wrap);
      setCurrentPage(anchor()?.page ?? 1);
      setRenderedAt(Date.now());
    })().catch((err) => console.error('PDF render failed', err));

    return () => {
      cancelled = true;
      observer?.disconnect();
      for (const s of slots.current) {
        s.task?.cancel();
        s.task = null;
      }
    };
  }, [doc, zoom]);

  // Track the page being read.
  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setCurrentPage(anchor()?.page ?? 1));
    };
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      sc.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (document.activeElement?.classList.contains('page-input')) return;
    setPageText(String(currentPage));
  }, [currentPage]);

  // Scroll to and flash the boxes of a source -> PDF jump.
  useEffect(() => {
    if (!highlight || !pagesRef.current || shownNonce.current === highlight.nonce) return;
    const slot = slots.current[highlight.page - 1];
    if (!slot) return; // not laid out yet: retried after layout
    const { wrap, scale } = slot;
    shownNonce.current = highlight.nonce;
    pagesRef.current.querySelectorAll('.synctex-highlight').forEach((n) => n.remove());
    for (const b of highlight.boxes) {
      const mark = document.createElement('div');
      mark.className = 'synctex-highlight';
      mark.dataset.testid = 'synctex-highlight';
      Object.assign(mark.style, {
        left: `${b.x * scale}px`,
        top: `${b.y * scale}px`,
        width: `${Math.max(b.w * scale, 4)}px`,
        height: `${Math.max(b.h * scale, 4)}px`,
      });
      wrap.append(mark);
    }
    const top = Math.min(...highlight.boxes.map((b) => b.y)) * scale;
    const sc = scroller.current;
    if (sc) sc.scrollTop = SCROLLER_PADDING + wrap.offsetTop + top - sc.clientHeight / 3;
    const timer = setTimeout(() => wrap.querySelectorAll('.synctex-highlight').forEach((n) => n.classList.add('fading')), 2500);
    return () => clearTimeout(timer);
  }, [highlight, renderedAt]);

  const current = zoom === 'fit' ? null : zoom;
  const step = (dir: 1 | -1) => {
    const z = current ?? 1;
    const idx = ZOOM_STEPS.findIndex((s) => s >= z);
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, (idx === -1 ? ZOOM_STEPS.length - 1 : idx) + dir))]!;
    setZoom(next);
  };

  const goToTyped = () => {
    const n = Math.round(Number(pageText));
    if (Number.isFinite(n) && n >= 1 && pageCount > 0) {
      const page = Math.min(n, pageCount);
      scrollToPage(page);
      setCurrentPage(page);
      setPageText(String(page));
    } else setPageText(String(currentPage));
  };

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <button onClick={() => step(-1)} title={t('pdf.zoomOut')} aria-label={t('pdf.zoomOut')}>
          −
        </button>
        <button className={zoom === 'fit' ? 'active' : ''} onClick={() => setZoom('fit')}>
          ↔
        </button>
        <span className="zoom-label">{current ? `${Math.round(current * 100)}%` : ''}</span>
        <button onClick={() => step(1)} title={t('pdf.zoomIn')} aria-label={t('pdf.zoomIn')}>
          +
        </button>
        {pageCount > 0 && (
          <span className="page-count">
            <input
              className="page-input"
              data-testid="pdf-page-input"
              inputMode="numeric"
              aria-label={t('pdf.page')}
              title={t('pdf.page')}
              value={pageText}
              onChange={(e) => setPageText(e.target.value.replace(/\D/g, ''))}
              onFocus={(e) => e.target.select()}
              onBlur={goToTyped}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  goToTyped();
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />{' '}
            / {pageCount}
          </span>
        )}
        {loading && <span className="muted">{t('pdf.loading')}</span>}
      </div>
      <div className="pdf-scroller" ref={scroller}>
        {!url && <p className="empty">{t('pdf.empty')}</p>}
        <div className="pdf-pages" ref={pagesRef} data-testid="pdf-pages" />
      </div>
    </div>
  );
}
