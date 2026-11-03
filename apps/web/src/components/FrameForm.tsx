import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { escapeLatex } from '@oversells/shared';

type Mode = 'oqim' | 'oralash' | 'sahifa' | 'tola' | 'fon' | 'yoyilma';
const MODES: Mode[] = ['oqim', 'oralash', 'sahifa', 'tola', 'fon', 'yoyilma'];

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
  const page = f.mode === 'tola' || f.mode === 'fon' || f.mode === 'yoyilma';
  if (!page && mm(f.width)) keys.push(`en=${mm(f.width)}`);
  if (f.mode === 'oralash') keys.push(`tomon=${f.side}`);
  if (f.mode === 'sahifa') keys.push(`x=${mm(f.x) ?? '0mm'}`, `y=${mm(f.y) ?? '0mm'}`);
  if (page && mm(f.bleed)) keys.push(`bleed=${mm(f.bleed)}`);
  if (f.crop.some((c) => c.trim() !== '' && Number(c) !== 0)) keys.push(`kesish=${f.crop.map((c) => mm(c) ?? '0mm').join(' ')}`);
  const caption = page ? '' : escapeLatex(f.caption.trim());
  return `\n\\rasmramka[${keys.join(',')}]{${f.file}}{${caption}}\n`;
}

/** A text box fixed on the page (over a background picture), with its keys. */
export function textBoxCode(b: { x: string; y: string; width: string; fill: string; transparency: string }): string {
  const keys = [`x=${mm(b.x) ?? '20mm'}`, `y=${mm(b.y) ?? '20mm'}`, `en=${mm(b.width) ?? '80mm'}`];
  const fill = b.fill.replace(/^#/, '').toUpperCase();
  if (/^[0-9A-F]{6}$/.test(fill)) keys.push(`fon=${fill}`);
  const t = Number(b.transparency);
  if (b.transparency.trim() !== '' && t > 0 && t <= 1) keys.push(`shaffof=${t}`);
  return `\n\\begin{matnquti}[${keys.join(',')}]\nMatn\n\\end{matnquti}\n`;
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
  const [box, setBox] = useState({ x: '20', y: '20', width: '120', fill: '#ffffff', transparency: '0.15' });

  return (
    <div className="pd-form" data-testid="pd-frame-form">
      {!pictures.length && <p className="muted">{t('pageDesign.frame.noPictures')}</p>}
      {pictures.length > 0 && (
        <>
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
            {mode !== 'tola' && mode !== 'fon' && mode !== 'yoyilma' && (
              <label className="field">
                {t('pageDesign.frame.width')}
                <input
                  type="number"
                  min={5}
                  step={1}
                  value={width}
                  placeholder={t('pageDesign.frame.auto')}
                  onChange={(e) => setWidth(e.target.value)}
                />
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
            {(mode === 'tola' || mode === 'fon' || mode === 'yoyilma') && (
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
          {mode !== 'tola' && mode !== 'fon' && mode !== 'yoyilma' && (
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
        </>
      )}
      <fieldset className="pd-side">
        <legend>{t('pageDesign.frame.textBox')}</legend>
        <p className="muted small-print">{t('pageDesign.frame.textBoxHint')}</p>
        <div className="pd-row">
          <label className="field">
            {t('pageDesign.frame.x')}
            <input type="number" step={1} value={box.x} onChange={(e) => setBox({ ...box, x: e.target.value })} />
          </label>
          <label className="field">
            {t('pageDesign.frame.y')}
            <input type="number" step={1} value={box.y} onChange={(e) => setBox({ ...box, y: e.target.value })} />
          </label>
          <label className="field">
            {t('pageDesign.frame.width')}
            <input type="number" step={1} value={box.width} onChange={(e) => setBox({ ...box, width: e.target.value })} />
          </label>
          <label className="field">
            {t('pageDesign.color')}
            <input type="color" value={box.fill} onChange={(e) => setBox({ ...box, fill: e.target.value })} />
          </label>
          <label className="field">
            {t('pageDesign.frame.transparency')}
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={box.transparency}
              onChange={(e) => setBox({ ...box, transparency: e.target.value })}
            />
          </label>
        </div>
        {canEdit && (
          <button className="small" onClick={() => onInsert(textBoxCode(box))} data-testid="pd-textbox-insert">
            {t('pageDesign.frame.insertTextBox')}
          </button>
        )}
      </fieldset>
    </div>
  );
}
