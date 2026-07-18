import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const home = await readFile(new URL('../src/features/memory/ui/MemoryHome.tsx', import.meta.url), 'utf8');

assert.match(
  home,
  /const saveInFlight = useRef\(false\)[\s\S]*if \(!repository \|\| saveInFlight\.current \|\| !name\.trim\(\)\) return;[\s\S]*saveInFlight\.current = true[\s\S]*finally \{[\s\S]*saveInFlight\.current = false/u,
  '暗記セット作成を同期ロックでsingle-flight化する',
);
assert.match(
  home,
  /const startInFlight = useRef\(false\)[\s\S]*if \(!repository \|\| startInFlight\.current \|\| summary\.eligible === 0\) return;[\s\S]*startInFlight\.current = true[\s\S]*finally \{[\s\S]*startInFlight\.current = false/u,
  'ホームの即時学習開始を同期ロックでsingle-flight化する',
);
assert.match(
  home,
  /const created = await createSimpleStudySession[\s\S]*try \{[\s\S]*await refresh\(\);[\s\S]*\} catch \(caught\) \{[\s\S]*console\.error[\s\S]*\}[\s\S]*navigate\(\{ name: 'study', sessionId: created\.session\.id \}\)/u,
  'セッション作成後の一覧更新失敗でも作成済みセッションへ遷移する',
);
assert.doesNotMatch(
  home,
  /const created = await createSimpleStudySession[\s\S]*await refresh\(\);\s*navigate\(\{ name: 'study'/u,
  '一覧更新を学習開始全体の成功条件へ戻さない',
);
assert.doesNotMatch(
  home,
  /if \(!repository \|\| saving \|\| !name\.trim\(\)\) return/u,
  'React stateだけをセット作成の排他制御へ使わない',
);
assert.doesNotMatch(
  home,
  /if \(!repository \|\| startingSetId \|\| summary\.eligible === 0\) return/u,
  'React stateだけを学習開始の排他制御へ使わない',
);

console.log('✅ memory home single-flight regressions passed');
