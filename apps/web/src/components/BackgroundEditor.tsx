import { useTranslation } from 'react-i18next';
import type { BackgroundElement, BackgroundKind } from '@oversells/shared';

const KINDS: BackgroundKind[] = ['rect', 'line', 'image'];
const PICTURE = /\.(png|jpe?g|pdf)$/i;

interface Props {
  elements: BackgroundElement[];
  /** Pictures of the project (paths). */
  pictures: string[];
  canEdit: boolean;
  onChange(elements: BackgroundElement[]): void;
}

/** A new element of a kind: a coloured strip along the inner edge, a rule under the head, a corner picture. */
export function newBackgroundElement(kind: BackgroundKind, picture: string | undefined): BackgroundElement {
  if (kind === 'line') return { kind, x: 20, y: 15, w: 170, h: 0, color: '555555', thickness: 0.5 };
  if (kind === 'image') return { kind, x: 160, y: 260, w: 30, h: 30, file: picture ?? '', mirror: true };
  return { kind, x: 0, y: 0, w: 10, h: 297, color: 'E8D9B5', mirror: true };
}

const num = (v: string): number => (v.trim() === '' ? 0 : Number(v));

/** «Fon elementlari» of a master page: areas, lines and pictures under every page it is used on. */
export function BackgroundEditor({ elements, pictures, canEdit, onChange }: Props) {
  const { t } = useTranslation();
  const images = pictures.filter((p) => PICTURE.test(p));
  const set = (i: number, patch: Partial<BackgroundElement>) => onChange(elements.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const field = (i: number, key: 'x' | 'y' | 'w' | 'h' | 'thickness' | 'transparency', step: number, label: string) => (
    <label className="field" key={key}>
      {label}
      <input
        type="number"
        step={step}
        value={elements[i]![key] ?? ''}
        onChange={(e) => set(i, { [key]: key === 'transparency' && e.target.value === '' ? undefined : num(e.target.value) })}
        data-testid={`pd-bg-${i}-${key}`}
      />
    </label>
  );
  return (
    <fieldset className="pd-side" data-testid="pd-background">
      <legend>{t('pageDesign.background.title')}</legend>
      {elements.map((el, i) => (
        <div key={i} className="pd-bg-item">
          <div className="pd-row">
            <strong>{t(`pageDesign.background.kinds.${el.kind}`)}</strong>
            {el.kind === 'image' ? (
              <label className="field">
                {t('pageDesign.frame.file')}
                <select value={el.file ?? ''} onChange={(e) => set(i, { file: e.target.value })}>
                  {!images.includes(el.file ?? '') && <option value={el.file ?? ''}>{el.file || '—'}</option>}
                  {images.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="field">
                {t('pageDesign.color')}
                <input
                  type="color"
                  value={`#${el.color ?? '000000'}`}
                  onChange={(e) => set(i, { color: e.target.value.slice(1).toUpperCase() })}
                />
              </label>
            )}
            {canEdit && (
              <button className="small" onClick={() => onChange(elements.filter((_, j) => j !== i))} data-testid={`pd-bg-${i}-remove`}>
                {t('pageDesign.remove')}
              </button>
            )}
          </div>
          <div className="pd-row">
            {field(i, 'x', 1, 'x')}
            {field(i, 'y', 1, 'y')}
            {field(i, 'w', 1, el.kind === 'line' ? 'Δx' : t('pageDesign.frame.width'))}
            {field(i, 'h', 1, el.kind === 'line' ? 'Δy' : t('pageDesign.background.height'))}
            {el.kind === 'line' && field(i, 'thickness', 0.1, t('pageDesign.background.thickness'))}
            {field(i, 'transparency', 0.05, t('pageDesign.frame.transparency'))}
          </div>
          <label className="check-row">
            <input type="checkbox" checked={!!el.mirror} onChange={(e) => set(i, { mirror: e.target.checked || undefined })} />
            {t('pageDesign.background.mirror')}
          </label>
        </div>
      ))}
      {canEdit && elements.length < 12 && (
        <div className="pd-row">
          {KINDS.map((k) => (
            <button
              key={k}
              className="small"
              disabled={k === 'image' && !images.length}
              onClick={() => onChange([...elements, newBackgroundElement(k, images[0])])}
              data-testid={`pd-bg-add-${k}`}
            >
              + {t(`pageDesign.background.kinds.${k}`)}
            </button>
          ))}
        </div>
      )}
      <p className="muted small-print">{t('pageDesign.background.hint')}</p>
    </fieldset>
  );
}
