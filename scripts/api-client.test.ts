/** Regression tests for the browser API client timeout and cancellation contract. */
/// <reference types="node" />
import { apiGetData, type ApiError } from '../src/lib/api';

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.error(`  ❌ ${name}`, detail ?? '');
  }
}

const originalFetch = globalThis.fetch;

/** A fetch double that only settles when the supplied AbortSignal fires. */
function abortablePendingFetch(): typeof fetch {
  return ((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const rejectAbort = () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (init?.signal?.aborted) rejectAbort();
    else init?.signal?.addEventListener('abort', rejectAbort, { once: true });
  })) as typeof fetch;
}

console.log('--- API client: successful response ---');
globalThis.fetch = (async () => new Response(JSON.stringify({ appState: null, updatedAt: null }), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
})) as typeof fetch;
const success = await apiGetData({ timeoutMs: 100 });
check('正常レスポンスをJSONとして返す', success.appState === null && success.updatedAt === null, success);

console.log('--- API client: bounded timeout ---');
globalThis.fetch = abortablePendingFetch();
const timeoutStartedAt = Date.now();
let timeoutError: ApiError | null = null;
try {
  await apiGetData({ timeoutMs: 15 });
} catch (caught) {
  timeoutError = caught as ApiError;
}
const timeoutElapsed = Date.now() - timeoutStartedAt;
check('応答しないfetchを設定時間で中断する', timeoutError?.isTimeout === true && timeoutElapsed < 500, {
  error: timeoutError,
  timeoutElapsed,
});
check('タイムアウトをオフライン扱いにしない', timeoutError?.isNetworkError !== true, timeoutError);
check('端末データを利用できる旨を案内する', timeoutError?.message.includes('端末内のデータ') === true, timeoutError?.message);

console.log('--- API client: caller cancellation ---');
globalThis.fetch = abortablePendingFetch();
const controller = new AbortController();
const cancelled = apiGetData({ signal: controller.signal, timeoutMs: 1_000 });
controller.abort();
let cancelledError: ApiError | null = null;
try {
  await cancelled;
} catch (caught) {
  cancelledError = caught as ApiError;
}
check('呼び出し元のAbortSignalを伝播する', cancelledError?.isAborted === true && cancelledError?.isTimeout !== true, cancelledError);

console.log('--- API client: HTTP error body ---');
globalThis.fetch = (async () => new Response(JSON.stringify({ error: '競合しています' }), {
  status: 409,
  headers: { 'Content-Type': 'application/json' },
})) as typeof fetch;
let httpError: ApiError | null = null;
try {
  await apiGetData({ timeoutMs: 100 });
} catch (caught) {
  httpError = caught as ApiError;
}
check('HTTPステータスとサーバーエラー文を保持する', httpError?.status === 409 && httpError.message === '競合しています', httpError);

globalThis.fetch = originalFetch;
console.log(failures === 0 ? '\n🎉 ALL PASS (api client)' : `\n💥 ${failures} FAILURES (api client)`);
process.exit(failures === 0 ? 0 : 1);
