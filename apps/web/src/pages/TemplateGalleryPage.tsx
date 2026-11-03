import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TemplateDTO } from '@oversells/shared';
import { api } from '../api/client';
import { errorMessage, localized } from '../i18n';
import { useDialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { UserMenu } from '../components/UserMenu';

const COMPILER_LABELS: Record<string, string> = { pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' };

/** Preview image; generated on the server on first request, so it may take a few seconds. */
function TemplatePreview({ template, title }: { template: TemplateDTO; title: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  return (
    <div className={`template-preview preview-${state}`}>
      {state === 'loading' && <span className="muted">{t('templates.previewLoading')}</span>}
      {state === 'error' && <span className="muted">{t('templates.previewFailed')}</span>}
      <img
        src={api.templatePreviewUrl(template.name)}
        alt={t('templates.previewAlt', { title })}
        onLoad={() => setState('ok')}
        onError={() => setState('error')}
      />
    </div>
  );
}

export function TemplateGalleryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dialog = useDialog();
  const toast = useToast();
  const [templates, setTemplates] = useState<TemplateDTO[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.listTemplates().then(setTemplates, (err) => toast(errorMessage(err)));
  }, [toast]);

  const create = async (template: TemplateDTO) => {
    const name = await dialog.prompt(t('projects.namePlaceholder'), localized(template.title));
    if (!name) return;
    setBusy(template.name);
    try {
      const project = await api.createProject(name, template.name);
      navigate(`/project/${project.id}`);
    } catch (err) {
      toast(errorMessage(err));
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <Link to="/" className="logo">
            Oversells
          </Link>
          <span className="tagline">{t('app.tagline')}</span>
        </div>
        <LanguageSwitcher />
        <UserMenu />
      </header>
      <main className="projects">
        <p>
          <Link to="/" className="back-link">
            ← {t('editor.back')}
          </Link>
        </p>
        <h1>{t('templates.title')}</h1>
        <p className="muted">{t('templates.subtitle')}</p>
        <div className="template-grid">
          {templates?.map((tpl) => (
            <article key={tpl.name} className="template-card" data-template={tpl.name}>
              <TemplatePreview template={tpl} title={localized(tpl.title)} />
              <div className="template-body">
                <h2>{localized(tpl.title)}</h2>
                <p>{localized(tpl.description)}</p>
                <div className="template-footer">
                  <span className="muted">{COMPILER_LABELS[tpl.compiler]}</span>
                  <button className="primary" disabled={busy !== null} onClick={() => void create(tpl)}>
                    {t('templates.use')}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
