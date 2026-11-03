import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiLanguage } from '@oversells/shared';
import { api } from '../api/client';
import { errorMessage } from '../i18n';

interface Props {
  lang: AiLanguage;
  onInsert(latex: string): void;
  onUsed(): void;
  onClose(): void;
}

const MAX_BYTES = 5 * 1024 * 1024;

/** "Rasmdan": a picture of a formula (pasted, dropped or chosen) becomes LaTeX via the AI. */
export function ImageFormulaDialog({ lang, onInsert, onUsed, onClose }: Props) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [latex, setLatex] = useState('');
  const [display, setDisplay] = useState(true);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const take = (f: File | null | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return setError(t('imageFormula.type'));
    if (f.size > MAX_BYTES) return setError(t('imageFormula.tooLarge'));
    setError(null);
    setLatex('');
    setNotes('');
    setFile(f);
  };

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Ctrl+V of a screenshot anywhere while the dialog is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      if (item) {
        e.preventDefault();
        take(item.getAsFile());
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const read = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.imageToLatex(file, lang);
      setLatex(r.latex);
      setDisplay(r.display);
      setNotes(r.notes);
      onUsed();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal test-dialog image-formula-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-formula-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        data-testid="image-formula-dialog"
      >
        <h2 id="image-formula-title">{t('imageFormula.title')}</h2>
        <div
          className={`image-drop${preview ? ' has-image' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            take(e.dataTransfer.files[0]);
          }}
          onClick={() => input.current?.click()}
          data-testid="image-drop"
        >
          {preview ? <img src={preview} alt="" /> : <span className="muted">{t('imageFormula.drop')}</span>}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          data-testid="image-input"
          onChange={(e) => take(e.target.files?.[0])}
        />
        {latex && (
          <>
            <label className="field">
              LaTeX
              <textarea value={latex} onChange={(e) => setLatex(e.target.value)} rows={4} spellCheck={false} data-testid="image-latex" />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={display} onChange={(e) => setDisplay(e.target.checked)} />
              {t('imageFormula.display')}
            </label>
            {notes && <p className="muted">{notes}</p>}
          </>
        )}
        {error && <p className="error">{error}</p>}
        <p className="muted small-print">{t('ai.disclaimer')}</p>
        <div className="modal-actions">
          <button onClick={onClose}>{t('dialog.cancel')}</button>
          {!latex ? (
            <button className="primary" disabled={!file || busy} onClick={() => void read()} data-testid="image-read">
              {busy ? t('imageFormula.reading') : t('imageFormula.read')}
            </button>
          ) : (
            <button
              className="primary"
              onClick={() => onInsert(display ? `\\[\n  ${latex}\n\\]\n` : `${latex}\n`)}
              data-testid="image-insert"
            >
              {t('imageFormula.insert')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
