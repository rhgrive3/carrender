import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemorySetDetail.tsx', import.meta.url), 'utf8');

assert.match(
  source,
  /const refreshAfterMutation = async[\s\S]*Promise\.allSettled\(\[reload\(isCurrent\), refresh\(\)\]\)[\s\S]*if \(isCurrent\(\)\) setReloadKey/,
  '保存後の詳細再読込と一覧更新を操作自体の成功条件から分離し、現在のセットだけ再試行する',
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
  /await deleteMemorySet[\s\S]*try \{[\s\S]*await refresh\(\);[\s\S]*\} catch \(caught\)[\s\S]*requestSyncSafely\(\);[\s\S]*if \(isCurrent\(\)\) navigate\(\{ name: 'home' \}\)/u,
  'セット削除後の一覧更新失敗でも同期を続け、現在のセットだけホームへ遷移する',
);
assert.match(
  source,
  /const actionInFlightRef = useRef\(false\)/u,
  'セット詳細の変更操作を再描画前から排他制御する',
);
assert.match(
  source,
  /const actionTokenRef = useRef\(0\)[\s\S]*const activeSetIdRef = useRef\(setId\)/u,
  'セット切替をまたぐ古い操作完了を識別する',
);
assert.match(
  source,
  /const runAction = async[\s\S]*if \(actionInFlightRef\.current\) return;[\s\S]*const actionToken = \+\+actionTokenRef\.current;[\s\S]*const isCurrent = \(\) => activeSetIdRef\.current === actionSetId && actionTokenRef\.current === actionToken;[\s\S]*if \(isCurrent\(\)\) \{[\s\S]*actionInFlightRef\.current = false;[\s\S]*setActionBusy\(false\);/u,
  '古い操作のfinallyが新しいセットの処理中状態を解除しない',
);
assert.match(
  source,
  /if \(isCurrent\(\)\) toast\(caught instanceof Error \? caught\.message : fallback\)/u,
  '古い操作の失敗通知を新しいセットへ表示しない',
);
assert.match(
  source,
  /const reload = async \(shouldApply:[\s\S]*if \(!shouldApply\(\)\) return;[\s\S]*setBundle\(next\)/u,
  '古いセットの再読込結果で現在表示を上書きしない',
);
assert.doesNotMatch(
  source,
  /const runAction = async[\s\S]*if \(actionBusy\) return;/u,
  'React stateだけを多重実行防止に使う旧実装へ戻さない',
);

console.log('memory set detail post-save resilience regression passed');
