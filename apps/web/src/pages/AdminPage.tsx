import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { AdminStatsDTO, AdminUserDTO, UserLimitsDTO } from '@oversells/shared';
import { api } from '../api/client';
import { errorMessage } from '../i18n';
import { dateTimeFormat } from '../i18n/dates';
import { useAuth } from '../auth/AuthContext';
import { useDialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { UserMenu } from '../components/UserMenu';

const PAGE_SIZE = 50;
const MB = 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint muted">{hint}</div>}
    </div>
  );
}

function Stats({ stats }: { stats: AdminStatsDTO }) {
  const { t } = useTranslation();
  const c = stats.compiles;
  const max = Math.max(1, ...c.daily.map((d) => d.total));
  const seconds = (ms: number | null) => (ms === null ? '—' : t('admin.seconds', { value: (ms / 1000).toFixed(1) }));
  return (
    <section className="admin-stats" data-testid="admin-stats">
      <div className="stat-group">
        <h2>{t('admin.users')}</h2>
        <Stat label={t('admin.total')} value={stats.users.total} />
        <Stat label={t('admin.active7d')} value={stats.users.active7d} />
        <Stat label={t('admin.new7d')} value={stats.users.new7d} />
        <Stat label={t('admin.blockedCount')} value={stats.users.blocked} />
        <Stat label={t('admin.projects')} value={stats.projects.total} hint={t('admin.plus7d', { count: stats.projects.created7d })} />
      </div>
      <div className="stat-group">
        <h2>{t('admin.compiles')}</h2>
        <Stat label={t('admin.last24h')} value={c.last24h.total} hint={t('admin.failedCount', { count: c.last24h.failed + c.last24h.timeout + c.last24h.error })} />
        <Stat label={t('admin.last7d')} value={c.last7d.total} hint={t('admin.successCount', { count: c.last7d.success })} />
        <Stat label={t('admin.avgDuration')} value={seconds(c.avgMs7d)} hint={`p95: ${seconds(c.p95Ms7d)}`} />
        <Stat label={t('admin.queue')} value={c.queued} hint={t('admin.running', { count: c.running })} />
        <div className="daily-chart" aria-label={t('admin.daily')}>
          {c.daily.map((d) => (
            <div key={d.day} className="daily-bar" title={`${d.day}: ${d.total} (${d.failed} ✗)`}>
              <div className="bar-total" style={{ height: `${(d.total / max) * 100}%` }}>
                <div className="bar-failed" style={{ height: d.total ? `${(d.failed / d.total) * 100}%` : 0 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="stat-group">
        <h2>{t('admin.storage')}</h2>
        <Stat label={t('admin.files')} value={formatBytes(stats.storage.fileBytes)} hint={t('admin.fileCount', { count: stats.storage.fileCount })} />
        <Stat label={t('admin.docHistory')} value={formatBytes(stats.storage.docHistoryBytes)} />
        <Stat label={t('admin.versions')} value={stats.storage.versionCount} />
      </div>
      <div className="stat-group">
        <h2>{t('admin.ai')}</h2>
        <Stat label={t('admin.aiState')} value={stats.ai.enabled ? t('admin.on') : t('admin.off')} />
        <Stat label={t('admin.last24h')} value={stats.ai.requests24h} />
        <Stat label={t('admin.last7d')} value={stats.ai.requests7d} hint={t('admin.tokens', { input: stats.ai.inputTokens7d, output: stats.ai.outputTokens7d })} />
      </div>
    </section>
  );
}

/** Administration: statistics and user management (admins only; the API enforces it). */
export function AdminPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const dialog = useDialog();
  const toast = useToast();
  const [stats, setStats] = useState<AdminStatsDTO | null>(null);
  const [users, setUsers] = useState<AdminUserDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');

  const isAdmin = user?.role === 'admin';

  const loadUsers = useCallback(
    async (q: string, offset = 0) => {
      try {
        const r = await api.adminUsers(q, offset, PAGE_SIZE);
        setUsers((u) => (offset === 0 ? r.users : [...u, ...r.users]));
        setTotal(r.total);
      } catch (err) {
        toast(errorMessage(err));
      }
    },
    [toast],
  );

  useEffect(() => {
    if (!isAdmin) return;
    api.adminStats().then(setStats, (err) => toast(errorMessage(err)));
  }, [isAdmin, toast]);

  useEffect(() => {
    if (!isAdmin) return;
    const timer = setTimeout(() => void loadUsers(query), 250);
    return () => clearTimeout(timer);
  }, [isAdmin, query, loadUsers]);

  const update = async (u: AdminUserDTO, patch: Parameters<typeof api.adminUpdateUser>[1]) => {
    try {
      const updated = await api.adminUpdateUser(u.id, patch);
      setUsers((list) => list.map((x) => (x.id === updated.id ? updated : x)));
      if (patch.blocked !== undefined) api.adminStats().then(setStats, () => undefined);
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const toggleBlock = async (u: AdminUserDTO) => {
    const blocking = !u.blockedAt;
    if (blocking && !(await dialog.confirm(t('admin.confirmBlock', { email: u.email })))) return;
    await update(u, { blocked: blocking });
  };

  const editLimit = async (u: AdminUserDTO, key: keyof UserLimitsDTO) => {
    const current = u.limits[key];
    const shown = current === null ? '' : key === 'storageQuotaBytes' ? String(Math.round(current / MB)) : String(current);
    const value = await dialog.prompt(t(`admin.limitPrompt.${key}`), shown, t('admin.limitHint'));
    if (value === null) return;
    // The dialog treats an empty value as "cancel", so "-" resets to the server default.
    const trimmed = value.trim();
    if (trimmed === '-') return update(u, { [key]: null });
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0) {
      toast(t('admin.badNumber'));
      return;
    }
    await update(u, { [key]: key === 'storageQuotaBytes' ? n * MB : n });
  };

  if (user && !isAdmin) {
    return (
      <div className="page">
        <p className="empty">
          {t('admin.noAccess')} — <Link to="/">{t('editor.back')}</Link>
        </p>
      </div>
    );
  }

  const fmt = dateTimeFormat(i18n.language);

  return (
    <div className="page">
      <header className="topbar">
        <Link to="/" className="back-link">
          ← {t('editor.back')}
        </Link>
        <div className="brand">
          <span className="logo">Oversells</span>
          <span className="tagline">{t('admin.title')}</span>
        </div>
        <LanguageSwitcher />
        <UserMenu />
      </header>
      <main className="admin">
        <h1>{t('admin.title')}</h1>
        {stats ? <Stats stats={stats} /> : <p className="muted">{t('pdf.loading')}</p>}

        <h2>{t('admin.users')}</h2>
        <input
          className="admin-search"
          type="search"
          placeholder={t('admin.search')}
          aria-label={t('admin.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="table-wrap">
          <table className="admin-users" data-testid="admin-users">
            <thead>
              <tr>
                <th>{t('admin.user')}</th>
                <th>{t('admin.role')}</th>
                <th>{t('admin.projects')}</th>
                <th>{t('admin.storage')}</th>
                <th>{t('admin.aiToday')}</th>
                <th>{t('admin.compiles7d')}</th>
                <th>{t('admin.lastSeen')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.blockedAt ? 'blocked' : ''} data-testid="admin-user-row" data-email={u.email}>
                  <td>
                    <strong>{u.name}</strong>
                    <div className="muted">{u.email}</div>
                    {u.blockedAt && <span className="role-badge blocked-badge">{t('admin.blocked')}</span>}
                  </td>
                  <td>
                    <span className={`role-badge role-${u.role}`}>{t(`admin.roles.${u.role}`)}</span>
                  </td>
                  <td>
                    <button className="link-button" onClick={() => void editLimit(u, 'maxProjects')} title={t('admin.changeLimit')}>
                      {u.projectCount} / {u.effective.maxProjects}
                      {u.limits.maxProjects !== null && ' *'}
                    </button>
                  </td>
                  <td>
                    <button className="link-button" onClick={() => void editLimit(u, 'storageQuotaBytes')} title={t('admin.changeLimit')}>
                      {formatBytes(u.storageBytes)} / {formatBytes(u.effective.storageQuotaBytes)}
                      {u.limits.storageQuotaBytes !== null && ' *'}
                    </button>
                  </td>
                  <td>
                    <button className="link-button" onClick={() => void editLimit(u, 'aiDailyLimit')} title={t('admin.changeLimit')} data-testid="ai-limit">
                      {u.aiRequestsToday} / {u.effective.aiDailyLimit}
                      {u.limits.aiDailyLimit !== null && ' *'}
                    </button>
                  </td>
                  <td>{u.compiles7d}</td>
                  <td>{u.lastSeenAt ? fmt.format(new Date(u.lastSeenAt)) : '—'}</td>
                  <td className="actions">
                    {u.id !== user?.id && (
                      <>
                        <button className={u.blockedAt ? '' : 'danger'} onClick={() => void toggleBlock(u)}>
                          {u.blockedAt ? t('admin.unblock') : t('admin.block')}
                        </button>
                        <button onClick={() => void update(u, { role: u.role === 'admin' ? 'user' : 'admin' })}>
                          {u.role === 'admin' ? t('admin.removeAdmin') : t('admin.makeAdmin')}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">{t('admin.limitLegend')}</p>
        {users.length < total && <button onClick={() => void loadUsers(query, users.length)}>{t('admin.more')}</button>}
      </main>
    </div>
  );
}
