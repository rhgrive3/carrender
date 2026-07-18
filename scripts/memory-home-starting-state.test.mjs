import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const home = await readFile(new URL('../src/features/memory/ui/MemoryHome.tsx', import.meta.url), 'utf8');

assert.match(
  home,
  /const isStarting = startingSetId !== undefined/u,
  '学習開始中の画面全体状態を一つの値へ集約する',
);
assert.match(
  home,
  /<section className="memory-home memory-simple-home" aria-busy=\{isStarting\}>/u,
  '暗記ホーム全体へ学習開始中であることを通知する',
);
assert.match(
  home,
  /disabled=\{isStarting \|\| summary\.eligible === 0\}/u,
  'いずれかのセットで学習開始中は、全セットの開始操作を無効化する',
);
assert.match(
  home,
  /aria-busy=\{startingSetId === summary\.set\.id\}/u,
  '実際に開始処理中のセットだけを処理中として支援技術へ通知する',
);
assert.match(
  home,
  /disabled=\{isStarting\}[\s\S]*navigate\(\{ name: 'set'/u,
  '学習開始中はカード一覧への画面遷移を止める',
);
assert.match(
  home,
  /disabled=\{isStarting\}[\s\S]*navigate\(\{ name: 'studySetup'/u,
  '学習開始中は学習設定への画面遷移を止める',
);
assert.match(
  home,
  /memory-simple-resume card" disabled=\{isStarting\}/u,
  '新規セッション作成中は既存セッションへの遷移を止める',
);
assert.match(
  home,
  /memory-search[\s\S]*<input value=\{query\} disabled=\{isStarting\}/u,
  '学習開始中は検索状態を変更させない',
);
assert.match(
  home,
  /<Play size=\{18\} fill="currentColor" aria-hidden="true" \/>/u,
  '開始アイコンをボタン名へ重複して読み上げさせない',
);

console.log('🎉 ALL PASS (memory home starting state contract)');
