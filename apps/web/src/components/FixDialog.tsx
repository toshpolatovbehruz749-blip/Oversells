import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FIX_RULES, findFixes, type Fix, type FixRule } from '../typography/fix';

interface Props {
  /** Text of the open file when the dialog opened. */
  text: string;
  path: string;
  /** Applies the chosen fixes; returns false if the file changed meanwhile. */
  onApply(fixes: Fix[]): boolean;
  onClose(): void;
}

const EXAMPLES = 3;

/** One example: a few characters around the fix, old -> new. */
function Example({ text, fix }: { text: string; fix: Fix }) {
  const before = text.slice(Math.max(0, fix.from - 18), fix.from).replace(/^\S*\s/, '').replace(/\n/g, ' ');
  const after = text.slice(fix.to, fix.to + 18).replace(/\s\S*$/, '').replace(/\n/g, ' ');
  return (
    <li className="fix-example">
      …{before}
      <del>{text.slice(fix.from, fix.to) || '·'}</del>
      <ins>{fix.insert || '∅'}</ins>
      {after}…
    </li>
  );
}

/** "Tuzatish": typing mistakes found in the open file, fixed by kind. */
export function FixDialog({ text, path, onApply, onClose }: Props) {
  const { t } = useTranslation();
  const fixes = useMemo(() => findFixes(text), [text]);
  const byRule = useMemo(() => {
    const m = new Map<FixRule, Fix[]>();
    for (const f of fixes) m.set(f.rule, [...(m.get(f.rule) ?? []), f]);
    return m;
  }, [fixes]);
  const [off, setOff] = useState<Set<FixRule>>(new Set());
  const [stale, setStale] = useState(false);
  const chosen = fixes.filter((f) => !off.has(f.rule));

  const toggle = (rule: FixRule) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(rule)) next.delete(rule);
      else next.add(rule);
      return next;
    });

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal fix-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fix-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        data-testid="fix-dialog"
      >
        <h2 id="fix-title">{t('fix.title', { path })}</h2>
        {fixes.length === 0 ? (
          <p data-testid="fix-none">{t('fix.none')}</p>
        ) : (
          <>
            <p className="muted">{t('fix.intro')}</p>
            <ul className="fix-rules">
              {FIX_RULES.filter((r) => byRule.has(r)).map((rule) => {
                const list = byRule.get(rule)!;
                return (
                  <li key={rule} data-rule={rule}>
                    <label>
                      <input type="checkbox" checked={!off.has(rule)} onChange={() => toggle(rule)} />
                      <strong>{t(`fix.rule.${rule}`)}</strong> <span className="muted">({list.length})</span>
                    </label>
                    <ul>
                      {list.slice(0, EXAMPLES).map((f) => (
                        <Example key={f.from} text={text} fix={f} />
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {stale && <p className="error">{t('fix.stale')}</p>}
        <div className="modal-actions">
          <button onClick={onClose}>{t('dialog.cancel')}</button>
          {chosen.length > 0 && (
            <button
              className="primary"
              data-testid="fix-apply"
              autoFocus
              onClick={() => {
                if (onApply(chosen)) onClose();
                else setStale(true);
              }}
            >
              {t('fix.apply', { count: chosen.length })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
