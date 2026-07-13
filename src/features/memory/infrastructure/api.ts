import type { LocalMemoryAttempt, MemoryConflict, MemoryPendingMutation, RemoteMemoryChanges } from './repositories';

export interface MemoryApiError extends Error {
  status?: number;
  isNetworkError?: boolean;
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

async function memoryRequest<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    const error = new Error('暗記データを同期できません。オフラインで保存を続けます') as MemoryApiError;
    error.isNetworkError = true;
    throw error;
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
    const error = new Error(message) as MemoryApiError;
    error.status = response.status;
    throw error;
  }
  return data as T;
}

export function apiSyncMemory(request: MemorySyncRequest): Promise<MemorySyncResponse> {
  return memoryRequest<MemorySyncResponse>('/api/memory/sync', request);
}
