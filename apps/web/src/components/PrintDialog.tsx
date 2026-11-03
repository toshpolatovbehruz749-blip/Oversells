import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isbnDigits, PRINT_FORMATS, type PrintSpec } from '@oversells/shared';

interface Props {
  busy: boolean;
  /** The project already has print settings (bosma.sty). */
  active: boolean;
  onApply(spec: PrintSpec): void;
  onRemove(): void;
  onClose(): void;
}

/** "Bosmaxona": page format, crop marks, CMYK, ISBN barcode for the printing house. */
export function PrintDialog({ busy, active, onApply, onRemove, onClose }: Props) {
  const { t } = useTranslation();
  const [spec, setSpec] = useState<PrintSpec>({ format: '60x84-16', marks: true, cmyk: true, isbn: '' });
  const isbnBad = !!spec.isbn?.trim() && !isbnDigits(spec.isbn);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal test-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="print-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        data-testid="print-dialog"
      >
        <h2 id="print-title">{t('print.title')}</h2>
        <p className="muted">{t('print.intro')}</p>
        <label className="field">
          {t('print.format')}
          <select value={spec.format} onChange={(e) => setSpec({ ...spec, format: e.target.value })} data-testid="print-format">
            {PRINT_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.width}×{f.height} mm — {f.sheet}
              </option>
            ))}
          </select>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={spec.marks} onChange={(e) => setSpec({ ...spec, marks: e.target.checked })} />
          {t('print.marks')}
        </label>
        <label className="check-row">
          <input type="checkbox" checked={spec.cmyk} onChange={(e) => setSpec({ ...spec, cmyk: e.target.checked })} />
          {t('print.cmyk')}
        </label>
        <label className="field">
          ISBN
          <input
            value={spec.isbn}
            placeholder="978-9943-..."
            onChange={(e) => setSpec({ ...spec, isbn: e.target.value })}
            aria-invalid={isbnBad}
            data-testid="print-isbn"
          />
        </label>
        {isbnBad && <p className="error">{t('print.isbnBad')}</p>}
        <p className="muted small-print">{t('print.colophonHint')}</p>
        <pre className="test-example">{String.raw`\nashrmalumotlari{muallif=..., nomi=..., turi=darslik,
  uok=..., kbk=..., nashriyot=..., sana=14.10.2026,
  adadi=1000, buyurtma=...}`}</pre>
        <div className="modal-actions">
          {active && (
            <button onClick={onRemove} disabled={busy} data-testid="print-remove">
              {t('print.remove')}
            </button>
          )}
          <button onClick={onClose}>{t('dialog.cancel')}</button>
          <button className="primary" disabled={busy || isbnBad} onClick={() => onApply({ ...spec, isbn: spec.isbn?.trim() || undefined })} data-testid="print-apply">
            {t('print.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
