import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { apiLogin, apiLogout, apiMe, apiRegister } from '../lib/api';
import type { ApiError } from '../lib/api';
import { clearOwnedState } from '../lib/storage';

const AUTH_HINT_KEY = 'studycommander_auth_hint';

export type AuthStatus = 'checking' | 'authenticated' | 'anonymous';

export interface AuthUser {
  username: string;
}

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** オフライン中にセッションが未確認のまま楽観的に認証扱いにしている状態 */
  offlineUnverified: boolean;
  busy: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readHint(): string | null {
  try {
    return localStorage.getItem(AUTH_HINT_KEY);
  } catch {
    return null;
  }
}

function writeHint(username: string | null): void {
  try {
    if (username) localStorage.setItem(AUTH_HINT_KEY, username);
    else localStorage.removeItem(AUTH_HINT_KEY);
  } catch {
    // localStorageが使えなくても致命的ではない
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [offlineUnverified, setOfflineUnverified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reconcile = useCallback(async () => {
    try {
      const res = await apiMe();
      setUser({ username: res.username });
      setStatus('authenticated');
      setOfflineUnverified(false);
      writeHint(res.username);
    } catch (e) {
      const err = e as ApiError;
      if (err.isNetworkError) {
        const hint = readHint();
        if (hint) {
          setUser({ username: hint });
          setStatus('authenticated');
          setOfflineUnverified(true);
        } else {
          setStatus('anonymous');
        }
        return;
      }
      setUser(null);
      setStatus('anonymous');
      writeHint(null);
    }
  }, []);

  useEffect(() => {
    reconcile();
  }, [reconcile]);

  useEffect(() => {
    const onOnline = () => {
      if (offlineUnverified) reconcile();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [offlineUnverified, reconcile]);

  const login = useCallback(async (username: string, password: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiLogin(username, password);
      setUser({ username: res.username });
      setStatus('authenticated');
      setOfflineUnverified(false);
      writeHint(res.username);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiRegister(username, password);
      setUser({ username: res.username });
      setStatus('authenticated');
      setOfflineUnverified(false);
      writeHint(res.username);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setBusy(true);
    try {
      await apiLogout();
    } catch {
      // オフラインでもローカルの認証状態は破棄する
    } finally {
      setUser(null);
      setStatus('anonymous');
      setOfflineUnverified(false);
      writeHint(null);
      clearOwnedState();
      setBusy(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo(
    () => ({ status, user, offlineUnverified, busy, error, login, register, logout, clearError }),
    [status, user, offlineUnverified, busy, error, login, register, logout, clearError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
