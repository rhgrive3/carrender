import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { apiLogin, apiLogout, apiMe, apiRegister } from '../lib/api';
import type { ApiError } from '../lib/api';
import { clearOwnedState } from '../lib/storage';
import { migrateMemoryDatabaseOwner } from '../features/memory/infrastructure/indexedDb';

const AUTH_HINT_KEY = 'studycommander_auth_hint';
const AUTH_USER_HINT_KEY = 'studycommander_auth_user_v2';

export type AuthStatus = 'checking' | 'authenticated' | 'anonymous';

export interface AuthUser {
  /** Stable server identity; absent only for a pre-v2 offline hint. */
  id?: string;
  username: string;
  /** Legacy fallback only when a quota/browser error prevents owner migration. */
  memoryOwner?: string;
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

function readHint(): AuthUser | null {
  try {
    const encoded = localStorage.getItem(AUTH_USER_HINT_KEY);
    if (encoded) {
      const value: unknown = JSON.parse(encoded);
      if (value && typeof value === 'object'
        && typeof (value as { id?: unknown }).id === 'string'
        && typeof (value as { username?: unknown }).username === 'string') {
        return value as AuthUser;
      }
    }
    const legacyUsername = localStorage.getItem(AUTH_HINT_KEY);
    return legacyUsername ? { username: legacyUsername } : null;
  } catch {
    return null;
  }
}

function writeHint(user: AuthUser | null): void {
  try {
    if (user) {
      // Keep the legacy text hint for backward compatibility and offline upgrades.
      localStorage.setItem(AUTH_HINT_KEY, user.username);
      if (user.id) localStorage.setItem(AUTH_USER_HINT_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(AUTH_HINT_KEY);
      localStorage.removeItem(AUTH_USER_HINT_KEY);
    }
  } catch {
    // localStorageが使えなくても致命的ではない
  }
}

async function migratedUser(userId: string, username: string): Promise<AuthUser> {
  try {
    await migrateMemoryDatabaseOwner(username, userId);
    return { id: userId, username };
  } catch {
    // Keep the original owner visible instead of hiding or deleting offline data.
    return { id: userId, username, memoryOwner: username };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [offlineUnverified, setOfflineUnverified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationInFlight = useRef(false);
  const authStateVersion = useRef(0);
  const reconciliationInFlight = useRef<Promise<void> | null>(null);

  const beginOperation = useCallback((): boolean => {
    if (operationInFlight.current) return false;
    operationInFlight.current = true;
    authStateVersion.current += 1;
    setBusy(true);
    return true;
  }, []);

  const endOperation = useCallback(() => {
    operationInFlight.current = false;
    setBusy(false);
  }, []);

  const reconcile = useCallback((): Promise<void> => {
    const existing = reconciliationInFlight.current;
    if (existing) return existing;

    const startedAtVersion = authStateVersion.current;
    const isCurrent = () => authStateVersion.current === startedAtVersion;
    const task = (async () => {
      try {
        const res = await apiMe();
        if (!isCurrent()) return;
        const nextUser = await migratedUser(res.userId, res.username);
        if (!isCurrent()) return;
        setUser(nextUser);
        setStatus('authenticated');
        setOfflineUnverified(false);
        writeHint(nextUser);
      } catch (e) {
        if (!isCurrent()) return;
        const err = e as ApiError;
        if (err.isNetworkError) {
          const hint = readHint();
          if (hint) {
            setUser(hint);
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
    })();

    reconciliationInFlight.current = task;
    void task.finally(() => {
      if (reconciliationInFlight.current === task) reconciliationInFlight.current = null;
    });
    return task;
  }, []);

  const waitForReconciliation = useCallback(async () => {
    const pending = reconciliationInFlight.current;
    if (pending) await pending;
  }, []);

  useEffect(() => {
    void reconcile();
  }, [reconcile]);

  useEffect(() => {
    const onOnline = () => {
      if (offlineUnverified) void reconcile();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [offlineUnverified, reconcile]);

  const login = useCallback(async (username: string, password: string) => {
    if (!beginOperation()) return false;
    setError(null);
    try {
      await waitForReconciliation();
      const res = await apiLogin(username, password);
      const nextUser = await migratedUser(res.userId, res.username);
      setUser(nextUser);
      setStatus('authenticated');
      setOfflineUnverified(false);
      writeHint(nextUser);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      endOperation();
    }
  }, [beginOperation, endOperation, waitForReconciliation]);

  const register = useCallback(async (username: string, password: string) => {
    if (!beginOperation()) return false;
    setError(null);
    try {
      await waitForReconciliation();
      const res = await apiRegister(username, password);
      const nextUser = await migratedUser(res.userId, res.username);
      setUser(nextUser);
      setStatus('authenticated');
      setOfflineUnverified(false);
      writeHint(nextUser);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      endOperation();
    }
  }, [beginOperation, endOperation, waitForReconciliation]);

  const logout = useCallback(async () => {
    if (!beginOperation()) return;
    try {
      await waitForReconciliation();
      await apiLogout();
    } catch {
      // オフラインでもローカルの認証状態は破棄する
    } finally {
      setUser(null);
      setStatus('anonymous');
      setOfflineUnverified(false);
      writeHint(null);
      clearOwnedState();
      // Account-scoped IndexedDB is retained. It can contain offline edits and
      // attempts that have not reached D1 yet; the next login resumes their sync.
      endOperation();
    }
  }, [beginOperation, endOperation, waitForReconciliation]);

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
