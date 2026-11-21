import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import type { UserDTO } from '@oversells/shared';
import { api } from '../api/client';

interface AuthState {
  /** undefined while the session is being checked. */
  user: UserDTO | null | undefined;
  setUser(user: UserDTO | null): void;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Loads the current session once (this also issues the CSRF cookie). */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDTO | null | undefined>(undefined);

  useEffect(() => {
    api.me().then(setUser, () => setUser(null));
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, setUser, logout }}>{children}</AuthContext.Provider>;
}

/** Renders children for logged-in users; otherwise redirects to /login?next=… */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (user === undefined) return <div className="page loading" />;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

/** Only allows same-site paths as redirect targets after login. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
