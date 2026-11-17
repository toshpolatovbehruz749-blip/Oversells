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

import { projectColour, projectInitial, relativeTime } from './project-cards';

const COMPILER_LABELS: Record<string, string> = { pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' };

export function ProjectListPage() {
  const { t, i18n } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectDTO[] | null>(null);
  const [shared, setShared] = useState<SharedProjectDTO[]>([]);
  const navigate = useNavigate();
  const wordInput = useRef<HTMLInputElement>(null);
  const idmlInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const [pageDesignOn, setPageDesignOn] = useState(false);
  useEffect(() => {
    api.features().then((f) => setPageDesignOn(f.pageDesign), () => setPageDesignOn(false));
  }, []);
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

  const importIdml = async (file: File) => {
    setImporting(true);
    try {
      const { project, warnings } = await api.importIdml(file);
      const count = (kind: string) => warnings.filter((w) => w.kind === kind).length;
      if (count('picture') || count('font')) toast(t('projects.idmlMissing', { pictures: count('picture'), fonts: count('font') }));
      navigate(`/project/${project.id}`);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setImporting(false);
      if (idmlInput.current) idmlInput.current.value = '';
    }
  };

  const importPdf = async (file: File) => {
    setImporting(true);
    try {
      const { project, paragraphs, headings } = await api.importPdf(file);
      toast(paragraphs + headings ? t('projects.pdfImported', { paragraphs, headings }) : t('projects.pdfNoText'));
      navigate(`/project/${project.id}`);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setImporting(false);
      if (pdfInput.current) pdfInput.current.value = '';
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
  const [query, setQuery] = useState('');
  const now = new Date();
  const q = query.trim().toLocaleLowerCase();
  const shown = projects?.filter((p) => !q || p.name.toLocaleLowerCase().includes(q)) ?? null;

  return (
    <div className="page projects-page">
      <header className="topbar">
        <div className="brand">
          <span className="logo">Oversells</span>
          <span className="tagline">{t('app.tagline')}</span>
        </div>
        <LanguageSwitcher />
        <UserMenu />
      </header>

      <main className="projects">
        <div className="projects-hero">
          <div>
            <h1>{t('projects.title')}</h1>
            {projects && projects.length > 0 && <p className="muted projects-count">{t('projects.count', { count: projects.length })}</p>}
          </div>
          {projects && projects.length > 3 && (
            <input
              className="projects-search"
              type="search"
              value={query}
              placeholder={t('projects.search')}
              aria-label={t('projects.search')}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="projects-search"
            />
          )}
        </div>
        <div className="new-project">
          <Link to="/new" className="button primary" data-testid="new-project">
            + {t('projects.new')}
          </Link>
          <button onClick={() => wordInput.current?.click()} disabled={importing} title={t('projects.importWordHint')} data-testid="import-word">
            {importing ? t('projects.importingWord') : `📄 ${t('projects.importWord')}`}
          </button>
          {pageDesignOn && (
            <button onClick={() => idmlInput.current?.click()} disabled={importing} title={t('projects.importIdmlHint')} data-testid="import-idml">
              📐 {t('projects.importIdml')}
            </button>
          )}
          {pageDesignOn && (
            <button onClick={() => pdfInput.current?.click()} disabled={importing} title={t('projects.importPdfHint')} data-testid="import-pdf">
              📕 {t('projects.importPdf')}
            </button>
          )}
          <span className="new-project-gap" aria-hidden="true" />
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
          <input
            ref={pdfInput}
            type="file"
            accept=".pdf,application/pdf"
            hidden
            data-testid="import-pdf-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importPdf(file);
            }}
          />
          <input
            ref={idmlInput}
            type="file"
            accept=".idml"
            hidden
            data-testid="import-idml-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importIdml(file);
            }}
          />
        </div>

        {backup?.auto && (
          <p className="muted backup-status" data-testid="backup-status">
            {backup.last ? t('backup.autoLast', { date: backup.last.date }) : t('backup.autoNone')}
          </p>
        )}
        {projects && projects.length === 0 && <p className="empty">{t('projects.empty')}</p>}
        {shown && shown.length === 0 && projects!.length > 0 && <p className="empty">{t('projects.noMatch')}</p>}
        {shown && shown.length > 0 && (
          <ul className="project-cards" data-testid="project-cards">
            {shown.map((p) => (
              <li key={p.id} className="project-card">
                <Link to={`/project/${p.id}`} className="project-card-main">
                  <span className="project-avatar" style={{ background: projectColour(p.name) }} aria-hidden="true">
                    {projectInitial(p.name)}
                  </span>
                  <span className="project-card-text">
                    <span className="project-link">{p.name}</span>
                    <span className="project-meta">
                      <span className="chip">{COMPILER_LABELS[p.compiler]}</span>
                      <time dateTime={p.updatedAt} title={dateFormat.format(new Date(p.updatedAt))}>
                        {relativeTime(new Date(p.updatedAt), now, t, dateFormat)}
                      </time>
                    </span>
                  </span>
                </Link>
                <div className="row-actions">
                  <button className="icon-button" onClick={() => void rename(p)} title={t('projects.rename')} aria-label={t('projects.rename')}>
                    ✏️
                  </button>
                  <a className="button icon-button" href={api.zipUrl(p.id)} download title={t('projects.download')} aria-label={t('projects.download')}>
                    ⬇
                  </a>
                  <button className="icon-button danger" onClick={() => void remove(p)} title={t('projects.delete')} aria-label={t('projects.delete')}>
                    🗑
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {shared.length > 0 && (
          <section className="shared-projects" data-testid="shared-projects">
            <h2>{t('projects.sharedTitle')}</h2>
            <ul className="project-cards">
              {shared.map((p) => (
                <li key={p.id} className="project-card">
                  <Link to={`/s/${p.token}`} className="project-card-main">
                    <span className="project-avatar" style={{ background: projectColour(p.name) }} aria-hidden="true">
                      {projectInitial(p.name)}
                    </span>
                    <span className="project-card-text">
                      <span className="project-link">{p.name}</span>
                      <span className="project-meta">
                        <span className="chip">{t(`share.role.${p.role}`)}</span>
                        <span>{p.ownerName}</span>
                        <time dateTime={p.updatedAt} title={dateFormat.format(new Date(p.updatedAt))}>
                          {relativeTime(new Date(p.updatedAt), now, t, dateFormat)}
                        </time>
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
