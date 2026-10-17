import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { explainError, type CompileJobDTO, type ErrorHelp, type LogEntry, type LogLevel, type QuickFix } from '@oversells/shared';
import { errorMessage } from '../i18n';

/** AI actions on error entries (absent when AI is off or the user is anonymous). */
export interface LogPanelAi {
  canFix: boolean;
  explain(index: number): Promise<string>;
  fix(index: number): Promise<void>;
}

interface Props {
  job: CompileJobDTO | null;
  logUrl: string | null;
  onJump(entry: LogEntry): void;
  ai?: LogPanelAi;
  /** Applies a one-click fix of an entry (absent for viewers). */
  onQuickFix?(entry: LogEntry, fix: QuickFix): void;
}

/** Message values, plus each one in braces ({{pkgArg}} = "{graphicx}") for \\usepackage{...} in the texts. */
function helpParams(help: ErrorHelp | QuickFix): Record<string, string> {
  const values: Record<string, string> = 'params' in help ? help.params : (help as Record<string, string>);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v !== 'string') continue;
    out[k] = v;
    out[`${k}Arg`] = `{${v}}`;
  }
  return out;
}

type AiState = { busy: 'explain' | 'fix' | null; explanation?: string; error?: string };

const LEVELS: LogLevel[] = ['error', 'warning', 'typesetting'];

/** Compile status plus the parsed errors/warnings; clicking an entry jumps to its line. */
export function LogPanel({ job, logUrl, onJump, ai, onQuickFix }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Record<LogLevel, boolean>>({ error: true, warning: true, typesetting: false });
  // Keyed by job and entry index, so a new compile starts clean.
  const [aiState, setAiState] = useState<Record<string, AiState>>({});
  if (!job) return null;

  const runAi = async (index: number, kind: 'explain' | 'fix') => {
    if (!ai) return;
    const key = `${job.id}:${index}`;
    setAiState((s) => ({ ...s, [key]: { ...s[key], busy: kind, error: undefined } }));
    try {
      if (kind === 'explain') {
        const explanation = await ai.explain(index);
        setAiState((s) => ({ ...s, [key]: { busy: null, explanation } }));
      } else {
        await ai.fix(index);
        setAiState((s) => ({ ...s, [key]: { ...s[key], busy: null } }));
      }
    } catch (err) {
      setAiState((s) => ({ ...s, [key]: { ...s[key], busy: null, error: errorMessage(err) } }));
    }
  };

  const byLevel = (level: LogLevel) => job.entries.filter((e) => e.level === level);
  const errors = byLevel('error').length;
  const labels: Record<LogLevel, string> = {
    error: t('log.errors'),
    warning: t('log.warnings'),
    typesetting: t('log.typesetting'),
  };

  return (
    <section className="log-panel" aria-label={t('log.title')} data-testid="log-panel">
      <header className={`log-status status-${job.status}`}>
        <strong data-testid="compile-status">{t(`log.status.${job.status}`)}</strong>
        {job.durationMs !== null && (
          <span className="muted">{t('log.duration', { seconds: (job.durationMs / 1000).toFixed(1) })}</span>
        )}
        {job.errorMessage && <span className="error-message">{job.errorMessage}</span>}
        {logUrl && (
          <a href={logUrl} target="_blank" rel="noreferrer">
            {t('log.rawLog')}
          </a>
        )}
      </header>
      {job.entries.length === 0 && ['success', 'failed'].includes(job.status) && errors === 0 && (
        <p className="muted log-empty">{t('log.noIssues')}</p>
      )}
      {LEVELS.map((level) => {
        const entries = byLevel(level);
        if (entries.length === 0) return null;
        return (
          <div key={level} className={`log-group level-${level}`}>
            <button className="log-group-title" onClick={() => setOpen((o) => ({ ...o, [level]: !o[level] }))}>
              {open[level] ? '▾' : '▸'} {labels[level]} ({entries.length})
            </button>
            {open[level] && (
              <ul>
                {entries.map((e, i) => {
                  const index = job.entries.indexOf(e);
                  const st = aiState[`${job.id}:${index}`];
                  return (
                  <li key={i}>
                    <button
                      className="log-entry"
                      disabled={!e.file}
                      onClick={() => onJump(e)}
                      title={e.context || undefined}
                    >
                      <span className="log-location">
                        {e.file ? t('log.line', { file: e.file, line: e.line ?? '?' }) : t('log.noLocation')}
                      </span>
                      <span className="log-message">{e.message}</span>
                      {e.context && <pre className="log-context">{e.context}</pre>}
                    </button>
                    {(() => {
                      const help = explainError(e);
                      if (!help) return null;
                      return (
                        <div className="log-help" data-testid="log-help">
                          <span>💡 {t(`help.${help.id}`, helpParams(help))}</span>
                          {help.fix && onQuickFix && (help.fix.kind !== 'replace' || (e.file && e.line !== null)) && (
                            <button className="small" onClick={() => onQuickFix(e, help.fix!)} data-testid="log-quick-fix">
                              🩹 {t(`help.fix.${help.fix.kind}`, helpParams(help.fix))}
                            </button>
                          )}
                        </div>
                      );
                    })()}
                    {ai && level === 'error' && (
                      <div className="log-ai" data-testid="log-ai">
                        <button className="small" disabled={!!st?.busy} onClick={() => void runAi(index, 'explain')}>
                          ✨ {t('ai.explain')}
                        </button>
                        {ai.canFix && e.file && e.line !== null && (
                          <button className="small" disabled={!!st?.busy} onClick={() => void runAi(index, 'fix')}>
                            🛠 {t('ai.fix')}
                          </button>
                        )}
                        {st?.busy && <span className="muted">{t('ai.thinking')}</span>}
                      </div>
                    )}
                    {st?.explanation && (
                      <p className="ai-explanation" data-testid="ai-explanation">
                        {st.explanation}
                      </p>
                    )}
                    {st?.error && (
                      <p className="error-message" role="alert">
                        {st.error}
                      </p>
                    )}
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
