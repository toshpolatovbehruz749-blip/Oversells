import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SNIPPETS, type Snippet } from '../designs/snippets';

interface Props {
  /** The project loads the design package (the snippets need it). */
  hasDesign: boolean;
  onInsert(code: string): void;
  onChooseDesign(): void;
  onClose(): void;
}

const GROUPS: Snippet['group'][] = ['boxes', 'formulas', 'drawings'];

/** "Chizma va formulalar": ready-made boxes, formulas and drawings inserted at the cursor. */
export function SnippetMenu({ hasDesign, onInsert, onChooseDesign, onClose }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="snippet-menu" ref={ref} role="menu" data-testid="snippet-menu">
      {!hasDesign && (
        <div className="snippet-hint">
          {t('snippets.needsDesign')}{' '}
          <button className="link-button" onClick={onChooseDesign}>
            {t('snippets.chooseDesign')}
          </button>
        </div>
      )}
      {GROUPS.map((g) => (
        <section key={g}>
          <h4>{t(`snippets.group.${g}`)}</h4>
          <div className="snippet-grid">
            {SNIPPETS.filter((s) => s.group === g).map((s) => (
              <button
                key={s.id}
                role="menuitem"
                className="snippet"
                data-snippet={s.id}
                onClick={() => {
                  onInsert(s.code);
                  onClose();
                }}
              >
                <span className="snippet-icon" aria-hidden="true">
                  {s.icon}
                </span>
                {t(`snippets.item.${s.id}`)}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
