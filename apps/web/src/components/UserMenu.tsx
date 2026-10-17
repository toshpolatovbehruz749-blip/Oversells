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
      <span className="user-email" title={user.email} data-testid="user-email">
        {user.name || user.email}
      </span>
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
