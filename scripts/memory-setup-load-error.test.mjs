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
  /disabled=\{starting \|\| selectedSetIds\.length === 0 \|\| !eligibilityReady \|\| plannedCount === 0 \|\| Boolean\(eligibilityError\)\}/,
  '件数の読込に失敗した状態と未確認状態では学習開始を許可しない',
);
assert.match(
  source,
  /setEligibleCount\(0\);[\s\S]*?setResolvedEligibilityKey\(undefined\);[\s\S]*?setEligibilityError\(undefined\);[\s\S]*?loadSetBundle/,
  '再読込中に前回の件数・確認キー・エラーを残さない',
);
assert.match(
  source,
  /eligibilityDiagnostic && eligibilityDiagnostic\.excludedCount > 0[\s\S]*?<EligibilityDetails[\s\S]*?partial/,
  '出題可能カードが残る場合も、対象外カードの理由と件数を隠さない',
);
assert.match(
  source,
  /diagnostic\.excludedCount\}件は今回の出題対象外です/,
  '部分除外を学習開始可能な補足として明示する',
);
assert.match(
  source,
  /カードを確認・修正/,
  '対象外カードを確認済みにする管理導線を表示する',
);
assert.match(
  source,
  /eligibleCount === 0 && eligibilityDiagnostic[\s\S]*?partial=\{false\}/,
  '全件対象外の場合は従来どおり開始禁止の診断を表示する',
);

console.log('✅ memory setup load error and partial eligibility contracts passed');
