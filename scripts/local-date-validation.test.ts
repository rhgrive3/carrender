import assert from 'node:assert/strict';
import { localDateTimeToISOString } from '../src/lib/date';

assert.equal(
  localDateTimeToISOString('2026-07-15', '20:04'),
  '2026-07-15T11:04:00.000Z',
  '有効な日本時間はUTCへ変換できる',
);
assert.throws(
  () => localDateTimeToISOString('2026-02-30', '12:00'),
  /INVALID_LOCAL_DATE/,
  '存在しない日付を翌月へ暗黙補正しない',
);
assert.throws(
  () => localDateTimeToISOString('2025-02-29', '12:00'),
  /INVALID_LOCAL_DATE/,
  '平年の2月29日を受け入れない',
);
assert.equal(
  localDateTimeToISOString('2024-02-29', '12:00'),
  '2024-02-29T03:00:00.000Z',
  'うるう日の正しい日付は受け入れる',
);
assert.throws(
  () => localDateTimeToISOString('2026-7-15' as never, '12:00'),
  /INVALID_LOCAL_DATE/,
  'ゼロ埋めされていない日付を受け入れない',
);
assert.throws(
  () => localDateTimeToISOString('2026-07-15junk' as never, '12:00'),
  /INVALID_LOCAL_DATE/,
  '日付末尾の余分な文字を受け入れない',
);

console.log('✅ local calendar date validation regressions passed');
