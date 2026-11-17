import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BINDINGS, PAPERS, PRINT_FORMATS, coverGeometry, type Binding, type CoverSpec } from '@oversells/shared';
import { api } from '../api/client';
import { errorMessage } from '../i18n';

interface Props {
  projectId: string;
  canEdit: boolean;
  /** Pictures of the project (paths). */
  pictures: string[];
  /** muqova.tex was written. */
  onSaved?(): void;
}

const PICTURE = /\.(png|jpe?g|pdf)$/i;

/**
 * «Muqova»: the cover spread (back, spine, front) in muqova.tex. The spine width
 * follows the page count of the last PDF and the paper; the cover is compiled
 * into its own PDF.
 */
export function CoverPanel({ projectId, canEdit, pictures, onSaved }: Props) {
  const { t } = useTranslation();
  const [cover, setCover] = useState<CoverSpec | null>(null);
  const [lastPages, setLastPages] = useState<number | null>(null);
  const [readable, setReadable] = useState(true);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState<'save' | 'pdf' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const images = pictures.filter((p) => PICTURE.test(p));

  useEffect(() => {
    api.getCover(projectId).then(
      (r) => {
        setCover(r.cover);
        setLastPages(r.pages);
        setReadable(r.readable);
      },
      (err) => setError(errorMessage(err)),
    );
  }, [projectId]);
  useEffect(() => () => void (pdfUrl && URL.revokeObjectURL(pdfUrl)), [pdfUrl]);

  const geometry = useMemo(() => {
    if (!cover) return null;
    try {
      return coverGeometry(cover);
    } catch {
      return null;
    }
  }, [cover]);

  if (!cover) return <p className="muted">{error ?? t('pageDesign.loading')}</p>;
  const set = (patch: Partial<CoverSpec>) => setCover({ ...cover, ...patch });
  const textField = (key: 'title' | 'subtitle' | 'author' | 'publisher' | 'isbn', max: number) => (
    <label className="field">
      {t(`pageDesign.cover.${key}`)}
      <input value={cover[key] ?? ''} maxLength={max} onChange={(e) => set({ [key]: e.target.value || undefined })} data-testid={`pd-cover-${key}`} />
    </label>
  );
  const colorField = (key: 'frontColor' | 'spineColor' | 'backColor' | 'textColor') => (
    <label className="field">
      {t(`pageDesign.cover.${key}`)}
      <input type="color" value={`#${cover[key]}`} onChange={(e) => set({ [key]: e.target.value.slice(1).toUpperCase() })} />
    </label>
  );
  const imageField = (key: 'frontImage' | 'backImage') => (
    <label className="field">
      {t(`pageDesign.cover.${key}`)}
      <select value={cover[key] ?? ''} onChange={(e) => set({ [key]: e.target.value || undefined })}>
        <option value="">—</option>
        {images.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </label>
  );

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      const r = await api.saveCover(projectId, { ...cover, title: cover.title || '—' }, replace);
      setCover(r.cover);
      setReadable(true);
      setNotice(t('pageDesign.cover.saved', { spine: r.geometry.spine }));
      onSaved?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const makePdf = async () => {
    setBusy('pdf');
    setError(null);
    try {
      await api.saveCover(projectId, { ...cover, title: cover.title || '—' }, replace);
      setReadable(true);
      onSaved?.();
      const blob = await api.coverPdf(projectId);
      setPdfUrl(URL.createObjectURL(blob));
      setNotice(t('pageDesign.cover.pdfReady'));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="pd-form" data-testid="pd-cover">
      {!readable && (
        <div className="error-message" role="alert">
          {t('pageDesign.cover.unreadable')}
          <label className="check-row">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            {t('pageDesign.cover.replace')}
          </label>
        </div>
      )}
      <fieldset className="pd-side">
        <legend>{t('pageDesign.cover.book')}</legend>
        <div className="pd-row">
          <label className="field">
            {t('pageDesign.cover.format')}
            <select value={cover.format} onChange={(e) => set({ format: e.target.value })} data-testid="pd-cover-format">
              {PRINT_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.width}×{f.height} mm ({f.sheet})
                </option>
              ))}
              <option value="custom">{t('pageDesign.cover.custom')}</option>
            </select>
          </label>
          {cover.format === 'custom' &&
            (['width', 'height'] as const).map((k) => (
              <label className="field" key={k}>
                {t(`pageDesign.cover.${k}`)}
                <input type="number" min={50} max={500} value={cover[k] ?? ''} onChange={(e) => set({ [k]: Number(e.target.value) })} />
              </label>
            ))}
          <label className="field">
            {t('pageDesign.cover.pages')}
            <input
              type="number"
              min={4}
              max={2000}
              value={cover.pages}
              onChange={(e) => set({ pages: Math.max(4, Number(e.target.value) || 4) })}
              data-testid="pd-cover-pages"
            />
          </label>
          {lastPages !== null && lastPages !== cover.pages && (
            <button className="small" onClick={() => set({ pages: lastPages })} data-testid="pd-cover-use-pages">
              {t('pageDesign.cover.usePages', { count: lastPages })}
            </button>
          )}
        </div>
        <div className="pd-row">
          <label className="field">
            {t('pageDesign.cover.binding')}
            <select value={cover.binding} onChange={(e) => set({ binding: e.target.value as Binding })} data-testid="pd-cover-binding">
              {BINDINGS.map((b) => (
                <option key={b} value={b}>
                  {t(`pageDesign.cover.bindings.${b}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t('pageDesign.cover.paper')}
            <select value={cover.paper} onChange={(e) => set({ paper: e.target.value })} data-testid="pd-cover-paper">
              {PAPERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(`pageDesign.cover.papers.${p.kind}`)} {p.gsm} g/m² — {p.thickness} mm
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t('pageDesign.cover.thickness')}
            <input
              type="number"
              min={0.03}
              max={0.5}
              step={0.005}
              value={cover.thickness ?? ''}
              placeholder={String(PAPERS.find((p) => p.id === cover.paper)?.thickness ?? '')}
              onChange={(e) => set({ thickness: e.target.value === '' ? undefined : Number(e.target.value) })}
              data-testid="pd-cover-thickness"
            />
          </label>
          {cover.binding !== 'qattiq' && (
            <label className="field">
              {t('pageDesign.frame.bleed')}
              <input type="number" min={0} max={10} step={0.5} value={cover.bleed} onChange={(e) => set({ bleed: Number(e.target.value) })} />
            </label>
          )}
        </div>
        {geometry && (
          <p className="pd-cover-summary" data-testid="pd-cover-summary">
            {t('pageDesign.cover.summary', {
              spine: geometry.spine,
              w: geometry.page.w,
              h: geometry.page.h,
              sheet: geometry.sheet,
            })}
          </p>
        )}
        {geometry?.warnings.map((w) => (
          <p key={w} className="pd-check-warn" data-testid={`pd-cover-warn-${w}`}>
            ⚠ {t(`pageDesign.cover.warnings.${w}`)}
          </p>
        ))}
        <p className="muted small-print">{t('pageDesign.cover.thicknessHint')}</p>
      </fieldset>
      <fieldset className="pd-side">
        <legend>{t('pageDesign.cover.texts')}</legend>
        <div className="pd-row">
          {textField('title', 200)}
          {textField('subtitle', 300)}
        </div>
        <div className="pd-row">
          {textField('author', 200)}
          {textField('publisher', 200)}
          {textField('isbn', 20)}
        </div>
        <label className="field">
          {t('pageDesign.cover.back')}
          <textarea rows={4} maxLength={3000} value={cover.back ?? ''} onChange={(e) => set({ back: e.target.value || undefined })} />
        </label>
      </fieldset>
      <fieldset className="pd-side">
        <legend>{t('pageDesign.cover.look')}</legend>
        <div className="pd-row">
          {colorField('frontColor')}
          {colorField('spineColor')}
          {colorField('backColor')}
          {colorField('textColor')}
        </div>
        <div className="pd-row">
          {imageField('frontImage')}
          {imageField('backImage')}
        </div>
        <label className="check-row">
          <input type="checkbox" checked={!!cover.cmyk} onChange={(e) => set({ cmyk: e.target.checked || undefined })} />
          {t('pageDesign.cover.cmyk')}
        </label>
      </fieldset>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="muted" data-testid="pd-cover-notice">
          {notice}
        </p>
      )}
      <div className="pd-row">
        {canEdit && (
          <button className="small" disabled={!!busy || (!readable && !replace)} onClick={() => void save()} data-testid="pd-cover-save">
            {t('pageDesign.cover.save')}
          </button>
        )}
        {canEdit && (
          <button className="primary small" disabled={!!busy || (!readable && !replace)} onClick={() => void makePdf()} data-testid="pd-cover-pdf">
            {busy === 'pdf' ? t('pageDesign.cover.making') : t('pageDesign.cover.makePdf')}
          </button>
        )}
        {pdfUrl && (
          <a href={pdfUrl} download="muqova.pdf" target="_blank" rel="noreferrer" data-testid="pd-cover-download">
            {t('pageDesign.cover.download')}
          </a>
        )}
      </div>
    </div>
  );
}
