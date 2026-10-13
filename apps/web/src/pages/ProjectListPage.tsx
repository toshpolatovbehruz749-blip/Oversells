import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
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
        </div>

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
