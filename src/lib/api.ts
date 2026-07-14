export interface ApiError extends Error {
  status?: number;
  isNetworkError?: boolean;
  isTimeout?: boolean;
  isAborted?: boolean;
}

export interface ApiRequestOptions {
  signal?: AbortSignal;
  /** 0以下を指定した場合だけタイムアウトを無効化する。 */
  timeoutMs?: number;
}

/**
 * iOS PWAでは接続だけ残ってレスポンスが返らないケースがあるため、
 * 起動時同期を無期限に待たせない。
 */
export const DEFAULT_API_TIMEOUT_MS = 10_000;

function apiError(message: string, fields: Partial<ApiError> = {}): ApiError {
  return Object.assign(new Error(message) as ApiError, fields);
}

async function request<T>(path: string, init: RequestInit = {}, options: ApiRequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const callerSignal = options.signal ?? init.signal;
  const timeoutMs = options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  let timeoutTriggered = false;

  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) controller.abort(callerSignal.reason);
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });

  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => {
        timeoutTriggered = true;
        controller.abort();
      }, timeoutMs)
    : null;

  const cleanup = () => {
    if (timeout !== null) clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  };
  const transportError = (caught: unknown): ApiError => {
    if (timeoutTriggered) {
      return apiError('サーバーの応答がタイムアウトしました。端末内のデータはそのまま利用できます', {
        isTimeout: true,
      });
    }
    if (callerSignal?.aborted || (caught instanceof Error && caught.name === 'AbortError')) {
      return apiError('リクエストが中断されました', { isAborted: true });
    }
    return apiError('サーバーに接続できません。通信環境を確認してください', {
      isNetworkError: true,
    });
  };

  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      signal: controller.signal,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch (caught) {
    cleanup();
    throw transportError(caught);
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch (caught) {
    if (timeoutTriggered || callerSignal?.aborted || (caught instanceof Error && caught.name === 'AbortError')) {
      cleanup();
      throw transportError(caught);
    }
    // レスポンスボディがない、またはJSONでない場合はHTTP状態だけを使う。
  }
  cleanup();

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `リクエストに失敗しました (${res.status})`;
    throw apiError(message, { status: res.status });
  }

  return data as T;
}

export interface AuthResponse {
  userId: string;
  username: string;
}

export function apiRegister(username: string, password: string, options?: ApiRequestOptions): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }, options);
}

export function apiLogin(username: string, password: string, options?: ApiRequestOptions): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }, options);
}

export function apiLogout(options?: ApiRequestOptions): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }, options);
}

export function apiMe(options?: ApiRequestOptions): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/me', { method: 'GET' }, options);
}

export interface GetDataResponse {
  appState: unknown;
  updatedAt: string | null;
}

export function apiGetData(options?: ApiRequestOptions): Promise<GetDataResponse> {
  return request<GetDataResponse>('/api/data', { method: 'GET' }, options);
}

export function apiPutData(
  appState: unknown,
  expectedUpdatedAt?: string | null,
  options?: ApiRequestOptions,
): Promise<{ ok: boolean; updatedAt: string }> {
  return request<{ ok: boolean; updatedAt: string }>('/api/data', {
    method: 'PUT',
    headers: expectedUpdatedAt === undefined ? undefined : { 'X-Data-Version': expectedUpdatedAt ?? 'null' },
    body: JSON.stringify(appState),
  }, options);
}
