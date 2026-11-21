import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { UserMenu } from '../components/UserMenu';
import { useToast } from '../components/Toast';
import { errorMessage } from '../i18n';

/**
 * «⚙ Sozlamalar»: the name, the e-mail, the language, a new password and the
 * other devices. Passwords are never kept by Oversells (only their hash): the
 * form is marked so that the browser offers to remember the new one.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [account, setAccount] = useState<{ sessions: number; sessionDays: number } | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState<'name' | 'password' | 'others' | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const load = () => api.account().then(setAccount, (err) => toast(errorMessage(err)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('name');
    try {
      const u = await api.updateMe(name);
      setUser(u);
      setName(u.name);
      toast(t('settings.nameSaved'));
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    if (next !== repeat) {
      setPasswordError(t('settings.mismatch'));
      return;
    }
    setBusy('password');
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setRepeat('');
      toast(t('settings.passwordSaved'));
      await load();
    } catch (err) {
      setPasswordError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const logoutOthers = async () => {
    setBusy('others');
    try {
      const { ended } = await api.logoutOthers();
      toast(t('settings.othersDone', { count: ended }));
      await load();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (!user) return null;
  const others = account ? account.sessions - 1 : 0;
  return (
    <div className="page settings-page">
      <header className="topbar">
        <Link to="/" className="back-link">
          ← {t('editor.back')}
        </Link>
        <div className="brand">
          <span className="logo">Oversells</span>
          <span className="tagline">{t('settings.title')}</span>
        </div>
        <UserMenu />
      </header>
      <main className="settings">
        <h1>⚙ {t('settings.title')}</h1>

        <section className="settings-card">
          <h2>👤 {t('settings.account')}</h2>
          <form className="auth-form" onSubmit={(e) => void saveName(e)}>
            <label>
              <span>{t('auth.name')}</span>
              <input autoComplete="name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} data-testid="settings-name" />
            </label>
            <label>
              <span>{t('auth.email')}</span>
              {/* For the browser's password manager: the login the new password belongs to. */}
              <input type="email" autoComplete="username" value={user.email} readOnly data-testid="settings-email" />
            </label>
            <button className="primary" disabled={busy === 'name' || name.trim() === user.name} data-testid="settings-save-name">
              {t('settings.saveName')}
            </button>
          </form>
        </section>

        <section className="settings-card">
          <h2>🌐 {t('lang.label')}</h2>
          <LanguageSwitcher />
        </section>

        <section className="settings-card">
          <h2>🔑 {t('settings.passwordTitle')}</h2>
          <p className="muted">{t('settings.passwordHelp')}</p>
          <form className="auth-form" onSubmit={(e) => void savePassword(e)}>
            <input type="email" autoComplete="username" value={user.email} readOnly hidden />
            <label>
              <span>{t('settings.currentPassword')}</span>
              <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} data-testid="settings-current" />
            </label>
            <label>
              <span>{t('auth.newPassword')}</span>
              <input type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} data-testid="settings-new" />
              <span className="hint">{t('auth.passwordHint')}</span>
            </label>
            <label>
              <span>{t('settings.repeatPassword')}</span>
              <input type="password" autoComplete="new-password" required minLength={8} value={repeat} onChange={(e) => setRepeat(e.target.value)} data-testid="settings-repeat" />
            </label>
            {passwordError && (
              <p className="form-error" role="alert" data-testid="settings-password-error">
                {passwordError}
              </p>
            )}
            <button className="primary" disabled={busy === 'password'} data-testid="settings-save-password">
              {t('auth.savePassword')}
            </button>
          </form>
        </section>

        <section className="settings-card">
          <h2>📱 {t('settings.devicesTitle')}</h2>
          <p className="muted">{t('settings.devicesHelp', { days: account?.sessionDays ?? 30 })}</p>
          <p data-testid="settings-devices">{account ? (others > 0 ? t('settings.others', { count: others }) : t('settings.onlyThis')) : '…'}</p>
          <button disabled={busy === 'others' || others <= 0} onClick={() => void logoutOthers()} data-testid="settings-logout-others">
            {t('settings.logoutOthers')}
          </button>
        </section>
      </main>
    </div>
  );
}
