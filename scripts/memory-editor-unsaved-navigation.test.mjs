import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryEditor.tsx', import.meta.url), 'utf8');

assert.ok(source.includes('const savedDraftSnapshotRef = useRef(JSON.stringify(blankDraft()))'), '保存済みカード内容の基準を保持する');
assert.ok(source.includes('const hasUnsavedChanges = JSON.stringify(draft) !== savedDraftSnapshotRef.current'), '入力内容と保存済み内容の差分を検出する');
assert.ok(source.includes("window.confirm('未保存の入力を破棄して移動しますか？')"), '画面離脱前に破棄確認する');
assert.ok(source.includes("window.addEventListener('beforeunload', onBeforeUnload)"), '再読み込みとタブ終了を保護する');
assert.ok(source.includes("onClick={() => leaveEditor(setId ? { name: 'set', setId } : { name: 'home' })}"), '戻る・キャンセル操作を共通離脱処理へ通す');
assert.ok(source.includes("leaveEditor({ name: 'editor', setId, bulk: true })"), '一括追加への切替でも未保存入力を保護する');
assert.ok(source.includes('savedDraftSnapshotRef.current = JSON.stringify(loaded)'), '既存カード読込後の内容を未変更基準にする');
assert.ok(source.includes('savedDraftSnapshotRef.current = JSON.stringify(nextBlank)'), '保存して次へでは空カードを新しい基準にする');

console.log('memory editor unsaved navigation contract: ok');
