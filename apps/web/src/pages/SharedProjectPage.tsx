import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { ShareResolutionDTO } from '@oversells/shared';
import { api, setShareToken } from '../api/client';
import { errorMessage } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { EditorPage } from './EditorPage';

/** /s/:token — opens a project through a share link (viewer or editor). */
export function SharedProjectPage() {
  const { token = '' } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [share, setShare] = useState<ShareResolutionDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user === undefined) return;
    let cancelled = false;
    api.resolveShare(token).then(
      (s) => {
        if (cancelled) return;
        setShareToken(token);
        setShare(s);
      },
      (err) => !cancelled && setError(errorMessage(err)),
    );
    return () => {
      cancelled = true;
      setShareToken(null);
    };
    // Re-resolve after login/logout: the effective role depends on the session.
  }, [token, user]);

  if (error) {
    return (
      <div className="page">
        <p className="empty">
          {t('share.invalid')} ({error}) — <Link to="/">{t('editor.back')}</Link>
        </p>
      </div>
    );
  }
  if (!share) return <div className="page loading" />;
  return <EditorPage projectId={share.projectId} share={{ token, linkRole: share.linkRole }} key={`${token}:${share.role}`} />;
}
