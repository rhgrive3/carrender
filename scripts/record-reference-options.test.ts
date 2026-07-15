import assert from 'node:assert/strict';
import {
  missingRecordMaterialOption,
  missingRecordSubjectOption,
} from '../src/lib/recordReferences';

assert.equal(
  missingRecordSubjectOption([{ id: 'subject-active' }], 'subject-active'),
  null,
  '現役科目には補助選択肢を出さない',
);
assert.deepEqual(
  missingRecordSubjectOption([{ id: 'subject-active' }], 'subject-deleted'),
  { id: 'subject-deleted', label: '削除済みの科目' },
  '削除済み科目を空欄にしない',
);

assert.equal(
  missingRecordMaterialOption([{ id: 'material-active' }], 'material-active', '青チャート'),
  null,
  '表示候補にある教材には補助選択肢を出さない',
);
assert.deepEqual(
  missingRecordMaterialOption([], 'material-deleted', '青チャート 例題1〜10'),
  { id: 'material-deleted', label: '青チャート 例題1〜10（削除済み）' },
  '削除済み教材は元の記録名とともに表示する',
);
assert.deepEqual(
  missingRecordMaterialOption([], 'material-deleted', '  '),
  { id: 'material-deleted', label: '削除済みの教材' },
  '名称が残っていない場合も空欄にしない',
);
assert.equal(missingRecordMaterialOption([], null, ''), null, '教材なしは欠損参照として扱わない');

console.log('✅ deleted record reference option regressions passed');
