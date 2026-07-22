import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryContext.tsx', import.meta.url), 'utf8');
const bootstrapStart = source.indexOf('void (async () => {');
const bootstrapEnd = source.indexOf('return () => {', bootstrapStart);

assert.ok(bootstrapStart >= 0 && bootstrapEnd > bootstrapStart, '暗記providerの初期化処理を検出できる');
const bootstrap = source.slice(bootstrapStart, bootstrapEnd);

assert.doesNotMatch(
  bootstrap,
  /if\s*\(\s*navigatorOnline\(\)\s*===\s*false\s*\)/,
  'navigator.onLine=falseだけで初回同期を中止してはならない',
);
assert.doesNotMatch(
  bootstrap,
  /setSyncStatus\('offline'\)[\s\S]{0,120}return;/,
  '実request前にoffline表示へ固定して終了してはならない',
);
assert.match(
  bootstrap,
  /flushMemorySync\(next,\s*100\)/,
  '初回起動ではnavigator.onLineの値に関係なく同期requestを試す',
);
assert.match(
  source,
  /classifyMemorySyncError\(caught,\s*\{\s*navigatorOnline:\s*navigatorOnline\(\)\s*\}\)/,
  'navigator.onLineは失敗分類の参考情報としてのみ残す',
);

console.log('✅ memory initial sync connectivity contract passed');
