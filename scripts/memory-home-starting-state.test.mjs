import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const home = await readFile(new URL('../src/features/memory/ui/MemoryHome.tsx', import.meta.url), 'utf8');

assert.match(
  home,
  /disabled=\{startingSetId !== undefined \|\| summary\.eligible === 0\}/u,
  'いずれかのセットで学習開始中は、全セットの開始操作を無効化する',
);
assert.match(
  home,
  /aria-busy=\{startingSetId === summary\.set\.id\}/u,
  '実際に開始処理中のセットだけを処理中として支援技術へ通知する',
);
assert.match(
  home,
  /<Play size=\{18\} fill="currentColor" aria-hidden="true" \/>/u,
  '開始アイコンをボタン名へ重複して読み上げさせない',
);

console.log('🎉 ALL PASS (memory home starting state contract)');
