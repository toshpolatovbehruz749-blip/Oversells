import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { diffLines } from 'diff';
import type { AiFixDTO } from '@oversells/shared';
import { DiffLines } from './DiffLines';

interface Props {
  fix: AiFixDTO;
  onAccept(): void;
  onClose(): void;
}

/** Shows an AI-suggested fix as a line diff; nothing changes until it is accepted. */
export function AiFixDialog({ fix, onAccept, onClose }: Props) {
  const { t } = useTranslation();
  const parts = useMemo(() => diffLines(`${fix.original}\n`, `${fix.suggestion}\n`), [fix]);
  const changed = fix.original !== fix.suggestion;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal ai-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-fix-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        data-testid="ai-fix-dialog"
      >
        <h2 id="ai-fix-title">{t('ai.fixTitle')}</h2>
        <p className="ai-explanation">{fix.explanation}</p>
        <div className="file-diff" data-testid="ai-fix-diff">
          <div className="file-diff-title">{t('ai.fixLines', { path: fix.path, from: fix.startLine, to: fix.endLine })}</div>
          {changed ? <DiffLines parts={parts} /> : <p className="muted">{t('ai.noChange')}</p>}
        </div>
        <p className="muted small-print">{t('ai.disclaimer')}</p>
        <div className="modal-actions">
          <button onClick={onClose}>{t('ai.reject')}</button>
          {changed && (
            <button className="primary" onClick={onAccept} autoFocus>
              {t('ai.accept')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
