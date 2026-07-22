import { isMemoryApiError } from './api';
import { MemoryMutationDependencyCycleError } from './mutationDependencyGuard';

export type MemorySyncErrorKind =
  | 'network'
  | 'timeout'
  | 'http'
  | 'conflict'
  | 'validation'
  | 'indexedDb'
  | 'unknown';

export type MemorySyncRetryPolicy =
  | 'when-online'
  | 'retry-soon'
  | 'backoff'
  | 'after-conflict-resolution'
  | 'after-data-fix'
  | 'manual'
  | 'none';

export interface MemorySyncErrorDiagnostic {
  name: string;
  message: string;
  stack?: string;
  cause?: string;
  httpStatus?: number;
  apiKind?: 'network' | 'timeout' | 'http';
}

export interface MemorySyncErrorClassification {
  kind: MemorySyncErrorKind;
  syncStatus: 'offline' | 'conflict' | 'error';
  userMessage: string;
  retryable: boolean;
  retryPolicy: MemorySyncRetryPolicy;
  diagnostic: MemorySyncErrorDiagnostic;
}

const INDEXED_DB_ERROR_NAMES = new Set([
  'AbortError',
  'ConstraintError',
  'DataCloneError',
  'DataError',
  'InvalidAccessError',
  'InvalidStateError',
  'NotFoundError',
  'QuotaExceededError',
  'ReadOnlyError',
  'TransactionInactiveError',
  'UnknownError',
  'VersionError',
]);

function describeUnknown(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function diagnosticOf(error: unknown): MemorySyncErrorDiagnostic {
  if (error instanceof Error) {
    const cause = describeUnknown((error as Error & { cause?: unknown }).cause);
    return {
      name: error.name || 'Error',
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
      ...(cause ? { cause } : {}),
      ...(isMemoryApiError(error) && error.status !== undefined ? { httpStatus: error.status } : {}),
      ...(isMemoryApiError(error) ? { apiKind: error.kind } : {}),
    };
  }
  return {
    name: typeof error,
    message: describeUnknown(error) ?? 'Unknown error',
  };
}

function isIndexedDbError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (typeof DOMException !== 'undefined'
    && error instanceof DOMException
    && INDEXED_DB_ERROR_NAMES.has(error.name)) {
    return true;
  }
  if (INDEXED_DB_ERROR_NAMES.has(error.name)) return true;
  return /IndexedDB|\bIDB\b|object store|database|transaction|オフライン保存/u.test(error.message);
}

function apiMessageOr(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function classifyMemorySyncError(
  error: unknown,
  options: { navigatorOnline?: boolean } = {},
): MemorySyncErrorClassification {
  const diagnostic = diagnosticOf(error);

  if (isMemoryApiError(error)) {
    if (error.kind === 'network') {
      const offline = options.navigatorOnline === false;
      return {
        kind: 'network',
        syncStatus: offline ? 'offline' : 'error',
        userMessage: offline
          ? 'オフラインのため同期を保留しています。暗記データは端末へ保存されています'
          : '同期サーバーへ接続できませんでした。暗記データは端末へ保存されています',
        retryable: true,
        retryPolicy: offline ? 'when-online' : 'backoff',
        diagnostic,
      };
    }

    if (error.kind === 'timeout' || error.status === 408) {
      return {
        kind: 'timeout',
        syncStatus: 'error',
        userMessage: '暗記同期が時間内に完了しませんでした。端末へ保存したまま、しばらくして再試行できます',
        retryable: true,
        retryPolicy: 'retry-soon',
        diagnostic,
      };
    }

    if (error.status === 409) {
      return {
        kind: 'conflict',
        syncStatus: 'conflict',
        userMessage: apiMessageOr(error, '別の端末の変更と競合しました。競合内容を確認してください'),
        retryable: false,
        retryPolicy: 'after-conflict-resolution',
        diagnostic,
      };
    }

    if (error.status === 400 || error.status === 422) {
      return {
        kind: 'validation',
        syncStatus: 'error',
        userMessage: apiMessageOr(error, '同期対象の暗記データを確認できませんでした。該当データを保存し直してください'),
        retryable: false,
        retryPolicy: 'after-data-fix',
        diagnostic,
      };
    }

    const retryable = error.status === 429 || (error.status !== undefined && error.status >= 500);
    return {
      kind: 'http',
      syncStatus: 'error',
      userMessage: retryable
        ? '同期サーバーで一時的な問題が発生しました。暗記データは端末へ保存されています'
        : apiMessageOr(error, '暗記同期の要求が受け付けられませんでした'),
      retryable,
      retryPolicy: retryable ? 'backoff' : 'none',
      diagnostic,
    };
  }

  if (error instanceof MemoryMutationDependencyCycleError) {
    return {
      kind: 'validation',
      syncStatus: 'error',
      userMessage: error.message,
      retryable: false,
      retryPolicy: 'after-data-fix',
      diagnostic,
    };
  }

  if (isIndexedDbError(error)) {
    const quotaExceeded = error instanceof Error && error.name === 'QuotaExceededError';
    return {
      kind: 'indexedDb',
      syncStatus: 'error',
      userMessage: quotaExceeded
        ? '端末の保存容量が不足しているため暗記同期を完了できませんでした。空き容量を確保して再試行してください'
        : '端末内の暗記データを読み書きできませんでした。ブラウザの保存設定を確認して再試行してください',
      retryable: false,
      retryPolicy: 'manual',
      diagnostic,
    };
  }

  return {
    kind: 'unknown',
    syncStatus: 'error',
    userMessage: '暗記同期で予期しない問題が発生しました。暗記データは端末へ保存されています',
    retryable: false,
    retryPolicy: 'manual',
    diagnostic,
  };
}

export function logUnexpectedMemorySyncError(
  classification: MemorySyncErrorClassification,
  error: unknown,
): void {
  if (classification.kind !== 'unknown') return;
  console.error('暗記同期で未分類エラーが発生しました', classification.diagnostic, error);
}
