import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ShareLinkDTO, ShareRole } from '@oversells/shared';
import { api } from '../api/client';
import { errorMessage } from '../i18n';
import { useToast } from './Toast';

interface Props {
  projectId: string;
  onClose(): void;
}

/** Owner-only dialog: create, copy and revoke viewer/editor links. */
export function ShareDialog({ projectId, onClose }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const [links, setLinks] = useState<ShareLinkDTO[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api.listShareLinks(projectId).then(setLinks, (err) => toast(errorMessage(err)));
  }, [projectId, toast]);

  const create = async (role: ShareRole) => {
    try {
      const link = await api.createShareLink(projectId, role);
      setLinks((l) => [...(l ?? []), link]);
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const revoke = async (link: ShareLinkDTO) => {
    try {
      await api.revokeShareLink(projectId, link.id);
      setLinks((l) => (l ?? []).filter((x) => x.id !== link.id));
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const copy = async (link: ShareLinkDTO) => {
    try {
      await navigator.clipboard.writeText(api.shareUrl(link.token));
      setCopied(link.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard not available (e.g. plain http): the input stays selectable.
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2 id="share-title">{t('share.title')}</h2>
        <p className="muted">{t('share.help')}</p>
        <ul className="share-links" data-testid="share-links">
          {links?.length === 0 && <li className="muted">{t('share.none')}</li>}
          {links?.map((link) => (
            <li key={link.id} className="share-link" data-role={link.role}>
              <span className={`role-badge role-${link.role}`}>{t(`share.role.${link.role}`)}</span>
              <input readOnly value={api.shareUrl(link.token)} onFocus={(e) => e.target.select()} aria-label={t('share.link')} />
              <button onClick={() => void copy(link)}>{copied === link.id ? t('share.copied') : t('share.copy')}</button>
              <button className="danger" onClick={() => void revoke(link)}>
                {t('share.revoke')}
              </button>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button onClick={() => void create('viewer')}>{t('share.createViewer')}</button>
          <button onClick={() => void create('editor')}>{t('share.createEditor')}</button>
          <button className="primary" onClick={onClose}>
            {t('share.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
