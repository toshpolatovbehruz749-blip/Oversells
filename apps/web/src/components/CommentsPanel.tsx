import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dateTimeFormat } from '../i18n/dates';
import type { CommentThreadDTO } from '@oversells/shared';

interface Props {
  threads: CommentThreadDTO[];
  activeId: string | null;
  canWrite: boolean;
  currentUserId: string | null;
  isOwner: boolean;
  onSelect(thread: CommentThreadDTO): void;
  onReply(thread: CommentThreadDTO, body: string): Promise<void>;
  onResolve(thread: CommentThreadDTO, resolved: boolean): Promise<void>;
  onDelete(thread: CommentThreadDTO, replyId?: string): Promise<void>;
}

/** Comment threads of the open file (open ones first; resolved ones on request). */
export function CommentsPanel(props: Props) {
  const { t, i18n } = useTranslation();
  const [showResolved, setShowResolved] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const time = dateTimeFormat(i18n.language, true);
  const open = props.threads.filter((c) => !c.resolved);
  const resolved = props.threads.filter((c) => c.resolved);
  const visible = showResolved ? [...open, ...resolved] : open;

  const canDelete = (authorId: string) => props.canWrite && (props.isOwner || authorId === props.currentUserId);

  return (
    <section className="comments-panel" aria-label={t('comments.title')} data-testid="comments-panel">
      <header className="comments-header">
        <strong>
          {t('comments.title')} ({open.length})
        </strong>
        {resolved.length > 0 && (
          <label className="muted">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />{' '}
            {t('comments.showResolved', { count: resolved.length })}
          </label>
        )}
      </header>
      {visible.length === 0 && <p className="muted comments-empty">{t('comments.empty')}</p>}
      <ul className="comment-threads">
        {visible.map((c) => (
          <li
            key={c.id}
            className={`comment-thread ${c.id === props.activeId ? 'active' : ''} ${c.resolved ? 'resolved' : ''}`}
            data-testid="comment-thread"
            onClick={() => props.onSelect(c)}
          >
            <blockquote className={c.from === null ? 'detached' : ''} title={c.from === null ? t('comments.detached') : undefined}>
              {c.quote || '…'}
            </blockquote>
            <div className="comment">
              <span className="comment-author">{c.author.name}</span>
              <span className="muted comment-time">{time.format(new Date(c.createdAt))}</span>
              <p className="comment-body">{c.body}</p>
            </div>
            {c.replies.map((r) => (
              <div key={r.id} className="comment reply">
                <span className="comment-author">{r.author.name}</span>
                <span className="muted comment-time">{time.format(new Date(r.createdAt))}</span>
                {canDelete(r.author.id) && (
                  <button className="link-button" onClick={(e) => (e.stopPropagation(), void props.onDelete(c, r.id))}>
                    {t('comments.delete')}
                  </button>
                )}
                <p className="comment-body">{r.body}</p>
              </div>
            ))}
            {props.canWrite && (
              <div className="comment-actions" onClick={(e) => e.stopPropagation()}>
                {!c.resolved && (
                  <form
                    className="reply-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const body = (drafts[c.id] ?? '').trim();
                      if (!body) return;
                      void props.onReply(c, body).then(() => setDrafts((d) => ({ ...d, [c.id]: '' })));
                    }}
                  >
                    <input
                      placeholder={t('comments.replyPlaceholder')}
                      aria-label={t('comments.reply')}
                      value={drafts[c.id] ?? ''}
                      onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                    />
                    <button type="submit">{t('comments.reply')}</button>
                  </form>
                )}
                <button onClick={() => void props.onResolve(c, !c.resolved)}>
                  {c.resolved ? t('comments.reopen') : t('comments.resolve')}
                </button>
                {canDelete(c.author.id) && (
                  <button className="danger" onClick={() => void props.onDelete(c)}>
                    {t('comments.delete')}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
