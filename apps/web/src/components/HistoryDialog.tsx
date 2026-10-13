import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dateTimeFormat } from '../i18n/dates';
import { diffLines } from 'diff';
import type { VersionContentDTO, VersionDTO } from '@oversells/shared';
import { api } from '../api/client';
import { errorMessage } from '../i18n';
import { useDialog } from './Dialog';
import { useToast } from './Toast';

interface Props {
  projectId: string;
  canWrite: boolean;
  onClose(): void;
  /** Called after a restore (the editor reloads the file list). */
  onRestored(): void;
}

interface FileDiff {
  path: string;
  status: 'changed' | 'added' | 'removed';
  parts: Array<{ value: string; added?: boolean; removed?: boolean }>;
}

/** Line diff from `older` to `newer`, per file path. Unchanged files are left out. */
function diffVersions(older: VersionContentDTO, newer: VersionContentDTO): FileDiff[] {
  const a = new Map(older.files.map((f) => [f.path, f.content]));
  const b = new Map(newer.files.map((f) => [f.path, f.content]));
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  const out: FileDiff[] = [];
  for (const path of paths) {
    const before = a.get(path);
    const after = b.get(path);
    if (before === after) continue;
    out.push({
      path,
      status: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed',
      parts: diffLines(before ?? '', after ?? ''),
    });
  }
  return out;
}

/** Shows only changed lines plus a little context. */
function DiffView({ diff }: { diff: FileDiff }) {
  const { t } = useTranslation();
  const lines: Array<{ kind: 'add' | 'del' | 'ctx' | 'gap'; text: string }> = [];
  diff.parts.forEach((part, i) => {
    const rows = part.value.replace(/\n$/, '').split('\n');
    if (part.added || part.removed) {
      for (const text of rows) lines.push({ kind: part.added ? 'add' : 'del', text });
      return;
    }
    const first = i === 0;
    const last = i === diff.parts.length - 1;
    if (rows.length <= 6) {
      for (const text of rows) lines.push({ kind: 'ctx', text });
    } else {
      if (!first) for (const text of rows.slice(0, 3)) lines.push({ kind: 'ctx', text });
      lines.push({ kind: 'gap', text: '⋯' });
      if (!last) for (const text of rows.slice(-3)) lines.push({ kind: 'ctx', text });
    }
  });
  return (
    <div className="file-diff" data-testid="file-diff">
      <div className="file-diff-title">
        {diff.path} <span className={`diff-status status-${diff.status}`}>{t(`history.status.${diff.status}`)}</span>
      </div>
      <pre className="diff-lines">
        {lines.map((l, i) => (
          <div key={i} className={`diff-line diff-${l.kind}`}>
            <span className="diff-sign">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
            {l.text || ' '}
          </div>
        ))}
      </pre>
    </div>
  );
}

/**
 * Version history: list of versions, a diff between the selected version and
 * the current state (or the previous version), "save version" and "restore".
 */
export function HistoryDialog({ projectId, canWrite, onClose, onRestored }: Props) {
  const { t, i18n } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const [versions, setVersions] = useState<VersionDTO[] | null>(null);
  const [selected, setSelected] = useState<VersionDTO | null>(null);
  const [compareTo, setCompareTo] = useState<'current' | 'previous'>('current');
  const [diffs, setDiffs] = useState<FileDiff[] | null>(null);
  const [busy, setBusy] = useState(false);

  const time = useMemo(
    () =>
      dateTimeFormat(i18n.language),
    [i18n.language],
  );

  const load = () => api.listVersions(projectId).then(setVersions, (err) => toast(errorMessage(err)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!selected || !versions) return;
    let cancelled = false;
    setDiffs(null);
    (async () => {
      const content = await api.versionContent(projectId, selected.id);
      let older: VersionContentDTO;
      let newer: VersionContentDTO;
      if (compareTo === 'current') {
        older = content;
        newer = await api.currentContent(projectId);
      } else {
        const idx = versions.findIndex((v) => v.id === selected.id);
        const prev = versions[idx + 1];
        older = prev ? await api.versionContent(projectId, prev.id) : { version: null, files: [] };
        newer = content;
      }
      if (!cancelled) setDiffs(diffVersions(older, newer));
    })().catch((err) => toast(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [selected, compareTo, versions, projectId, toast]);

  const label = (v: VersionDTO) => {
    if (v.kind === 'named') return v.name ?? '';
    if (v.kind === 'restore') {
      const source = v.name && !Number.isNaN(Date.parse(v.name)) ? time.format(new Date(v.name)) : v.name;
      return t('history.restoredFrom', { name: source });
    }
    return t('history.auto');
  };

  const saveVersion = async () => {
    const name = await dialog.prompt(t('history.namePrompt'));
    if (!name) return;
    try {
      await api.saveVersion(projectId, name);
      await load();
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const restore = async () => {
    if (!selected) return;
    if (!(await dialog.confirm(t('history.confirmRestore', { name: label(selected), time: time.format(new Date(selected.createdAt)) })))) {
      return;
    }
    setBusy(true);
    try {
      await api.restoreVersion(projectId, selected.id);
      setSelected(null);
      await load();
      onRestored();
      toast(t('history.restored'));
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <header className="history-header">
          <h2 id="history-title">{t('history.title')}</h2>
          {canWrite && <button onClick={() => void saveVersion()}>{t('history.save')}</button>}
          <button className="primary" onClick={onClose}>
            {t('share.close')}
          </button>
        </header>
        <div className="history-body">
          <ul className="version-list" data-testid="version-list">
            {versions?.length === 0 && <li className="muted">{t('history.empty')}</li>}
            {versions?.map((v) => (
              <li key={v.id}>
                <button
                  className={`version-item kind-${v.kind} ${selected?.id === v.id ? 'selected' : ''}`}
                  onClick={() => setSelected(v)}
                >
                  <span className="version-label">{label(v)}</span>
                  <span className="muted">
                    {time.format(new Date(v.createdAt))}
                    {v.createdBy ? ` · ${v.createdBy.name}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="version-detail">
            {!selected && <p className="muted">{t('history.pick')}</p>}
            {selected && (
              <>
                <div className="version-toolbar">
                  <label>
                    <input type="radio" checked={compareTo === 'current'} onChange={() => setCompareTo('current')} />{' '}
                    {t('history.vsCurrent')}
                  </label>
                  <label>
                    <input type="radio" checked={compareTo === 'previous'} onChange={() => setCompareTo('previous')} />{' '}
                    {t('history.vsPrevious')}
                  </label>
                  {canWrite && (
                    <button className="primary" disabled={busy} onClick={() => void restore()}>
                      {t('history.restore')}
                    </button>
                  )}
                </div>
                {diffs === null && <p className="muted">{t('pdf.loading')}</p>}
                {diffs?.length === 0 && <p className="muted">{t('history.noChanges')}</p>}
                {diffs?.map((d) => <DiffView key={d.path} diff={d} />)}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
