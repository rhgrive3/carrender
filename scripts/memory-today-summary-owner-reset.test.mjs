import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

assert.match(
  source,
  /import \{[^}]*useLayoutEffect[^}]*\} from 'react';/u,
  'リポジトリ切替時の旧集計は描画前に破棄する',
);
assert.match(
  source,
  /useLayoutEffect\(\(\) => \{[\s\S]*setMemoryTodaySummary\(\{ weakCount: 0 \}\);[\s\S]*\}, \[memoryRepository\]\);/u,
  '暗記リポジトリ変更時に前リポジトリの弱点数と直近結果を初期化する',
);
assert.match(
  source,
  /if \(tab !== 'today' \|\| !memoryRepository\) return;[\s\S]*Promise\.all\(\[memoryRepository\.getStats\(\), memoryRepository\.listSessions\(20\)\]\)/u,
  '新しいリポジトリの集計だけを今日画面へ読み込む',
);

console.log('memory today summary owner reset contract: ok');
