import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';

/** E-mail of the logged-in user with a logout button, or a login link. */
export function UserMenu() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (user === undefined) return null;
  if (!user) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    return (
      <Link className="button" to={`/login?next=${next}`}>
        {t('auth.login')}
      </Link>
    );
  }
  return (
    <div className="user-menu">
      {user.role === 'admin' && (
        <Link className="button" to="/admin" data-testid="admin-link">
          {t('admin.link')}
        </Link>
      )}
      <Link className="user-email" to="/settings" title={`${user.email} — ${t('settings.title')}`} data-testid="user-email">
        {user.name || user.email}
      </Link>
      <Link className="button settings-link" to="/settings" title={t('settings.title')} aria-label={t('settings.title')} data-testid="settings-link">
        ⚙<span className="settings-link-label"> {t('settings.title')}</span>
      </Link>
      <button
        onClick={() => {
          void logout().then(() => navigate('/login'));
        }}
      >
        {t('auth.logout')}
      </button>
    </div>
  );
}
