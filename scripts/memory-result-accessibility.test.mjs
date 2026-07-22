import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/features/memory/ui/MemoryResult.tsx', import.meta.url), 'utf8');

assert.equal(source.includes('aria-labelledby="memory-result-title"'), true, '結果画面を見出しで識別できる');
assert.equal(source.includes('role="list" aria-label="カード単位の学習結果"'), true, 'カード単位の集計をひとまとまりの一覧として伝える');
assert.equal(source.includes('role="list" aria-labelledby="memory-needs-review-title"'), true, '復習対象を見出し付き一覧として伝える');
assert.equal(source.includes('role="group" aria-label="学習結果の操作"'), true, '結果画面の操作群を識別できる');
assert.equal(source.includes('disabled={undoing || attempts.length === 0}'), true, '回答がない結果では取り消し操作を無効化する');
assert.equal((source.match(/aria-hidden="true"/g) ?? []).length >= 4, true, '装飾アイコンを読み上げ対象から外す');

const initialLoadAt = source.indexOf('const initial = await loadResult();');
const initialApplyAt = source.indexOf('if (!applyResult(initial)) return;', initialLoadAt);
const syncAt = source.indexOf('await requestSync(true);', initialLoadAt);
assert.ok(initialLoadAt >= 0 && initialApplyAt > initialLoadAt, '端末内の学習結果を最初に読み込む');
assert.ok(syncAt > initialApplyAt, '端末内結果を表示してから同期を開始する');
assert.match(source, /setSyncingResult\(true\);[\s\S]*await requestSync\(true\);[\s\S]*const synced = await loadResult\(\)/u, '背景同期後だけ最新結果を再読込する');
assert.match(source, /cancelled \|\| undoInFlightSessionId\.current === sessionId/u, '離脱中またはUndo中に遅延同期結果を上書きしない');
assert.match(source, /catch \{[\s\S]*端末の結果を表示しています。同期は暗記ホームから再試行できます。/u, '同期失敗でも表示済み端末結果を維持して再試行方法を示す');
assert.match(source, /\(syncingResult \|\| syncWarning\)[\s\S]*role="status"[\s\S]*最新の暗記データを同期しています/u, '同期は結果閲覧を妨げないstatusとして通知する');

console.log('memory result accessibility and local-first contract passed');
