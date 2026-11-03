import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PreflightReport } from '@oversells/shared';
import { api } from '../api/client';
import { errorMessage } from '../i18n';

interface Props {
  projectId: string;
  canEdit: boolean;
  /** Opens a file of the project at a line. */
  onJump(path: string, line: number): void;
  /** After a fix: compile again. */
  onChanged(): void;
}

const ICON = { ok: '✓', warning: '!', error: '✗' } as const;

/** «Preflight»: the latest PDF checked before printing, with the fixes Oversells can make. */
export function PreflightPanel({ projectId, canEdit, onJump, onChanged }: Props) {
  const { t } = useTranslation();
  const [multiple, setMultiple] = useState<16 | 32>(16);
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setReport((await api.preflight(projectId, multiple)).report);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const addPages = async (count: number) => {
    setBusy(true);
    try {
      await api.addBlankPages(projectId, count);
      setReport(null);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pd-form" data-testid="pd-preflight">
      <p className="muted small-print">{t('pageDesign.preflight.intro')}</p>
      <div className="pd-row">
        <label className="field">
          {t('pageDesign.preflight.sheet')}
          <select value={multiple} onChange={(e) => setMultiple(Number(e.target.value) as 16 | 32)}>
            <option value={16}>16</option>
            <option value={32}>32</option>
          </select>
        </label>
        <button className="primary" disabled={busy} onClick={() => void run()} data-testid="pd-preflight-run">
          {busy ? t('pageDesign.preflight.running') : t('pageDesign.preflight.run')}
        </button>
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {report && (
        <>
          <p className="muted">{t('pageDesign.preflight.pages', { count: report.pages })}</p>
          <ul className="pd-checks">
            {report.checks.map((c) => (
              <li key={c.id} className={`pd-check ${c.status}`} data-testid={`pd-check-${c.id}`} data-status={c.status}>
                <span className="pd-check-icon" aria-hidden="true">
                  {ICON[c.status]}
                </span>
                <span className="pd-check-body">
                  <strong>{t(`pageDesign.preflight.check.${c.id}`)}</strong>
                  {c.status === 'ok' ? (
                    <span className="muted"> — {t('pageDesign.preflight.ok')}</span>
                  ) : (
                    <ul>
                      {c.items.slice(0, 20).map((item, i) => (
                        <li key={i}>
                          {item.file && item.line ? (
                            <button className="link" onClick={() => onJump(item.file!.replace(/^\.\//, ''), item.line!)}>
                              {item.file.replace(/^\.\//, '')}:{item.line}
                            </button>
                          ) : item.page ? (
                            <span>{t('pageDesign.preflight.page', { page: item.page })}</span>
                          ) : null}{' '}
                          {c.id === 'short-pages' ? t('pageDesign.preflight.lines', { count: Number(item.text) }) : item.text}
                        </li>
                      ))}
                      {c.items.length > 20 && <li className="muted">{t('pageDesign.preflight.more', { count: c.items.length - 20 })}</li>}
                    </ul>
                  )}
                  {c.status !== 'ok' && (c.id === 'short-pages' || c.id === 'bleed') && (
                    <p className="muted small-print">{t(`pageDesign.preflight.help.${c.id}`)}</p>
                  )}
                  {c.fix?.kind === 'blankPages' && canEdit && (
                    <button className="small" disabled={busy} onClick={() => void addPages(c.fix!.count)} data-testid="pd-fix-blank-pages">
                      🩹 {t('pageDesign.preflight.addPages', { count: c.fix.count })}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
