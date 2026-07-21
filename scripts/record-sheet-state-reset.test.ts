import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/forms/RecordSheet.tsx', import.meta.url), 'utf8');
const sheet = readFileSync(new URL('../src/components/ui/Sheet.tsx', import.meta.url), 'utf8');

assert.equal(source.includes('allowsTaskOverrun'), true);
assert.equal(source.includes('taskOverrunRecord'), true);
assert.equal(source.includes('applyRecordSessionTransaction'), true);
assert.equal(sheet.includes('function sheetControlSnapshot'), true);
assert.equal(sheet.includes("dialogName.includes('記録')"), true);
assert.equal(sheet.includes("window.addEventListener('beforeunload', onBeforeUnload)"), true);
assert.equal(sheet.includes('if (moved <= 10) requestClose()'), true);
assert.equal(sheet.includes('onClick={requestClose}'), true);
assert.equal(sheet.includes('onCloseRef.current()'), true);

console.log('record sheet contract passed');
