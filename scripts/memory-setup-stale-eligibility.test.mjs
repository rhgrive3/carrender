import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryStudySetup.tsx', import.meta.url), 'utf8');

assert.match(
  source,
  /const eligibilityKey = useMemo\([\s\S]*?selectedSetIds[\s\S]*?direction/,
  '選択セットと出題方向を件数確認結果の識別キーに含める',
);
assert.match(
  source,
  /resolvedEligibilityKey === eligibilityKey/,
  '現在の条件と一致する確認結果だけを準備完了として扱う',
);
assert.match(
  source,
  /setResolvedEligibilityKey\(undefined\)[\s\S]*?loadSetBundle/,
  '条件変更後の再読込開始時に旧確認結果を無効化する',
);
assert.match(
  source,
  /setEligibleCount\(targets\.length\);[\s\S]*?setResolvedEligibilityKey\(eligibilityKey\)/,
  '件数読込成功時に同じ条件キーを確定する',
);
assert.match(
  source,
  /if \(!repository \|\| starting \|\| !eligibilityReady \|\| plannedCount === 0 \|\| eligibilityError\) return/,
  'UIのdisabled属性だけに頼らず開始処理でも未確認条件を拒否する',
);
assert.match(
  source,
  /!eligibilityReady[\s\S]*?'カード件数を確認中…'/,
  '読込中をカード0件と誤表示せず確認中として案内する',
);
assert.match(
  source,
  /disabled=\{starting \|\| selectedSetIds\.length === 0 \|\| !eligibilityReady \|\| plannedCount === 0 \|\| Boolean\(eligibilityError\)\}/,
  '現在条件の件数確認が終わるまで開始ボタンを無効化する',
);

console.log('✅ memory setup stale eligibility contract passed');
