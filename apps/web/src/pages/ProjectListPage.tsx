import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { dateTimeFormat } from '../i18n/dates';
import type { ProjectDTO, SharedProjectDTO } from '@oversells/shared';
import { api } from '../api/client';
import { errorMessage } from '../i18n';
import { useDialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { UserMenu } from '../components/UserMenu';

const COMPILER_LABELS: Record<string, string> = { pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' };

export function ProjectListPage() {
  const { t, i18n } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectDTO[] | null>(null);
  const [shared, setShared] = useState<SharedProjectDTO[]>([]);
  const navigate = useNavigate();
  const wordInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const backupInput = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);
  const [backup, setBackup] = useState<{ auto: boolean; last: { date: string } | null } | null>(null);
  useEffect(() => {
    api.backupStatus().then(setBackup, () => setBackup(null));
  }, []);
  const restore = async (file: File) => {
    setRestoring(true);
    try {
      const restored = await api.restoreBackup(file);
      toast(t('backup.restored', { count: restored.length }));
      setProjects(await api.listProjects());
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setRestoring(false);
      if (backupInput.current) backupInput.current.value = '';
    }
  };
  const importWord = async (file: File) => {
    setImporting(true);
    try {
      const project = await api.importDocx(file);
      navigate(`/project/${project.id}`);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setImporting(false);
      if (wordInput.current) wordInput.current.value = '';
    }
  };

  const load = useCallback(() => {
    api.listProjects().then(setProjects, (err) => toast(errorMessage(err)));
    api.listSharedProjects().then(setShared, () => undefined);
  }, [toast]);
  useEffect(load, [load]);

  const rename = async (p: ProjectDTO) => {
    const next = await dialog.prompt(t('projects.renamePrompt'), p.name);
    if (!next || next === p.name) return;
    try {
      await api.updateProject(p.id, { name: next });
      load();
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const remove = async (p: ProjectDTO) => {
    if (!(await dialog.confirm(t('projects.confirmDelete', { name: p.name })))) return;
    try {
      await api.deleteProject(p.id);
      load();
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const dateFormat = dateTimeFormat(i18n.language);

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="logo">Oversells</span>
          <span className="tagline">{t('app.tagline')}</span>
        </div>
        <LanguageSwitcher />
        <UserMenu />
      </header>

      <main className="projects">
        <h1>{t('projects.title')}</h1>
        <div className="new-project">
          <Link to="/new" className="button primary" data-testid="new-project">
            + {t('projects.new')}
          </Link>
          <button onClick={() => wordInput.current?.click()} disabled={importing} title={t('projects.importWordHint')} data-testid="import-word">
            {importing ? t('projects.importingWord') : `📄 ${t('projects.importWord')}`}
          </button>
          <a className="button" href={api.backupUrl()} download data-testid="backup-download" title={t('backup.downloadHint')}>
            ⬇ {t('backup.download')}
          </a>
          <button onClick={() => backupInput.current?.click()} disabled={restoring} data-testid="backup-restore" title={t('backup.restoreHint')}>
            {restoring ? t('backup.restoring') : `⬆ ${t('backup.restore')}`}
          </button>
          <input
            ref={backupInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            data-testid="backup-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void restore(file);
            }}
          />
          <input
            ref={wordInput}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            hidden
            data-testid="import-word-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importWord(file);
            }}
          />
        </div>

        {backup?.auto && (
          <p className="muted backup-status" data-testid="backup-status">
            {backup.last ? t('backup.autoLast', { date: backup.last.date }) : t('backup.autoNone')}
          </p>
        )}
        {projects && projects.length === 0 && <p className="empty">{t('projects.empty')}</p>}
        {projects && projects.length > 0 && (
          <table className="project-table">
            <thead>
              <tr>
                <th>{t('projects.name')}</th>
                <th>{t('projects.compiler')}</th>
                <th>{t('projects.updated')}</th>
                <th>{t('projects.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/project/${p.id}`} className="project-link">
                      {p.name}
                    </Link>
                  </td>
                  <td>{COMPILER_LABELS[p.compiler]}</td>
                  <td>{dateFormat.format(new Date(p.updatedAt))}</td>
                  <td className="row-actions">
                    <button onClick={() => void rename(p)}>{t('projects.rename')}</button>
                    <a className="button" href={api.zipUrl(p.id)} download>
                      {t('projects.download')}
                    </a>
                    <button className="danger" onClick={() => void remove(p)}>
                      {t('projects.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {shared.length > 0 && (
          <section className="shared-projects" data-testid="shared-projects">
            <h2>{t('projects.sharedTitle')}</h2>
            <table className="project-table">
              <thead>
                <tr>
                  <th>{t('projects.name')}</th>
                  <th>{t('projects.owner')}</th>
                  <th>{t('projects.access')}</th>
                  <th>{t('projects.updated')}</th>
                </tr>
              </thead>
              <tbody>
                {shared.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/s/${p.token}`} className="project-link">
                        {p.name}
                      </Link>
                    </td>
                    <td>{p.ownerName}</td>
                    <td>{t(`share.role.${p.role}`)}</td>
                    <td>{dateFormat.format(new Date(p.updatedAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </div>
  );
}
