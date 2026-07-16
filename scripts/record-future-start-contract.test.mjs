import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/components/forms/RecordSheet.tsx', import.meta.url), 'utf8');

assert.match(
  source,
  /try\s*\{[\s\S]*?localDateTimeToISOString\(recordDate, startTime\)[\s\S]*?\}\s*catch\s*\{[\s\S]*?toast\('学習日と開始時刻を正しく入力してください'\)/,
  '空欄・不正な学習日または開始時刻は例外で落とさず入力エラーとして通知する',
);
assert.match(
  source,
  /recordDate === today\(\)[\s\S]*?resolvedStartedAt > new Date\(\)\.toISOString\(\)/,
  '今日の手動記録・編集は現在より後の開始時刻を拒否する',
);
assert.match(
  source,
  /toast\('未来の開始時刻は指定できません'\)/,
  '未来時刻を拒否した理由を利用者へ通知する',
);
assert.match(
  source,
  /if \(!preset \|\| session\)[\s\S]*?localDateTimeToISOString\(recordDate, startTime\)/,
  'タイマー完了プリセットには手入力日時の検証を誤適用しない',
);

console.log('✅ record date/time validation contract passed');
