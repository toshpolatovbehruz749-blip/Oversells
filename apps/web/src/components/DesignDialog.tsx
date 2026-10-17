import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DESIGN_BOXES,
  DESIGN_DRAWINGS,
  DESIGN_HEADERS,
  DESIGN_HEADINGS,
  DESIGN_LANGUAGES,
  DESIGN_MARGINS,
  DESIGN_MATH_FONTS,
  DESIGN_TEXT_FONTS,
  type AiLanguage,
  type DesignDTO,
  type DesignLanguage,
  type DesignSpec,
} from '@oversells/shared';
import { api } from '../api/client';
import { errorMessage } from '../i18n';
import { useDialog } from './Dialog';

interface Props {
  projectId: string;
  currentDesignId: string | null;
  defaultLang: DesignLanguage;
  aiEnabled: boolean;
  aiLang: AiLanguage;
  /** Called after a design was applied (the editor reloads and compiles). */
  onApplied(): void;
  onClose(): void;
}

type Tab = 'gallery' | 'editor' | 'book';

/** Preview image that may take a few seconds (the server compiles the showcase). */
function Preview({ src, alt }: { src: string; alt: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  useEffect(() => setState('loading'), [src]);
  return (
    <div className={`design-preview preview-${state}`}>
      {state === 'loading' && <span className="muted">{t('designs.rendering')}</span>}
      {state === 'error' && <span className="muted">{t('designs.previewFailed')}</span>}
      <img src={src} alt={alt} onLoad={() => setState('ok')} onError={() => setState('error')} />
    </div>
  );
}

function SpecEditor({ spec, onChange }: { spec: DesignSpec; onChange(s: DesignSpec): void }) {
  const { t } = useTranslation();
  const set = <K extends keyof DesignSpec>(key: K, value: DesignSpec[K]) => onChange({ ...spec, [key]: value });
  const select = <T extends string>(label: string, value: T, options: readonly T[], change: (v: T) => void, labelOf?: (v: T) => string) => (
    <label>
      {label}
      <select value={value} onChange={(e) => change(e.target.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {labelOf ? labelOf(o) : o}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="spec-editor" data-testid="spec-editor">
      <fieldset>
        <legend>{t('designs.fonts')}</legend>
        {select(t('designs.bodyFont'), spec.fonts.body, DESIGN_TEXT_FONTS, (v) => set('fonts', { ...spec.fonts, body: v }))}
        {select(t('designs.headingFont'), spec.fonts.heading, DESIGN_TEXT_FONTS, (v) => set('fonts', { ...spec.fonts, heading: v }))}
        {select(t('designs.mathFont'), spec.fonts.math, DESIGN_MATH_FONTS, (v) => set('fonts', { ...spec.fonts, math: v }))}
        {select(t('designs.size'), String(spec.fonts.size) as '10' | '11' | '12', ['10', '11', '12'] as const, (v) =>
          set('fonts', { ...spec.fonts, size: Number(v) as 10 | 11 | 12 }),
        (v) => `${v} pt`)}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={spec.fonts.mathLetters === 'text'}
            onChange={(e) => set('fonts', { ...spec.fonts, mathLetters: e.target.checked ? 'text' : 'math' })}
          />
          {t('designs.mathLetters')}
        </label>
      </fieldset>
      <fieldset>
        <legend>{t('designs.colors')}</legend>
        {(['primary', 'secondary', 'accent', 'ink'] as const).map((c) => (
          <label key={c} className="color-field">
            <input
              type="color"
              value={spec.colors[c]}
              onChange={(e) => set('colors', { ...spec.colors, [c]: e.target.value.toUpperCase() })}
              aria-label={t(`designs.color.${c}`)}
            />
            {t(`designs.color.${c}`)}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{t('designs.layout')}</legend>
        {select(t('designs.headings'), spec.headings, DESIGN_HEADINGS, (v) => set('headings', v), (v) => t(`designs.headingStyle.${v}`))}
        {select(t('designs.boxes'), spec.boxes, DESIGN_BOXES, (v) => set('boxes', v), (v) => t(`designs.boxStyle.${v}`))}
        {select(t('designs.margins'), spec.page.margins, DESIGN_MARGINS, (v) => set('page', { ...spec.page, margins: v }), (v) => t(`designs.marginStyle.${v}`))}
        {select(t('designs.header'), spec.page.header, DESIGN_HEADERS, (v) => set('page', { ...spec.page, header: v }), (v) => t(`designs.headerStyle.${v}`))}
        {select(t('designs.drawings'), spec.drawings, DESIGN_DRAWINGS, (v) => set('drawings', v), (v) => t(`designs.drawingStyle.${v}`))}
        <label className="checkbox">
          <input type="checkbox" checked={spec.icons} onChange={(e) => set('icons', e.target.checked)} />
          {t('designs.icons')}
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={spec.titleBanner} onChange={(e) => set('titleBanner', e.target.checked)} />
          {t('designs.titleBanner')}
        </label>
      </fieldset>
    </div>
  );
}

/**
 * "Dizayn": choose one of the designs (built-in or your own) for the
 * project, make a new one with a live preview, or let the AI derive one
 * from pages of an existing book.
 */
export function DesignDialog({ projectId, currentDesignId, defaultLang, aiEnabled, aiLang, onApplied, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const dialog = useDialog();
  const lng = (i18n.language === 'ru' || i18n.language === 'en' ? i18n.language : 'uz') as 'uz' | 'ru' | 'en';
  const [tab, setTab] = useState<Tab>('gallery');
  const [designs, setDesigns] = useState<DesignDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lang, setLang] = useState<DesignLanguage>(defaultLang);
  // Editor state
  const [editing, setEditing] = useState<{ id: string | null; name: string; spec: DesignSpec; notes?: string } | null>(null);
  const [previewHash, setPreviewHash] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewSeq = useRef(0);
  // Book state
  const [bookFiles, setBookFiles] = useState<File[]>([]);
  const [wishes, setWishes] = useState('');

  const load = useCallback(() => {
    api.designs().then(setDesigns, (err) => setError(errorMessage(err)));
  }, []);
  useEffect(load, [load]);

  // Live preview of the design being edited (debounced; the server compiles it).
  useEffect(() => {
    if (!editing) return;
    const seq = ++previewSeq.current;
    setPreviewing(true);
    const timer = setTimeout(() => {
      api.previewDesignSpec(editing.spec).then(
        (hash) => {
          if (seq === previewSeq.current) {
            setPreviewHash(hash);
            setPreviewing(false);
          }
        },
        (err) => {
          if (seq === previewSeq.current) {
            setError(errorMessage(err));
            setPreviewing(false);
          }
        },
      );
    }, 900);
    return () => clearTimeout(timer);
  }, [editing?.spec]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async (d: DesignDTO) => {
    setBusy(d.id);
    setError(null);
    try {
      await api.applyDesign(projectId, d.id, lang);
      onApplied();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const startEditing = (from: DesignDTO, copy: boolean) => {
    setEditing({ id: copy ? null : from.id, name: copy ? `${from.name[lng]} (2)` : from.name[lng], spec: from.spec });
    setPreviewHash(from.hash);
    setTab('editor');
  };

  const save = async () => {
    if (!editing) return;
    setBusy('save');
    setError(null);
    try {
      const saved = editing.id
        ? await api.updateDesign(editing.id, { name: editing.name, spec: editing.spec })
        : await api.createDesign(editing.name, editing.spec);
      setEditing({ ...editing, id: saved.id });
      load();
      setTab('gallery');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (d: DesignDTO) => {
    if (!(await dialog.confirm(t('designs.confirmDelete', { name: d.name[lng] })))) return;
    try {
      await api.deleteDesign(d.id);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const fromBook = async () => {
    setBusy('book');
    setError(null);
    try {
      const r = await api.designFromBook(bookFiles, wishes, aiLang);
      setEditing({ id: null, name: r.name, spec: r.spec, notes: r.notes });
      setPreviewHash(null);
      setTab('editor');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const tabs: Tab[] = aiEnabled ? ['gallery', 'editor', 'book'] : ['gallery', 'editor'];

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal design-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="design-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        data-testid="design-dialog"
      >
        <div className="design-head">
          <h2 id="design-title">🎨 {t('designs.title')}</h2>
          <label className="inline-field">
            {t('designs.titlesLanguage')}
            <select value={lang} onChange={(e) => setLang(e.target.value as DesignLanguage)} data-testid="design-lang">
              {DESIGN_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {t(`spell.lang.${l}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="side-tabs" role="tablist">
          {tabs.map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              className={tab === k ? 'active' : ''}
              onClick={() => {
                if (k === 'editor' && !editing && designs?.[0]) startEditing(designs[0], true);
                else setTab(k);
              }}
            >
              {t(`designs.tab.${k}`)}
            </button>
          ))}
        </div>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}

        {tab === 'gallery' && (
          <div className="design-grid" data-testid="design-grid">
            {designs === null && <p className="muted">{t('pdf.loading')}</p>}
            {designs?.map((d) => (
              <article key={d.id} className={`design-card${d.id === currentDesignId ? ' current' : ''}`} data-design={d.id}>
                <Preview src={api.designPreviewUrl(d)} alt={d.name[lng]} />
                <div className="design-card-body">
                  <h3>
                    {d.name[lng]} {d.id === currentDesignId && <span className="role-badge">{t('designs.current')}</span>}
                    {!d.builtIn && <span className="role-badge">{t('designs.mine')}</span>}
                  </h3>
                  {d.description[lng] && <p className="muted">{d.description[lng]}</p>}
                  <div className="design-actions">
                    <button className="primary" disabled={busy !== null} onClick={() => void apply(d)}>
                      {busy === d.id ? t('designs.applying') : t('designs.apply')}
                    </button>
                    <a className="button" href={api.designPdfUrl(d)} target="_blank" rel="noreferrer">
                      PDF
                    </a>
                    <button onClick={() => startEditing(d, d.builtIn)} title={t('designs.customize')}>
                      {d.builtIn ? t('designs.customize') : t('designs.edit')}
                    </button>
                    {!d.builtIn && (
                      <button className="danger" onClick={() => void remove(d)}>
                        {t('designs.delete')}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {tab === 'editor' && editing && (
          <div className="design-editor">
            <div>
              <label className="name-field">
                {t('designs.name')}
                <input value={editing.name} maxLength={100} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </label>
              {editing.notes && <p className="ai-explanation">{editing.notes}</p>}
              <SpecEditor spec={editing.spec} onChange={(spec) => setEditing({ ...editing, spec })} />
              <div className="modal-actions">
                <button className="primary" disabled={busy !== null || !editing.name.trim()} onClick={() => void save()}>
                  {t('designs.save')}
                </button>
              </div>
            </div>
            <div className="design-live">
              {previewHash ? (
                <Preview src={api.previewByHashUrl(previewHash, 'png')} alt={editing.name} />
              ) : (
                <div className="design-preview preview-loading">
                  <span className="muted">{t('designs.rendering')}</span>
                </div>
              )}
              <p className="muted small-print">
                {previewing ? t('designs.updating') : t('designs.livePreview')}{' '}
                {previewHash && (
                  <a href={api.previewByHashUrl(previewHash, 'pdf')} target="_blank" rel="noreferrer">
                    PDF
                  </a>
                )}
              </p>
            </div>
          </div>
        )}

        {tab === 'book' && (
          <div className="design-book">
            <p>{t('designs.bookHelp')}</p>
            <input
              type="file"
              multiple
              accept="application/pdf,image/png,image/jpeg,image/webp"
              aria-label={t('designs.bookFiles')}
              onChange={(e) => setBookFiles([...(e.target.files ?? [])].slice(0, 5))}
            />
            <label>
              {t('designs.wishes')}
              <textarea rows={3} maxLength={1000} value={wishes} placeholder={t('designs.wishesPlaceholder')} onChange={(e) => setWishes(e.target.value)} />
            </label>
            <p className="muted small-print">{t('designs.bookPrivacy')}</p>
            <button className="primary" disabled={bookFiles.length === 0 || busy !== null} onClick={() => void fromBook()}>
              {busy === 'book' ? t('ai.thinking') : t('designs.fromBook')}
            </button>
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>{t('share.close')}</button>
        </div>
      </div>
    </div>
  );
}
