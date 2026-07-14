/** Regression tests for the browser API client timeout, cancellation, and chunk protocol contract. */
/// <reference types="node" />
import { isDeepStrictEqual } from 'node:util';
import { apiGetData, apiPutData, type ApiError } from '../src/lib/api';
import { encodeAppStateChunks } from '../src/lib/appStateChunks';
import { emptyState } from '../src/state/AppContext';

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ✅ ${name}`);
  else { failures += 1; console.error(`  ❌ ${name}`, detail ?? ''); }
}
const originalFetch = globalThis.fetch;
function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
function abortablePendingFetch(): typeof fetch {
  return ((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const rejectAbort = () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); };
    if (init?.signal?.aborted) rejectAbort();
    else init?.signal?.addEventListener('abort', rejectAbort, { once: true });
  })) as typeof fetch;
}
function pendingBodyFetch(): typeof fetch {
  return (async (_: RequestInfo | URL, init?: RequestInit) => ({
    ok: true, status: 200,
    json: () => new Promise<unknown>((_resolve, reject) => {
      const rejectAbort = () => { const error = new Error('aborted body'); error.name = 'AbortError'; reject(error); };
      if (init?.signal?.aborted) rejectAbort();
      else init?.signal?.addEventListener('abort', rejectAbort, { once: true });
    }),
  } as Response)) as typeof fetch;
}

console.log('--- API client: compatible simple response ---');
globalThis.fetch = (async () => jsonResponse({ appState: null, updatedAt: null })) as typeof fetch;
const success = await apiGetData({ timeoutMs: 100 });
check('段階deploy用の旧shapeを返せる', success.appState === null && success.updatedAt === null, success);

console.log('--- API client: chunked download ---');
const chunkedState = {
  ...emptyState(), onboarded: true,
  goal: { id: 'goal-1', name: '医学部合格', examDate: '2027-02-01', createdAt: '2026-07-14T00:00:00.000Z' },
};
const encoded = await encodeAppStateChunks(chunkedState, 1024);
const generationId = 'generation-client-test';
const getCalls: { path: string; body?: unknown }[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = String(input);
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  getCalls.push({ path, body });
  if (init?.method === 'GET') return jsonResponse({ format: 'chunked-v1', generationId, updatedAt: '2026-07-14T00:00:00.000Z', manifest: encoded.manifest });
  const descriptor = body as { section: string; index: number };
  const chunk = encoded.chunks.find((entry) => entry.section === descriptor.section && entry.index === descriptor.index);
  return chunk ? jsonResponse(chunk) : jsonResponse({ error: 'missing' }, 404);
}) as typeof fetch;
const downloaded = await apiGetData({ timeoutMs: 500 });
check('manifestから全chunkを取得してAppStateを復元', isDeepStrictEqual(downloaded.appState, chunkedState), downloaded);
check('manifest記載chunk数だけ取得', getCalls.filter((call) => (call.body as { action?: string } | undefined)?.action === 'getChunk').length === encoded.manifest.totalChunks, getCalls);

console.log('--- API client: chunked upload ---');
const uploadCalls: { action?: string; body: Record<string, unknown> }[] = [];
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
  uploadCalls.push({ action: body.action as string | undefined, body });
  if (body.action === 'begin') return jsonResponse({ generationId: 'generation-upload-test', status: 'staging', updatedAt: null, manifest: body.manifest }, 201);
  if (body.action === 'putChunk') return jsonResponse({ ok: true }, 201);
  if (body.action === 'commit') return jsonResponse({ ok: true, generationId: 'generation-upload-test', updatedAt: '2026-07-14T00:00:01.000Z' });
  return jsonResponse({ error: 'unexpected action' }, 400);
}) as typeof fetch;
const uploaded = await apiPutData(chunkedState, null, { timeoutMs: 500 });
check('begin→全chunk→commitの順で保存', uploadCalls[0]?.action === 'begin'
  && uploadCalls.filter((call) => call.action === 'putChunk').length === encoded.manifest.totalChunks
  && uploadCalls.at(-1)?.action === 'commit', uploadCalls);
check('commit世代を楽観ロックversionとして返す', uploaded.updatedAt === '2026-07-14T00:00:01.000Z', uploaded);
check('beginでnull baseを明示', uploadCalls[0]?.body.expectedUpdatedAt === null, uploadCalls[0]);

console.log('--- API client: safe legacy fallback ---');
let fallbackCalls = 0;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  fallbackCalls += 1;
  return String(input) === '/api/data/v2'
    ? jsonResponse({ error: 'migration missing', code: 'MAIN_STATE_SCHEMA_MISSING' }, 503)
    : jsonResponse({ appState: chunkedState, updatedAt: 'legacy-version' });
}) as typeof fetch;
const legacy = await apiGetData({ timeoutMs: 100 });
check('専用migration未適用時だけlegacy GETへfallback', fallbackCalls === 2 && legacy.updatedAt === 'legacy-version', { fallbackCalls, legacy });

let generic503Error: ApiError | null = null;
fallbackCalls = 0;
globalThis.fetch = (async () => { fallbackCalls += 1; return jsonResponse({ error: 'temporary outage' }, 503); }) as typeof fetch;
try { await apiGetData({ timeoutMs: 100 }); } catch (caught) { generic503Error = caught as ApiError; }
check('一般503ではlegacyへ分岐しない', fallbackCalls === 1 && generic503Error?.status === 503, { fallbackCalls, generic503Error });

console.log('--- API client: bounded timeout ---');
globalThis.fetch = abortablePendingFetch();
const timeoutStartedAt = Date.now();
let timeoutError: ApiError | null = null;
try { await apiGetData({ timeoutMs: 15 }); } catch (caught) { timeoutError = caught as ApiError; }
const timeoutElapsed = Date.now() - timeoutStartedAt;
check('応答しないfetchを設定時間で中断する', timeoutError?.isTimeout === true && timeoutElapsed < 500, { timeoutError, timeoutElapsed });
check('タイムアウトをオフライン扱いにしない', timeoutError?.isNetworkError !== true, timeoutError);
check('端末データを利用できる旨を案内する', timeoutError?.message.includes('端末内のデータ') === true, timeoutError?.message);

console.log('--- API client: stalled response body ---');
globalThis.fetch = pendingBodyFetch();
let bodyTimeoutError: ApiError | null = null;
try { await apiGetData({ timeoutMs: 15 }); } catch (caught) { bodyTimeoutError = caught as ApiError; }
check('ヘッダー受信後に本文が停止してもタイムアウトする', bodyTimeoutError?.isTimeout === true, bodyTimeoutError);

console.log('--- API client: caller cancellation ---');
globalThis.fetch = abortablePendingFetch();
const controller = new AbortController();
const cancelled = apiGetData({ signal: controller.signal, timeoutMs: 1_000 });
controller.abort();
let cancelledError: ApiError | null = null;
try { await cancelled; } catch (caught) { cancelledError = caught as ApiError; }
check('呼び出し元のAbortSignalを伝播する', cancelledError?.isAborted === true && cancelledError?.isTimeout !== true, cancelledError);

console.log('--- API client: HTTP error body ---');
globalThis.fetch = (async () => jsonResponse({ error: '競合しています', code: 'CONFLICT_TEST' }, 409)) as typeof fetch;
let httpError: ApiError | null = null;
try { await apiGetData({ timeoutMs: 100 }); } catch (caught) { httpError = caught as ApiError; }
check('HTTPステータス・コード・サーバー文を保持', httpError?.status === 409 && httpError.code === 'CONFLICT_TEST' && httpError.message === '競合しています', httpError);

globalThis.fetch = originalFetch;
console.log(failures === 0 ? '\n🎉 ALL PASS (api client)' : `\n💥 ${failures} FAILURES (api client)`);
process.exit(failures === 0 ? 0 : 1);
