export interface ApiError extends Error {
  status?: number;
  isNetworkError?: boolean;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch {
    const err = new Error('サーバーに接続できません。通信環境を確認してください') as ApiError;
    err.isNetworkError = true;
    throw err;
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // レスポンスボディがない場合は無視
  }

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `リクエストに失敗しました (${res.status})`;
    const err = new Error(message) as ApiError;
    err.status = res.status;
    throw err;
  }

  return data as T;
}

export interface AuthResponse {
  userId: string;
  username: string;
}

export function apiRegister(username: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function apiLogin(username: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function apiLogout(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
}

export function apiMe(): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/me', { method: 'GET' });
}

export interface GetDataResponse {
  appState: unknown;
  updatedAt: string | null;
}

export function apiGetData(): Promise<GetDataResponse> {
  return request<GetDataResponse>('/api/data', { method: 'GET' });
}

export function apiPutData(appState: unknown, expectedUpdatedAt?: string | null): Promise<{ ok: boolean; updatedAt: string }> {
  return request<{ ok: boolean; updatedAt: string }>('/api/data', {
    method: 'PUT',
    headers: expectedUpdatedAt === undefined ? undefined : { 'X-Data-Version': expectedUpdatedAt ?? 'null' },
    body: JSON.stringify(appState),
  });
}
