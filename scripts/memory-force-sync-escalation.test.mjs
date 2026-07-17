import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryContext.tsx', import.meta.url), 'utf8');

assert.match(
  source,
  /const syncForceQueued = useRef\(false\)/,
  'single-flight中に届いた強制同期要求を保持する',
);
assert.match(
  source,
  /if \(syncInFlight\.current\) \{[\s\S]*?if \(force\) syncForceQueued\.current = true;[\s\S]*?return syncInFlight\.current;/,
  '実行中の通常同期へ強制要求が合流した場合に要求を失わない',
);
assert.match(
  source,
  /let runForced = force;[\s\S]*?do \{[\s\S]*?syncForceQueued\.current = false;[\s\S]*?unsyncedAttempts\(runForced \? 20 : 21\)/,
  '各single-flight反復で通常・強制の判定条件を正しく切り替える',
);
assert.match(
  source,
  /if \(!runForced && !hasPendingContentMutations && unsynced\.length < 20\)[\s\S]*?else \{[\s\S]*?flushMemorySync\(target\)/,
  '昇格した強制同期では件数しきい値を通過して送信する',
);
assert.match(
  source,
  /runForced = syncForceQueued\.current;[\s\S]*?\} while \(runForced && mounted\.current && activeRepository\.current === target\)/,
  '通常同期の完了後に保留された強制同期を同じsingle-flight内で実行する',
);
assert.match(
  source,
  /syncInFlight\.current = null;[\s\S]*?syncForceQueued\.current = false/,
  '完了後にsingle-flightと強制要求を両方解除する',
);

console.log('memory force sync escalation contract: ok');
