import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  apiExistingMemoryAttemptIds,
  MEMORY_ATTEMPT_RECEIPT_BATCH_SIZE,
} from '../src/features/memory/infrastructure/api';

assert.equal(MEMORY_ATTEMPT_RECEIPT_BATCH_SIZE, 500, 'D1 bind上限内でreceiptをchunk確認する');

const originalFetch = globalThis.fetch;
try {
  let requestBody: unknown;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      schemaVersion: 1,
      serverTime: '2026-07-23T00:00:00.000Z',
      existingAttemptIds: ['attempt-1'],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const response = await apiExistingMemoryAttemptIds(['attempt-1', 'attempt-1', 'attempt-2']);
  assert.deepEqual(requestBody, {
    schemaVersion: 1,
    attemptIds: ['attempt-1', 'attempt-2'],
  }, '重複IDを除いてreceipt確認する');
  assert.deepEqual(response.existingAttemptIds, ['attempt-1']);
  await assert.rejects(
    apiExistingMemoryAttemptIds(Array.from({ length: 501 }, (_, index) => `attempt-${index}`)),
    /500件ずつ/u,
    'client側でも過大batchを送らない',
  );
} finally {
  globalThis.fetch = originalFetch;
}

const endpointSource = readFileSync('functions/api/memory/attempt-receipts.ts', 'utf8');
const restoreSource = readFileSync('src/features/memory/ui/MemoryBackupRestore.tsx', 'utf8');
assert.match(endpointSource, /WHERE user_id = \? AND attempt_id IN/u, 'receiptは現在のログインaccount内だけで照会する');
assert.match(endpointSource, /MAX_ATTEMPT_IDS = 500/u, 'server側も照会件数を制限する');
assert.match(restoreSource, /filter\(\(attempt\) => Boolean\(attempt\.syncedAt\)\)/u, 'export時receiptがあるattemptだけを照会候補にする');
assert.match(restoreSource, /offset \+= MEMORY_ATTEMPT_RECEIPT_BATCH_SIZE/u, '大量履歴をchunk処理する');
assert.match(restoreSource, /catch \(caught\)[\s\S]*安全側で再送/u, '確認不能なattemptは再送へ倒す');
assert.match(restoreSource, /commitSyncResponse\([\s\S]*acceptedAttemptIds/u, 'server存在確認済みattemptだけを原子的receipt commitする');
assert.match(restoreSource, /回答履歴の同期状況を確認中/u, '復元中の確認進捗を表示する');
assert.match(restoreSource, /await actionRepository\.replaceFromBackup[\s\S]*commitSyncResponse[\s\S]*requestSync/u, '復元後にreceiptを反映してから通常同期を開始する');

console.log('✅ memory backup attempt receipt contracts passed');
