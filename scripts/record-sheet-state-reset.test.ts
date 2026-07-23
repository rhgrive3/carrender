import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/forms/RecordSheet.tsx', import.meta.url), 'utf8');
const sheet = readFileSync(new URL('../src/components/ui/Sheet.tsx', import.meta.url), 'utf8');

assert.equal(source.includes('allowsTaskOverrun'), true);
assert.equal(source.includes('executeSession'), true, '記録画面は即時commit後に遅延再計画する共通session commandを使う');
assert.equal(source.includes('applyRecordSessionTransaction'), false, '記録画面を同期全計画生成へ戻さない');
assert.equal(source.includes('taskOverrunRecord'), false, '超過記録だけを別の同期REPLACE_STATE経路へ分岐させない');
assert.equal(sheet.includes('function sheetControlSnapshot'), true);
assert.equal(sheet.includes("dialogName.includes('記録')"), true);
assert.equal(sheet.includes("window.addEventListener('beforeunload', onBeforeUnload)"), true);
assert.equal(sheet.includes('if (moved <= 10) requestClose()'), true);
assert.equal(sheet.includes('onClick={requestClose}'), true);
assert.equal(sheet.includes('onCloseRef.current()'), true);

console.log('record sheet contract passed');
