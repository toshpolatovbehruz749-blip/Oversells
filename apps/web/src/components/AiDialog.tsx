import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EXERCISE_LEVELS, type AiLanguage, type AiSnippetDTO, type ExerciseLevel } from '@oversells/shared';
import { api } from '../api/client';
import { errorMessage } from '../i18n';

interface Props {
  projectId: string;
  lang: AiLanguage;
  remaining: number | null;
  onInsert(latex: string, preamble: string[]): void;
  /** Called after each request (the quota changed). */
  onUsed(): void;
  onClose(): void;
}

type Tab = 'exercises' | 'tikz';

/** "Generate exercises" and "TikZ from description"; the result is inserted at the cursor. */
export function AiDialog({ projectId, lang, remaining, onInsert, onUsed, onClose }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('exercises');
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(5);
  const [level, setLevel] = useState<ExerciseLevel>('medium');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiSnippetDTO | null>(null);
  const [addPreamble, setAddPreamble] = useState(true);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r =
        tab === 'exercises'
          ? await api.aiExercises(projectId, { topic, count, level, lang })
          : await api.aiTikz(projectId, { description, lang });
      setResult(r);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      onUsed();
    }
  };

  const canGenerate = !busy && (tab === 'exercises' ? topic.trim().length >= 2 : description.trim().length >= 3);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal ai-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        data-testid="ai-dialog"
      >
        <h2 id="ai-title">✨ {t('ai.button')}</h2>
        <div className="side-tabs" role="tablist">
          {(['exercises', 'tikz'] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              className={tab === k ? 'active' : ''}
              onClick={() => {
                setTab(k);
                setResult(null);
                setError(null);
              }}
            >
              {t(k === 'exercises' ? 'ai.tabExercises' : 'ai.tabTikz')}
            </button>
          ))}
        </div>
        <form
          className="ai-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canGenerate) void generate();
          }}
        >
          {tab === 'exercises' ? (
            <>
              <label>
                {t('ai.topic')}
                <input value={topic} maxLength={500} placeholder={t('ai.topicPlaceholder')} onChange={(e) => setTopic(e.target.value)} autoFocus />
              </label>
              <div className="ai-row">
                <label>
                  {t('ai.count')}
                  <input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Math.min(20, Math.max(1, Number(e.target.value) || 1)))} />
                </label>
                <label>
                  {t('ai.level')}
                  <select value={level} onChange={(e) => setLevel(e.target.value as ExerciseLevel)}>
                    {EXERCISE_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {t(`ai.levels.${l}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          ) : (
            <label>
              {t('ai.description')}
              <textarea
                rows={4}
                value={description}
                maxLength={2000}
                placeholder={t('ai.descriptionPlaceholder')}
                onChange={(e) => setDescription(e.target.value)}
                autoFocus
              />
            </label>
          )}
          <div className="ai-row">
            <button type="submit" className="primary" disabled={!canGenerate}>
              {busy ? t('ai.thinking') : t('ai.generate')}
            </button>
            {remaining !== null && <span className="muted">{t('ai.remaining', { count: remaining })}</span>}
          </div>
        </form>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {result && (
          <div className="ai-result">
            <h3>{t('ai.preview')}</h3>
            <pre data-testid="ai-result">{result.latex}</pre>
            {result.preambleAdditions.length > 0 && (
              <label className="checkbox">
                <input type="checkbox" checked={addPreamble} onChange={(e) => setAddPreamble(e.target.checked)} />
                {t('ai.addPreamble', { lines: result.preambleAdditions.join(', ') })}
              </label>
            )}
            <p className="muted small-print">{t('ai.disclaimer')}</p>
          </div>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>{t('share.close')}</button>
          {result && (
            <button className="primary" onClick={() => onInsert(result.latex, addPreamble ? result.preambleAdditions : [])}>
              {t('ai.insert')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
