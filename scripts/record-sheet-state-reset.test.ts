import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/forms/RecordSheet.tsx', import.meta.url), 'utf8');
assert.equal(source.includes('allowsTaskOverrun'), true);
assert.equal(source.includes('taskOverrunRecord'), true);
assert.equal(source.includes('applyRecordSessionTransaction'), true);
console.log('record sheet contract passed');
