import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemorySetDetail.tsx', import.meta.url), 'utf8');

assert.match(
  source,
  /const refreshAfterMutation = async[\s\S]*Promise\.allSettled\(\[reload\(\), refresh\(\)\]\)[\s\S]*setReloadKey/,
  '保存後の詳細再読込と一覧更新を操作自体の成功条件から分離し、詳細再読込は再試行する',
);
assert.match(
  source,
  /const requestSyncSafely = \(\) => \{[\s\S]*requestSync\(true\)\.catch\(\(\) => undefined\)/,
  'セット詳細の同期失敗を未処理Promiseにしない',
);
assert.equal(
  source.match(/requestSyncSafely\(\);/gu)?.length,
  4,
  'カード除外・確認済み化・セット更新・セット削除の全経路で安全に同期する',
);
assert.doesNotMatch(
  source,
  /void requestSync\(true\)(?!\.catch)/u,
  'セット詳細から同期を未処理のまま開始しない',
);
assert.doesNotMatch(
  source,
  /await Promise\.all\(\[reload\(\), refresh\(\)\]\)/u,
  '表示更新失敗を保存失敗として扱う旧実装へ戻さない',
);
assert.match(
  source,
  /await deleteMemorySet[\s\S]*try \{[\s\S]*await refresh\(\);[\s\S]*\} catch \(caught\)[\s\S]*requestSyncSafely\(\);[\s\S]*navigate\(\{ name: 'home' \}\)/u,
  'セット削除後の一覧更新失敗でも同期とホーム遷移を続ける',
);
assert.match(
  source,
  /const actionInFlightRef = useRef\(false\)/u,
  'セット詳細の変更操作を再描画前から排他制御する',
);
assert.match(
  source,
  /const runAction = async[\s\S]*if \(actionInFlightRef\.current\) return;[\s\S]*actionInFlightRef\.current = true;[\s\S]*finally \{[\s\S]*actionInFlightRef\.current = false;/u,
  'カード除外・確認済み化・セット更新・セット削除を同期的なsingle-flightロックで保護する',
);
assert.doesNotMatch(
  source,
  /const runAction = async[\s\S]*if \(actionBusy\) return;/u,
  'React stateだけを多重実行防止に使う旧実装へ戻さない',
);

console.log('memory set detail post-save resilience regression passed');
