import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DRAW_COLORS,
  drawingSource,
  EMPTY_DRAWING,
  evalExpr,
  functionPieces,
  parseExpr,
  type DrawColor,
  type Drawing,
  type DrawStyle,
  type Pt,
  type Shape,
} from '@oversells/shared';

interface Props {
  /** A drawing to edit (from the source around the cursor), or null for a new one. */
  initial: Drawing | null;
  onInsert(source: string): void;
  onClose(): void;
}

type Tool = 'select' | 'point' | 'segment' | 'arrow' | 'polygon' | 'rect' | 'circle' | 'text';
const TOOLS: Array<{ id: Tool; icon: string }> = [
  { id: 'select', icon: '⬉' },
  { id: 'point', icon: '•' },
  { id: 'segment', icon: '╱' },
  { id: 'arrow', icon: '↗' },
  { id: 'polygon', icon: '△' },
  { id: 'rect', icon: '▭' },
  { id: 'circle', icon: '○' },
  { id: 'text', icon: 'T' },
];

/** Pixels per unit in the SVG's own coordinates (the SVG is scaled to fit). */
const K = 50;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
function segDist(p: Pt, a: Pt, b: Pt): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}
const rectCorners = (a: Pt, b: Pt): Pt[] => [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
const edges = (pts: Pt[], closed: boolean) => pts.slice(0, closed ? undefined : -1).map((p, i) => [p, pts[(i + 1) % pts.length]!] as const);

/** How far a point is from a shape, in units. */
function shapeDist(s: Shape, p: Pt): number {
  switch (s.kind) {
    case 'point':
      return dist(p, s.at);
    case 'text':
      return dist(p, s.at) - 0.3;
    case 'segment':
      return segDist(p, s.from, s.to);
    case 'polygon':
      return Math.min(...edges(s.points, s.closed).map(([a, b]) => segDist(p, a, b)), Infinity);
    case 'rect':
      return Math.min(...edges(rectCorners(s.from, s.to), true).map(([a, b]) => segDist(p, a, b)));
    case 'circle':
      return Math.abs(dist(p, s.center) - s.r);
    case 'function':
      try {
        if (p.x < s.from || p.x > s.to) return Infinity;
        return Math.abs(evalExpr(parseExpr(s.expr), p.x) - p.y);
      } catch {
        return Infinity;
      }
  }
}

function moveShape(s: Shape, dx: number, dy: number): Shape {
  const m = (p: Pt) => ({ x: p.x + dx, y: p.y + dy });
  switch (s.kind) {
    case 'point':
    case 'text':
      return { ...s, at: m(s.at) };
    case 'segment':
    case 'rect':
      return { ...s, from: m(s.from), to: m(s.to) };
    case 'polygon':
      return { ...s, points: s.points.map(m) };
    case 'circle':
      return { ...s, center: m(s.center) };
    case 'function':
      return s;
  }
}

/** The next free point name: A, B, ..., Z, A1, ... */
function nextLabel(shapes: Shape[]): string {
  const used = new Set(shapes.flatMap((s) => (s.kind === 'point' && s.label ? [s.label] : [])));
  for (let n = 0; ; n++) {
    for (let c = 65; c <= 90; c++) {
      const l = String.fromCharCode(c) + (n ? String(n) : '');
      if (!used.has(l)) return l;
    }
  }
}

type Draft = { kind: 'segment' | 'arrow' | 'rect' | 'circle'; from: Pt; to: Pt; moved: boolean };

/** "Chizish": shapes and graphs drawn with the mouse become TikZ code. */
export function DrawDialog({ initial, onInsert, onClose }: Props) {
  const { t } = useTranslation();
  const [drawing, setDrawing] = useState<Drawing>(initial ?? EMPTY_DRAWING);
  const [history, setHistory] = useState<Drawing[]>([]);
  const [tool, setTool] = useState<Tool>('point');
  const [style, setStyle] = useState<DrawStyle>({ color: 'blue' });
  const [snap, setSnap] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [poly, setPoly] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [drag, setDrag] = useState<{ index: number; last: Pt; pushed: boolean } | null>(null);
  const [label, setLabel] = useState('');
  const [fn, setFn] = useState({ expr: '', from: '', to: '' });
  const [fnError, setFnError] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const { xmin, xmax, ymin, ymax } = drawing;
  const W = (xmax - xmin) * K;
  const H = (ymax - ymin) * K;
  const sx = (x: number) => (x - xmin) * K;
  const sy = (y: number) => (ymax - y) * K;

  /** Changes the drawing with an undo step. */
  const change = (f: (d: Drawing) => Drawing) => {
    setHistory((h) => [...h.slice(-99), drawing]);
    setDrawing(f(drawing));
  };
  const addShape = (s: Shape) => change((d) => ({ ...d, shapes: [...d.shapes, s] }));
  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory(history.slice(0, -1));
    setDrawing(prev);
    setSelected(null);
  };
  const removeSelected = () => {
    if (selected === null) return;
    change((d) => ({ ...d, shapes: d.shapes.filter((_, i) => i !== selected) }));
    setSelected(null);
  };

  const toUnits = (e: { clientX: number; clientY: number }, exact = false): Pt => {
    const el = svg.current!;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = el.getScreenCTM();
    const p = m ? pt.matrixTransform(m.inverse()) : pt;
    const u = { x: p.x / K + xmin, y: ymax - p.y / K };
    if (!snap || exact) return u;
    // Grid steps of 0.5, and existing points within reach.
    for (const s of drawing.shapes) if (s.kind === 'point' && dist(s.at, u) < 0.2) return s.at;
    return { x: Math.round(u.x * 2) / 2, y: Math.round(u.y * 2) / 2 };
  };

  const finishPolygon = (closed: boolean) => {
    if (poly.length >= 2) addShape({ kind: 'polygon', points: poly, closed: closed && poly.length >= 3, style });
    setPoly([]);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = toUnits(e);
    switch (tool) {
      case 'select': {
        const exact = toUnits(e, true);
        let best = -1;
        let bestD = 0.35;
        drawing.shapes.forEach((s, i) => {
          // A point on a vertex or a line is picked before them.
          const d = shapeDist(s, exact) - (s.kind === 'point' ? 0.2 : 0);
          if (d < bestD) {
            best = i;
            bestD = d;
          }
        });
        setSelected(best === -1 ? null : best);
        if (best !== -1) {
          const s = drawing.shapes[best]!;
          setLabel(s.kind === 'point' ? (s.label ?? '') : s.kind === 'text' ? s.text : '');
          setDrag({ index: best, last: p, pushed: false });
          svg.current?.setPointerCapture(e.pointerId);
        }
        return;
      }
      case 'point':
        addShape({ kind: 'point', at: p, label: nextLabel(drawing.shapes), style });
        return;
      case 'text':
        if (label.trim()) addShape({ kind: 'text', at: p, text: label.trim(), style });
        return;
      case 'polygon':
        if (poly.length >= 3 && dist(p, poly[0]!) < 0.3) finishPolygon(true);
        else setPoly([...poly, p]);
        return;
      default:
        // Two clicks or a drag.
        if (draft) {
          finishDraft({ ...draft, to: p });
          return;
        }
        setDraft({ kind: tool, from: p, to: p, moved: false });
        svg.current?.setPointerCapture(e.pointerId);
    }
  };

  const finishDraft = (d: Draft) => {
    setDraft(null);
    if (dist(d.from, d.to) < 1e-9) return;
    if (d.kind === 'circle') addShape({ kind: 'circle', center: d.from, r: Math.round(dist(d.from, d.to) * 100) / 100, style });
    else if (d.kind === 'rect') addShape({ kind: 'rect', from: d.from, to: d.to, style });
    else addShape({ kind: 'segment', from: d.from, to: d.to, arrow: d.kind === 'arrow', style });
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = toUnits(e);
    setHover(p);
    if (draft) setDraft({ ...draft, to: p, moved: draft.moved || dist(p, draft.from) > 0 });
    if (drag && (p.x !== drag.last.x || p.y !== drag.last.y)) {
      // One undo step for the whole drag.
      if (!drag.pushed) setHistory((h) => [...h.slice(-99), drawing]);
      setDrawing((d) => ({ ...d, shapes: d.shapes.map((s, i) => (i === drag.index ? moveShape(s, p.x - drag.last.x, p.y - drag.last.y) : s)) }));
      setDrag({ ...drag, last: p, pushed: true });
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    setDrag(null);
    if (draft && draft.moved) finishDraft({ ...draft, to: toUnits(e) });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (draft || poly.length) {
          setDraft(null);
          setPoly([]);
        } else onClose();
      } else if (e.key === 'Enter' && poly.length && !typing) {
        e.preventDefault();
        finishPolygon(false);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && selected !== null) {
        e.preventDefault();
        removeSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        undo();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  const setStyleAndSelected = (patch: Partial<DrawStyle>) => {
    setStyle({ ...style, ...patch });
    if (selected !== null) change((d) => ({ ...d, shapes: d.shapes.map((s, i) => (i === selected ? { ...s, style: { ...s.style, ...patch } } : s)) }));
  };

  const editLabel = (value: string) => {
    setLabel(value);
    const s = selected !== null ? drawing.shapes[selected] : null;
    if (!s || (s.kind !== 'point' && s.kind !== 'text')) return;
    // Typing changes the text without an undo step per letter.
    setDrawing((d) => ({
      ...d,
      shapes: d.shapes.map((x, i) => (i !== selected ? x : x.kind === 'point' ? { ...x, label: value } : x.kind === 'text' ? { ...x, text: value } : x)),
    }));
  };

  const addFunction = () => {
    try {
      parseExpr(fn.expr);
      const from = fn.from.trim() === '' ? xmin : Number(fn.from.replace(',', '.'));
      const to = fn.to.trim() === '' ? xmax : Number(fn.to.replace(',', '.'));
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new Error('range');
      addShape({ kind: 'function', expr: fn.expr.trim(), from, to, style });
      setFn({ expr: '', from: '', to: '' });
      setFnError(null);
    } catch {
      setFnError(t('draw.fnError'));
    }
  };

  const setRange = (key: 'xmin' | 'xmax' | 'ymin' | 'ymax' | 'scale', value: string) => {
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    const next = { ...drawing, [key]: v };
    if (next.xmax - next.xmin < 1 || next.ymax - next.ymin < 1 || next.xmax - next.xmin > 40 || next.ymax - next.ymin > 40) return;
    if (next.scale <= 0 || next.scale > 3) return;
    change(() => next);
  };

  const source = useMemo(() => {
    try {
      return drawingSource(drawing);
    } catch {
      return '';
    }
  }, [drawing]);

  // --- SVG -----------------------------------------------------------------------------

  const stroke = (s: DrawStyle, sel: boolean) => ({
    stroke: DRAW_COLORS[s.color].css,
    strokeWidth: (s.thick ? 2.6 : 1.6) + (sel ? 2 : 0),
    strokeDasharray: s.dashed ? '6 4' : undefined,
    strokeOpacity: sel ? 0.75 : 1,
  });
  const fillOf = (s: DrawStyle, allowed: boolean) => (allowed && s.fill ? DRAW_COLORS[s.color].css : 'none');

  const renderShape = (s: Shape, i: number) => {
    const sel = i === selected;
    switch (s.kind) {
      case 'point':
        return (
          <g key={i}>
            <circle cx={sx(s.at.x)} cy={sy(s.at.y)} r={sel ? 6 : 4} fill={DRAW_COLORS[s.style.color].css} />
            {s.label && (
              <text x={sx(s.at.x) + 6} y={sy(s.at.y) - 6} className="draw-label" fill={DRAW_COLORS[s.style.color].css}>
                {s.label}
              </text>
            )}
          </g>
        );
      case 'text':
        return (
          <text key={i} x={sx(s.at.x)} y={sy(s.at.y)} textAnchor="middle" dominantBaseline="middle" className={`draw-text${sel ? ' selected' : ''}`} fill={DRAW_COLORS[s.style.color].css}>
            {s.text.replace(/\$/g, '')}
          </text>
        );
      case 'segment':
        return (
          <line key={i} x1={sx(s.from.x)} y1={sy(s.from.y)} x2={sx(s.to.x)} y2={sy(s.to.y)} {...stroke(s.style, sel)} markerEnd={s.arrow ? `url(#arrow-${s.style.color})` : undefined} />
        );
      case 'polygon': {
        const pts = s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ');
        return s.closed ? (
          <polygon key={i} points={pts} {...stroke(s.style, sel)} fill={fillOf(s.style, true)} fillOpacity={0.15} />
        ) : (
          <polyline key={i} points={pts} {...stroke(s.style, sel)} fill="none" />
        );
      }
      case 'rect':
        return (
          <rect
            key={i}
            x={sx(Math.min(s.from.x, s.to.x))}
            y={sy(Math.max(s.from.y, s.to.y))}
            width={Math.abs(s.to.x - s.from.x) * K}
            height={Math.abs(s.to.y - s.from.y) * K}
            {...stroke(s.style, sel)}
            fill={fillOf(s.style, true)}
            fillOpacity={0.15}
          />
        );
      case 'circle':
        return <circle key={i} cx={sx(s.center.x)} cy={sy(s.center.y)} r={s.r * K} {...stroke(s.style, sel)} fill={fillOf(s.style, true)} fillOpacity={0.15} />;
      case 'function': {
        let e;
        try {
          e = parseExpr(s.expr);
        } catch {
          return null;
        }
        const paths = functionPieces(e, s.from, s.to, ymin, ymax).map(([a, b]) => {
          const steps = 200;
          let d = '';
          for (let k = 0; k <= steps; k++) {
            const x = a + ((b - a) * k) / steps;
            const y = Math.max(ymin - 50, Math.min(ymax + 50, evalExpr(e, x)));
            d += `${k ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
          }
          return d;
        });
        return (
          <g key={i}>
            {paths.map((d, k) => (
              <path key={k} d={d} fill="none" {...stroke({ ...s.style, thick: s.style.thick ?? true }, sel)} />
            ))}
          </g>
        );
      }
    }
  };

  const gridLines = [];
  if (drawing.grid) {
    for (let x = Math.ceil(xmin); x <= xmax; x++) gridLines.push(<line key={`gx${x}`} x1={sx(x)} y1={0} x2={sx(x)} y2={H} className="draw-grid" />);
    for (let y = Math.ceil(ymin); y <= ymax; y++) gridLines.push(<line key={`gy${y}`} x1={0} y1={sy(y)} x2={W} y2={sy(y)} className="draw-grid" />);
  }
  const sel = selected !== null ? drawing.shapes[selected] : null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal draw-dialog" role="dialog" aria-modal="true" aria-labelledby="draw-title" onMouseDown={(e) => e.stopPropagation()} data-testid="draw-dialog">
        <h2 id="draw-title">{t('draw.title')}</h2>
        <div className="draw-toolbar">
          {TOOLS.map((x) => (
            <button
              key={x.id}
              className={`small${tool === x.id ? ' active' : ''}`}
              title={t(`draw.tool.${x.id}`)}
              aria-pressed={tool === x.id}
              onClick={() => {
                setTool(x.id);
                setDraft(null);
                if (x.id !== 'polygon') finishPolygon(false);
                if (x.id !== 'select') setSelected(null);
              }}
              data-testid={`draw-tool-${x.id}`}
            >
              <span aria-hidden="true">{x.icon}</span> {t(`draw.tool.${x.id}`)}
            </button>
          ))}
        </div>
        <div className="draw-toolbar">
          {(Object.keys(DRAW_COLORS) as DrawColor[]).map((c) => (
            <button
              key={c}
              className={`draw-swatch${(sel?.style.color ?? style.color) === c ? ' active' : ''}`}
              style={{ background: DRAW_COLORS[c].css }}
              title={t(`draw.color.${c}`)}
              aria-label={t(`draw.color.${c}`)}
              onClick={() => setStyleAndSelected({ color: c })}
            />
          ))}
          {(['thick', 'dashed', 'fill'] as const).map((k) => (
            <label key={k} className="check-row">
              <input type="checkbox" checked={!!(sel?.style ?? style)[k]} onChange={(e) => setStyleAndSelected({ [k]: e.target.checked })} />
              {t(`draw.${k}`)}
            </label>
          ))}
          <span className="spacer" />
          <button className="small" onClick={undo} disabled={history.length === 0} title="Ctrl+Z" data-testid="draw-undo">
            ↶ {t('draw.undo')}
          </button>
          <button className="small" onClick={removeSelected} disabled={selected === null} data-testid="draw-delete">
            {t('draw.delete')}
          </button>
          <button
            className="small"
            onClick={() => {
              change((d) => ({ ...d, shapes: [] }));
              setSelected(null);
            }}
            disabled={drawing.shapes.length === 0}
          >
            {t('draw.clear')}
          </button>
        </div>

        <div className="draw-canvas">
          <svg
            ref={svg}
            viewBox={`0 0 ${W} ${H}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setHover(null)}
            onDoubleClick={() => tool === 'polygon' && finishPolygon(false)}
            className={`tool-${tool}`}
            // As wide as fits, but no taller than half the screen.
            style={{ aspectRatio: `${W} / ${H}`, width: `min(100%, calc(50vh * ${W / H}))` }}
            data-testid="draw-canvas"
          >
            <defs>
              {(Object.keys(DRAW_COLORS) as DrawColor[]).map((c) => (
                <marker key={c} id={`arrow-${c}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill={DRAW_COLORS[c].css} />
                </marker>
              ))}
            </defs>
            <rect x={0} y={0} width={W} height={H} fill="#fff" />
            {gridLines}
            {drawing.axes && (
              <g className="draw-axes">
                {ymin <= 0 && ymax >= 0 && <line x1={0} y1={sy(0)} x2={W} y2={sy(0)} markerEnd="url(#arrow-black)" />}
                {xmin <= 0 && xmax >= 0 && <line x1={sx(0)} y1={H} x2={sx(0)} y2={0} markerEnd="url(#arrow-black)" />}
              </g>
            )}
            {drawing.shapes.map(renderShape)}
            {draft && dist(draft.from, draft.to) > 0 && (
              <g className="draw-draft">
                {renderShape(
                  draft.kind === 'circle'
                    ? { kind: 'circle', center: draft.from, r: dist(draft.from, draft.to), style }
                    : draft.kind === 'rect'
                      ? { kind: 'rect', from: draft.from, to: draft.to, style }
                      : { kind: 'segment', from: draft.from, to: draft.to, arrow: draft.kind === 'arrow', style },
                  -1,
                )}
              </g>
            )}
            {poly.length > 0 && (
              <g className="draw-draft">
                <polyline points={[...poly, ...(hover ? [hover] : [])].map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} fill="none" {...stroke(style, false)} />
                {poly.map((p, k) => (
                  <circle key={k} cx={sx(p.x)} cy={sy(p.y)} r={k === 0 ? 6 : 3} fill={DRAW_COLORS[style.color].css} />
                ))}
              </g>
            )}
            {hover && tool !== 'select' && <circle cx={sx(hover.x)} cy={sy(hover.y)} r={3} className="draw-hover" />}
          </svg>
          <div className="draw-status muted">
            {hover ? `(${Math.round(hover.x * 100) / 100}; ${Math.round(hover.y * 100) / 100}) — ` : ''}
            {t(`draw.help.${tool}`)}
          </div>
        </div>

        <div className="draw-panels">
          <div className="draw-panel">
            <strong>{t('draw.function')}</strong>
            <div className="draw-row">
              <span>y =</span>
              <input
                value={fn.expr}
                onChange={(e) => setFn({ ...fn, expr: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && addFunction()}
                placeholder="x^2 - 2x + 1"
                spellCheck={false}
                data-testid="draw-fn"
              />
            </div>
            <div className="draw-row">
              <span>{t('draw.from')}</span>
              <input className="num" value={fn.from} placeholder={String(xmin)} onChange={(e) => setFn({ ...fn, from: e.target.value })} />
              <span>{t('draw.to')}</span>
              <input className="num" value={fn.to} placeholder={String(xmax)} onChange={(e) => setFn({ ...fn, to: e.target.value })} />
              <button className="small" onClick={addFunction} disabled={!fn.expr.trim()} data-testid="draw-fn-add">
                {t('draw.add')}
              </button>
            </div>
            {fnError && <p className="error">{fnError}</p>}
            <p className="muted small-print">{t('draw.fnHint')}</p>
          </div>
          <div className="draw-panel">
            {tool === 'text' || sel?.kind === 'text' || sel?.kind === 'point' ? (
              <label className="draw-row">
                <span>{sel?.kind === 'point' ? t('draw.label') : t('draw.text')}</span>
                <input value={label} onChange={(e) => editLabel(e.target.value)} placeholder={t('draw.textPlaceholder')} data-testid="draw-label" />
              </label>
            ) : null}
            <div className="draw-row">
              <span>x:</span>
              <input className="num" type="number" value={xmin} onChange={(e) => setRange('xmin', e.target.value)} aria-label="x min" />
              <span>…</span>
              <input className="num" type="number" value={xmax} onChange={(e) => setRange('xmax', e.target.value)} aria-label="x max" />
              <span>y:</span>
              <input className="num" type="number" value={ymin} onChange={(e) => setRange('ymin', e.target.value)} aria-label="y min" />
              <span>…</span>
              <input className="num" type="number" value={ymax} onChange={(e) => setRange('ymax', e.target.value)} aria-label="y max" />
            </div>
            <div className="draw-row">
              <label className="check-row">
                <input type="checkbox" checked={drawing.axes} onChange={(e) => change((d) => ({ ...d, axes: e.target.checked }))} />
                {t('draw.axes')}
              </label>
              <label className="check-row">
                <input type="checkbox" checked={drawing.grid} onChange={(e) => change((d) => ({ ...d, grid: e.target.checked }))} />
                {t('draw.grid')}
              </label>
              <label className="check-row">
                <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
                {t('draw.snap')}
              </label>
              <label className="check-row">
                {t('draw.scale')}
                <input className="num" type="number" step="0.1" min="0.1" max="3" value={drawing.scale} onChange={(e) => setRange('scale', e.target.value)} />
              </label>
            </div>
          </div>
        </div>

        <details className="draw-code">
          <summary>{t('draw.code')}</summary>
          <textarea readOnly value={source} rows={8} spellCheck={false} data-testid="draw-code" />
        </details>

        <div className="modal-actions">
          <button onClick={onClose}>{t('dialog.cancel')}</button>
          <button className="primary" disabled={drawing.shapes.length === 0 || !source} onClick={() => onInsert(source)} data-testid="draw-insert">
            {initial ? t('draw.update') : t('draw.insert')}
          </button>
        </div>
      </div>
    </div>
  );
}
