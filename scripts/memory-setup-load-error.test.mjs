import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryStudySetup.tsx', import.meta.url), 'utf8');

assert.match(
  source,
  /loadSetBundle\(selectedSetIds\)[\s\S]*?\.catch\(\(caught\) => \{[\s\S]*?setEligibleCount\(0\)[\s\S]*?setEligibilityError/,
  'セット読込失敗を未処理にせず、古い出題件数を消してエラー状態へ移す',
);
assert.match(
  source,
  /eligibilityError[\s\S]*?role="alert"[\s\S]*?カード件数を読み込めませんでした/,
  '読込失敗を利用者と支援技術へ通知する',
);
assert.match(
  source,
  /disabled=\{starting \|\| selectedSetIds\.length === 0 \|\| plannedCount === 0 \|\| Boolean\(eligibilityError\)\}/,
  '件数の読込に失敗した状態では学習開始を許可しない',
);
assert.match(
  source,
  /setEligibleCount\(0\);[\s\S]*?setEligibilityError\(undefined\);[\s\S]*?loadSetBundle/,
  '再読込中に前回の件数やエラーを残さない',
);

console.log('✅ memory setup load error contract passed');
