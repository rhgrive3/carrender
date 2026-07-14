import type { AppState } from '../types';
import {
  decodeAppStateChunks,
  encodeAppStateChunks,
  validateAppStateChunkManifest,
} from './appStateChunks';
import type {
  AppStateChunk,
  AppStateChunkManifest,
  AppStateSectionName,
} from './appStateChunks';

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

async function requestWithOneRetry<T>(path: string, init: RequestInit, options: ApiRequestOptions): Promise<T> {
  try {
    return await request<T>(path, init, options);
  } catch (caught) {
    const error = caught as ApiError;
    if (options.signal?.aborted || (!error.isNetworkError && !error.isTimeout)) throw caught;
    return request<T>(path, init, options);
  }
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, operation: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
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

interface ChunkedManifestResponse {
  format?: 'chunked-v1';
  generationId?: string | null;
  updatedAt?: string | null;
  manifest?: AppStateChunkManifest | null;
  legacyAvailable?: boolean;
  /** Allows simple fetch doubles and staged deployments to return the legacy shape. */
  appState?: unknown;
}

interface BeginGenerationResponse {
  generationId: string;
  status: 'staging' | 'committed';
  updatedAt: string | null;
  manifest: AppStateChunkManifest;
}

interface CommitGenerationResponse {
  ok: boolean;
  generationId: string;
  updatedAt: string;
}

function legacyGetData(options: ApiRequestOptions): Promise<GetDataResponse> {
  return request<GetDataResponse>('/api/data', { method: 'GET' }, options);
}

function legacyPutData(
  appState: unknown,
  expectedUpdatedAt: string | null | undefined,
  options: ApiRequestOptions,
): Promise<{ ok: boolean; updatedAt: string }> {
  return request<{ ok: boolean; updatedAt: string }>('/api/data', {
    method: 'PUT',
    headers: expectedUpdatedAt === undefined ? undefined : { 'X-Data-Version': expectedUpdatedAt ?? 'null' },
    body: JSON.stringify(appState),
  }, options);
}

function canFallbackToLegacy(error: ApiError): boolean {
  return error.status === 404 || error.status === 503;
}

export async function apiGetData(options: ApiRequestOptions = {}): Promise<GetDataResponse> {
  let response: ChunkedManifestResponse;
  try {
    response = await request<ChunkedManifestResponse>('/api/data/v2', { method: 'GET' }, options);
  } catch (caught) {
    const error = caught as ApiError;
    if (!canFallbackToLegacy(error)) throw caught;
    return legacyGetData(options);
  }

  if (Object.prototype.hasOwnProperty.call(response, 'appState')) {
    return { appState: response.appState ?? null, updatedAt: response.updatedAt ?? null };
  }
  if (!response.generationId || !response.manifest) {
    return response.legacyAvailable ? legacyGetData(options) : { appState: null, updatedAt: null };
  }
  if (!validateAppStateChunkManifest(response.manifest)) {
    throw apiError('クラウド予定データのmanifestが正しくありません');
  }

  const descriptors = response.manifest.sections.flatMap((section) =>
    Array.from({ length: section.chunkCount }, (_, index) => ({ section: section.name, index })),
  );
  const chunks = await mapConcurrent(descriptors, 4, async ({ section, index }): Promise<AppStateChunk> => {
    const chunk = await request<{
      section: AppStateSectionName;
      index: number;
      json: string;
      byteLength: number;
      hash: string;
    }>('/api/data/v2', {
      method: 'POST',
      body: JSON.stringify({ action: 'getChunk', generationId: response.generationId, section, index }),
    }, options);
    return chunk;
  });
  const appState = await decodeAppStateChunks(response.manifest, chunks);
  return { appState, updatedAt: response.updatedAt ?? null };
}

export async function apiPutData(
  appState: unknown,
  expectedUpdatedAt?: string | null,
  options: ApiRequestOptions = {},
): Promise<{ ok: boolean; updatedAt: string }> {
  const encoded = await encodeAppStateChunks(appState as AppState);
  const mutationId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `mutation_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  let begin: BeginGenerationResponse;
  try {
    begin = await requestWithOneRetry<BeginGenerationResponse>('/api/data/v2', {
      method: 'POST',
      body: JSON.stringify({
        action: 'begin',
        mutationId,
        expectedUpdatedAt: expectedUpdatedAt ?? null,
        manifest: encoded.manifest,
      }),
    }, options);
  } catch (caught) {
    const error = caught as ApiError;
    if (!canFallbackToLegacy(error)) throw caught;
    return legacyPutData(appState, expectedUpdatedAt, options);
  }

  if (begin.status === 'committed' && begin.updatedAt) {
    return { ok: true, updatedAt: begin.updatedAt };
  }
  if (!begin.generationId || !validateAppStateChunkManifest(begin.manifest)) {
    throw apiError('クラウド保存世代の開始応答が正しくありません');
  }

  await mapConcurrent(encoded.chunks, 4, async (chunk) => {
    await requestWithOneRetry<{ ok: boolean }>('/api/data/v2', {
      method: 'POST',
      body: JSON.stringify({
        action: 'putChunk',
        generationId: begin.generationId,
        section: chunk.section,
        index: chunk.index,
        json: chunk.json,
        hash: chunk.hash,
      }),
    }, options);
  });

  const committed = await requestWithOneRetry<CommitGenerationResponse>('/api/data/v2', {
    method: 'POST',
    body: JSON.stringify({ action: 'commit', generationId: begin.generationId }),
  }, options);
  return { ok: committed.ok, updatedAt: committed.updatedAt };
}
