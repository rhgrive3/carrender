import type { LocalMemoryAttempt, MemoryConflict, MemoryPendingMutation, RemoteMemoryChanges } from './repositories';

export const MEMORY_API_ERROR_SOURCE = 'memory-api' as const;
export type MemoryApiErrorKind = 'network' | 'timeout' | 'http';

export interface MemoryApiError extends Error {
  readonly source: typeof MEMORY_API_ERROR_SOURCE;
  readonly kind: MemoryApiErrorKind;
  readonly status?: number;
  readonly cause?: unknown;
}

export class MemoryApiRequestError extends Error implements MemoryApiError {
  readonly source = MEMORY_API_ERROR_SOURCE;

  constructor(
    message: string,
    readonly kind: MemoryApiErrorKind,
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MemoryApiError';
  }
}

export function isMemoryApiError(value: unknown): value is MemoryApiError {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MemoryApiError>;
  if (candidate.source !== MEMORY_API_ERROR_SOURCE
    || candidate.name !== 'MemoryApiError'
    || typeof candidate.message !== 'string'
    || (candidate.kind !== 'network' && candidate.kind !== 'timeout' && candidate.kind !== 'http')) {
    return false;
  }
  return candidate.kind === 'http'
    ? typeof candidate.status === 'number' && Number.isInteger(candidate.status) && candidate.status >= 100 && candidate.status <= 599
    : candidate.status === undefined;
}

export interface MemorySyncRequest {
  schemaVersion: 1;
  clientId: string;
  cursor?: string;
  mutations: MemoryPendingMutation[];
  attempts: LocalMemoryAttempt[];
}

export interface MemorySyncResponse {
  schemaVersion: 1;
  serverTime: string;
  cursor: string;
  acceptedMutationIds: string[];
  acceptedAttemptIds: string[];
  conflicts: MemoryConflict[];
  changes: RemoteMemoryChanges;
  hasMore?: boolean;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function memoryRequest<T>(path: string, body: unknown): Promise<T> {
  // Serialization failures are programming/validation errors, not network
  // failures. Keep them outside the fetch catch so the sync classifier can
  // retain the real cause.
  const serializedBody = JSON.stringify(body);
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: serializedBody,
    });
  } catch (caught) {
    if (isAbortError(caught)) {
      throw new MemoryApiRequestError(
        '暗記同期が時間内に完了しませんでした',
        'timeout',
        undefined,
        caught,
      );
    }
    throw new MemoryApiRequestError(
      '暗記データを同期できません。端末への保存は続けられます',
      'network',
      undefined,
      caught,
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
      ? (data as { error: string }).error
      : `暗記データの同期に失敗しました (${response.status})`;
    throw new MemoryApiRequestError(message, 'http', response.status);
  }
  return data as T;
}

export function apiSyncMemory(request: MemorySyncRequest): Promise<MemorySyncResponse> {
  return memoryRequest<MemorySyncResponse>('/api/memory/sync', request);
}
