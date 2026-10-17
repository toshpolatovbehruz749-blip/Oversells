import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { errorMessage } from '../i18n';
import { safeNext, useAuth } from '../auth/AuthContext';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="page auth-page">
      <header className="topbar">
        <div className="brand">
          <Link to="/" className="logo">
            Oversells
          </Link>
          <span className="tagline">{t('app.tagline')}</span>
        </div>
        <LanguageSwitcher />
      </header>
      <main className="auth-card">
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  );
}

/** Shared form state: busy flag and translated error. */
function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;
}

export function LoginPage() {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useSubmit();

  if (user) return <Navigate to={next} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setUser(await api.login(email, password));
      navigate(next, { replace: true });
    });
  };

  return (
    <AuthLayout title={t('auth.loginTitle')}>
      <form className="auth-form" onSubmit={submit}>
        <label>
          {t('auth.email')}
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          {t('auth.password')}
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <ErrorText error={error} />
        <button type="submit" className="primary" disabled={busy}>
          {t('auth.login')}
        </button>
      </form>
      <p className="auth-links">
        <Link to={`/register?next=${encodeURIComponent(next)}`}>{t('auth.noAccount')}</Link>
        <Link to="/forgot-password">{t('auth.forgot')}</Link>
      </p>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useSubmit();

  if (user) return <Navigate to={next} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setUser(await api.register(email, password, name));
      navigate(next, { replace: true });
    });
  };

  return (
    <AuthLayout title={t('auth.registerTitle')}>
      <form className="auth-form" onSubmit={submit}>
        <label>
          {t('auth.name')}
          <input autoComplete="name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          {t('auth.email')}
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          {t('auth.password')}
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="hint">{t('auth.passwordHint')}</span>
        </label>
        <ErrorText error={error} />
        <button type="submit" className="primary" disabled={busy}>
          {t('auth.register')}
        </button>
      </form>
      <p className="auth-links">
        <Link to={`/login?next=${encodeURIComponent(next)}`}>{t('auth.haveAccount')}</Link>
      </p>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useSubmit();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.requestPasswordReset(email, i18n.language);
      setSent(true);
    });
  };

  return (
    <AuthLayout title={t('auth.forgotTitle')}>
      {sent ? (
        <p className="form-success" role="status">
          {t('auth.resetSent')}
        </p>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <p className="muted">{t('auth.forgotHelp')}</p>
          <label>
            {t('auth.email')}
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <ErrorText error={error} />
          <button type="submit" className="primary" disabled={busy}>
            {t('auth.sendLink')}
          </button>
        </form>
      )}
      <p className="auth-links">
        <Link to="/login">{t('auth.backToLogin')}</Link>
      </p>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useSubmit();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.resetPassword(token, password);
      setDone(true);
    });
  };

  return (
    <AuthLayout title={t('auth.resetTitle')}>
      {done ? (
        <p className="form-success" role="status">
          {t('auth.resetDone')}
        </p>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <label>
            {t('auth.newPassword')}
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span className="hint">{t('auth.passwordHint')}</span>
          </label>
          <ErrorText error={error} />
          <button type="submit" className="primary" disabled={busy || !token}>
            {t('auth.savePassword')}
          </button>
        </form>
      )}
      <p className="auth-links">
        <Link to="/login">{t('auth.backToLogin')}</Link>
      </p>
    </AuthLayout>
  );
}
