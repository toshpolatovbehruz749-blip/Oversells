import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { ProjectDTO } from '@oversells/shared';
import { api } from '../api/client';
import { errorMessage } from '../i18n';
import { useDialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

const COMPILER_LABELS: Record<string, string> = { pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' };

export function ProjectListPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const dialog = useDialog();
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectDTO[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.listProjects().then(setProjects, (err) => toast(errorMessage(err)));
  }, [toast]);
  useEffect(load, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const project = await api.createProject(name.trim() || t('projects.defaultName'));
      navigate(`/project/${project.id}`);
    } catch (err) {
      toast(errorMessage(err));
      setBusy(false);
    }
  };

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

  const dateFormat = new Intl.DateTimeFormat(i18n.language === 'uz' ? 'uz-Latn' : i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="logo">Oversells</span>
          <span className="tagline">{t('app.tagline')}</span>
        </div>
        <LanguageSwitcher />
      </header>

      <main className="projects">
        <h1>{t('projects.title')}</h1>
        <form className="new-project" onSubmit={create}>
          <input
            aria-label={t('projects.namePlaceholder')}
            placeholder={t('projects.namePlaceholder')}
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="primary" disabled={busy}>
            {t('projects.new')}
          </button>
        </form>

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
      </main>
    </div>
  );
}
