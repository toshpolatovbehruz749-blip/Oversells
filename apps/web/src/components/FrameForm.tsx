import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { escapeLatex } from '@oversells/shared';

type Mode = 'oqim' | 'oralash' | 'sahifa' | 'tola';
const MODES: Mode[] = ['oqim', 'oralash', 'sahifa', 'tola'];

interface Props {
  /** Pictures of the project (paths). */
  pictures: string[];
  canEdit: boolean;
  /** Puts the code at the cursor of the code editor. */
  onInsert(code: string): void;
}

const mm = (v: string) => (v.trim() === '' ? null : `${Number(v)}mm`);

/** \rasmramka[keys]{file}{caption} from the form; on lines of its own. */
export function frameCode(f: {
  file: string;
  mode: Mode;
  width: string;
  side: 'chap' | 'ong';
  x: string;
  y: string;
  bleed: string;
  crop: [string, string, string, string];
  caption: string;
}): string {
  const keys = [`joy=${f.mode}`];
  if (f.mode !== 'tola' && mm(f.width)) keys.push(`en=${mm(f.width)}`);
  if (f.mode === 'oralash') keys.push(`tomon=${f.side}`);
  if (f.mode === 'sahifa') keys.push(`x=${mm(f.x) ?? '0mm'}`, `y=${mm(f.y) ?? '0mm'}`);
  if (f.mode === 'tola' && mm(f.bleed)) keys.push(`bleed=${mm(f.bleed)}`);
  if (f.crop.some((c) => c.trim() !== '' && Number(c) !== 0)) keys.push(`kesish=${f.crop.map((c) => mm(c) ?? '0mm').join(' ')}`);
  const caption = f.mode === 'tola' ? '' : escapeLatex(f.caption.trim());
  return `\n\\rasmramka[${keys.join(',')}]{${f.file}}{${caption}}\n`;
}

/** «Rasm»: a picture frame (in the text, beside it, fixed on the page or a whole page) at the cursor. */
export function FrameForm({ pictures, canEdit, onInsert }: Props) {
  const { t } = useTranslation();
  const [file, setFile] = useState(pictures[0] ?? '');
  const [mode, setMode] = useState<Mode>('oqim');
  const [width, setWidth] = useState('');
  const [side, setSide] = useState<'chap' | 'ong'>('ong');
  const [x, setX] = useState('20');
  const [y, setY] = useState('20');
  const [bleed, setBleed] = useState('3');
  const [crop, setCrop] = useState<[string, string, string, string]>(['', '', '', '']);
  const [caption, setCaption] = useState('');
  const [inserted, setInserted] = useState(false);

  if (!pictures.length) return <p className="muted">{t('pageDesign.frame.noPictures')}</p>;
  return (
    <div className="pd-form" data-testid="pd-frame-form">
      <label className="field">
        {t('pageDesign.frame.file')}
        <select value={file} onChange={(e) => setFile(e.target.value)} data-testid="pd-frame-file">
          {pictures.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        {t('pageDesign.frame.mode')}
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} data-testid="pd-frame-mode">
          {MODES.map((m) => (
            <option key={m} value={m}>
              {t(`pageDesign.frame.modes.${m}`)}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small-print">{t(`pageDesign.frame.hints.${mode}`)}</p>
      <div className="pd-row">
        {mode !== 'tola' && (
          <label className="field">
            {t('pageDesign.frame.width')}
            <input type="number" min={5} step={1} value={width} placeholder={t('pageDesign.frame.auto')} onChange={(e) => setWidth(e.target.value)} />
          </label>
        )}
        {mode === 'oralash' && (
          <label className="field">
            {t('pageDesign.frame.side')}
            <select value={side} onChange={(e) => setSide(e.target.value as 'chap' | 'ong')}>
              <option value="chap">{t('pageDesign.frame.left')}</option>
              <option value="ong">{t('pageDesign.frame.right')}</option>
            </select>
          </label>
        )}
        {mode === 'sahifa' && (
          <>
            <label className="field">
              {t('pageDesign.frame.x')}
              <input type="number" step={1} value={x} onChange={(e) => setX(e.target.value)} />
            </label>
            <label className="field">
              {t('pageDesign.frame.y')}
              <input type="number" step={1} value={y} onChange={(e) => setY(e.target.value)} />
            </label>
          </>
        )}
        {mode === 'tola' && (
          <label className="field">
            {t('pageDesign.frame.bleed')}
            <input type="number" min={0} step={0.5} value={bleed} onChange={(e) => setBleed(e.target.value)} />
          </label>
        )}
      </div>
      <fieldset className="pd-side">
        <legend>{t('pageDesign.frame.crop')}</legend>
        <div className="pd-row">
          {(['left', 'bottom', 'right', 'top'] as const).map((k, i) => (
            <label key={k} className="field">
              {t(`pageDesign.frame.edge.${k}`)}
              <input
                type="number"
                min={0}
                step={1}
                value={crop[i]}
                onChange={(e) => setCrop(crop.map((c, j) => (j === i ? e.target.value : c)) as [string, string, string, string])}
              />
            </label>
          ))}
        </div>
      </fieldset>
      {mode !== 'tola' && (
        <label className="field">
          {t('pageDesign.frame.caption')}
          <input value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)} data-testid="pd-frame-caption" />
        </label>
      )}
      {canEdit && (
        <button
          className="primary"
          onClick={() => {
            onInsert(frameCode({ file, mode, width, side, x, y, bleed, crop, caption }));
            setInserted(true);
          }}
          data-testid="pd-frame-insert"
        >
          {t('pageDesign.frame.insert')}
        </button>
      )}
      {inserted && <p className="muted">{t('pageDesign.frame.inserted')}</p>}
    </div>
  );
}
