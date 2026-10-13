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

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/** Renders every page of a PDF onto canvases; keeps scroll position across recompiles. */
export function PdfViewer({ url, onSyncClick, highlight }: Props) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [loading, setLoading] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  /** CSS pixels per PDF point of each rendered page (index = page - 1). */
  const scales = useRef<number[]>([]);
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

  // Render pages when the document or zoom changes.
  useEffect(() => {
    const container = pagesRef.current;
    if (!doc || !container) return;
    let cancelled = false;
    const scrollTop = scroller.current?.scrollTop ?? 0;
    (async () => {
      const dpr = window.devicePixelRatio || 1;
      const available = (scroller.current?.clientWidth ?? 600) - 32;
      const wraps: HTMLDivElement[] = [];
      const pageScales: number[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const scale = zoom === 'fit' ? Math.max(0.25, available / base.width) : zoom;
        const viewport = page.getViewport({ scale: scale * dpr });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        canvas.className = 'pdf-page';
        canvas.dataset.page = String(n);
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
        if (cancelled) return;
        // Wrapper: positioning context for SyncTeX highlights.
        const wrap = document.createElement('div');
        wrap.className = 'pdf-page-wrap';
        wrap.dataset.page = String(n);
        wrap.append(canvas);
        const cssScale = viewport.width / dpr / base.width;
        pageScales.push(cssScale);
        wrap.addEventListener('dblclick', (e) => {
          const rect = canvas.getBoundingClientRect();
          syncClick.current?.(n, (e.clientX - rect.left) / cssScale, (e.clientY - rect.top) / cssScale);
        });
        wraps.push(wrap);
      }
      container.replaceChildren(...wraps);
      scales.current = pageScales;
      setRenderedAt(Date.now());
      if (scroller.current) scroller.current.scrollTop = scrollTop;
    })().catch((err) => console.error("PDF render failed", err));
    return () => {
      cancelled = true;
    };
  }, [doc, zoom]);

  // Scroll to and flash the boxes of a source -> PDF jump.
  useEffect(() => {
    if (!highlight || !pagesRef.current || shownNonce.current === highlight.nonce) return;
    const wrap = pagesRef.current.querySelector<HTMLDivElement>(`.pdf-page-wrap[data-page="${highlight.page}"]`);
    const scale = scales.current[highlight.page - 1];
    if (!wrap || !scale) return; // not rendered yet: retried after rendering
    shownNonce.current = highlight.nonce;
    wrap.querySelectorAll('.synctex-highlight').forEach((n) => n.remove());
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
    if (sc) {
      const offset = wrap.getBoundingClientRect().top - sc.getBoundingClientRect().top;
      sc.scrollTop += offset + top - sc.clientHeight / 3;
    }
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
        {pageCount > 0 && <span className="page-count">{pageCount} pp.</span>}
        {loading && <span className="muted">{t('pdf.loading')}</span>}
      </div>
      <div className="pdf-scroller" ref={scroller}>
        {!url && <p className="empty">{t('pdf.empty')}</p>}
        <div className="pdf-pages" ref={pagesRef} data-testid="pdf-pages" />
      </div>
    </div>
  );
}
