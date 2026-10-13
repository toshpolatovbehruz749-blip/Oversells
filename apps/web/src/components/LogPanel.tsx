import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CompileJobDTO, LogEntry, LogLevel } from '@oversells/shared';

interface Props {
  job: CompileJobDTO | null;
  logUrl: string | null;
  onJump(entry: LogEntry): void;
}

const LEVELS: LogLevel[] = ['error', 'warning', 'typesetting'];

/** Compile status plus the parsed errors/warnings; clicking an entry jumps to its line. */
export function LogPanel({ job, logUrl, onJump }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Record<LogLevel, boolean>>({ error: true, warning: true, typesetting: false });
  if (!job) return null;

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
                {entries.map((e, i) => (
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
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
