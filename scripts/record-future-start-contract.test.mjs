import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/components/forms/RecordSheet.tsx', import.meta.url), 'utf8');

assert.match(
  source,
  /recordDate === today\(\)[\s\S]*?localDateTimeToISOString\(recordDate, startTime\) > new Date\(\)\.toISOString\(\)/,
  '今日の手動記録・編集は現在より後の開始時刻を拒否する',
);
assert.match(
  source,
  /toast\('未来の開始時刻は指定できません'\)/,
  '未来時刻を拒否した理由を利用者へ通知する',
);
assert.match(
  source,
  /\(!preset \|\| session\)[\s\S]*?recordDate === today\(\)/,
  'タイマー完了プリセットには手入力時刻の検証を誤適用しない',
);

console.log('✅ future record start time contract passed');
