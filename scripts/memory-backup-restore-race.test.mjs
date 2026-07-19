import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryBackupRestore.tsx', import.meta.url), 'utf8');

assert.match(source, /const inspectTokenRef = useRef\(0\)/, 'ファイル解析には世代トークンが必要です');
assert.match(source, /inspectTokenRef\.current !== token/, '古いファイル解析結果を反映してはいけません');
assert.match(source, /const restoreTokenRef = useRef\(0\)/, '復元処理には世代トークンが必要です');
assert.match(source, /repositoryRef\.current === actionRepository/, '復元完了は開始時の所有者と一致する場合だけ反映してください');
assert.match(source, /restoreInFlightRef\.current/, '復元の多重実行をrefで防いでください');
assert.match(source, /void requestSync\(true\)\.catch/, '同期要求の失敗を未処理Promiseにしてはいけません');
assert.match(source, /useLayoutEffect\(\(\) => \{[\s\S]*setResult\(undefined\)[\s\S]*\}, \[repository\]\)/, '所有者切替時は旧バックアップの確認状態を描画前に破棄してください');
assert.match(source, /disabled=\{reading \|\| restoring\}/, '解析・復元中は別ファイル選択を無効化してください');
assert.match(source, /aria-busy=\{reading \|\| restoring\}/, '解析・復元中の状態を支援技術へ通知してください');

console.log('memory backup restore race contracts passed');
