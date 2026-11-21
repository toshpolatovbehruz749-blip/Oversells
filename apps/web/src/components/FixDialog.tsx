import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FIX_RULES, findFixes, segments, type Fix, type FixRule } from '../typography/fix';
import { latinWords } from '../typography/okina-missing';
import type { SpellClient } from '../spell/client';

interface Props {
  /** Text of the open file when the dialog opened. */
  text: string;
  path: string;
  /** Applies the chosen fixes; returns false if the file changed meanwhile. */
  onApply(fixes: Fix[]): boolean;
  onClose(): void;
  /** Finds Uzbek words typed without ʻ (by the dictionary); without it that rule is skipped. */
  spell?: SpellClient;
}

const EXAMPLES = 3;
/** Words without ʻ are each a guess: all of them are shown. */
const EXAMPLES_OF: Partial<Record<FixRule, number>> = { okinaMissing: 50 };

/** Words of the document text (not formulas, not commands) that miss a ʻ, as fixes. */
async function missingOkina(text: string, spell: SpellClient, taken: Fix[]): Promise<Fix[]> {
  const found = segments(text)
    .filter((s) => !s.math)
    .flatMap((s) => latinWords(text, s.from, s.to).filter((w) => w.at + w.word.length <= s.to));
  const fixes = await spell.restoreOkina([...new Set(found.map((w) => w.word))]);
  const overlaps = (from: number, to: number) => taken.some((f) => f.from < to && from < f.to);
  return found
    .filter((w) => fixes[w.word] && !overlaps(w.at, w.at + w.word.length))
    .map((w) => ({ rule: 'okinaMissing' as const, from: w.at, to: w.at + w.word.length, insert: fixes[w.word]! }));
}

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
export function FixDialog({ text, path, onApply, onClose, spell }: Props) {
  const { t } = useTranslation();
  const typing = useMemo(() => findFixes(text), [text]);
  const [okinaFixes, setOkinaFixes] = useState<Fix[]>([]);
  const [checking, setChecking] = useState(!!spell);
  useEffect(() => {
    if (!spell) return;
    let live = true;
    missingOkina(text, spell, typing)
      .then((f) => live && setOkinaFixes(f), () => undefined)
      .finally(() => live && setChecking(false));
    return () => {
      live = false;
    };
  }, [text, spell, typing]);
  const fixes = useMemo(() => [...okinaFixes, ...typing].sort((a, b) => a.from - b.from), [okinaFixes, typing]);
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
        {checking && <p className="muted" data-testid="fix-checking">{t('fix.checking')}</p>}
        {fixes.length === 0 ? (
          !checking &&
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
                      {list.slice(0, EXAMPLES_OF[rule] ?? EXAMPLES).map((f) => (
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
