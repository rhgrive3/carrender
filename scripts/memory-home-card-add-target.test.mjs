import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryHome.tsx', import.meta.url), 'utf8');

assert.match(
  source,
  /summaries\.length === 1[\s\S]*navigate\(\{ name: 'editor', setId: summaries\[0\]\.set\.id \}\)[\s\S]*カード追加/u,
  'セットが1件だけのときは対象が一意なのでカード追加へ直接進める',
);
assert.match(
  source,
  /summaries\.length === 1[\s\S]*\) : \([\s\S]*setCreateSetOpen\(true\)[\s\S]*セット追加/u,
  '複数セット時は先頭セットへ暗黙追加せず、セット追加導線を表示する',
);
assert.doesNotMatch(
  source,
  /summaries\.length > 0[\s\S]*navigate\(\{ name: 'editor', setId: summaries\[0\]\.set\.id \}\)/u,
  'セットが複数ある状態で先頭セットをカード追加先へ固定しない',
);

console.log('memory home card add target contract: ok');
