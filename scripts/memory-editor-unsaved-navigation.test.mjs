import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryEditor.tsx', import.meta.url), 'utf8');
const context = await readFile(new URL('../src/features/memory/ui/MemoryContext.tsx', import.meta.url), 'utf8');

assert.ok(source.includes('const savedDraftSnapshotRef = useRef(JSON.stringify(blankDraft()))'), '保存済みカード内容の基準を保持する');
assert.ok(source.includes('const hasUnsavedChanges = JSON.stringify(draft) !== savedDraftSnapshotRef.current'), '入力内容と保存済み内容の差分を検出する');
assert.ok(source.includes("window.confirm('未保存の入力を破棄して移動しますか？')"), '画面離脱前に破棄確認する');
assert.ok(source.includes("window.addEventListener('beforeunload', onBeforeUnload)"), '再読み込みとタブ終了を保護する');
assert.ok(source.includes("onClick={() => leaveEditor(setId ? { name: 'set', setId } : { name: 'home' })}"), '戻る・キャンセル操作を共通離脱処理へ通す');
assert.ok(source.includes("leaveEditor({ name: 'editor', setId, bulk: true })"), '一括追加への切替でも未保存入力を保護する');
assert.ok(source.includes('savedDraftSnapshotRef.current = JSON.stringify(loaded)'), '既存カード読込後の内容を未変更基準にする');
assert.ok(source.includes('savedDraftSnapshotRef.current = JSON.stringify(nextBlank)'), '保存して次へでは空カードを新しい基準にする');
assert.ok(context.includes("const MEMORY_EDITOR_SELECTOR = '.memory-editor, .memory-bulk-editor'"), '外側導線からも編集中画面を識別する');
assert.ok(context.includes("new Event('beforeunload', { cancelable: true })"), '既存の未保存判定を中央ナビゲーション境界で再利用する');
assert.ok(context.includes("window.confirm('未保存の暗記カード入力を破棄して移動しますか？')"), '別タブ経由の暗記遷移でも破棄確認する');
assert.ok(context.includes("window.addEventListener('pointerdown', onPointerDown, true)"), '実際に押された場所から編集画面内操作か外部操作かを判定する');
assert.ok(context.includes('keyboardEditorAction || recentEditorPointerAction || editorSaving'), '編集画面自身の操作と保存完了遷移だけ確認を重ねない');
assert.doesNotMatch(context, /activeElement instanceof Element && activeElement\.closest\(MEMORY_EDITOR_SELECTOR\)/u, 'iOSで入力フォーカスが残るだけでは外部遷移を内部操作扱いしない');
assert.ok(context.includes('lastEditorPointerDownAt.current = 0'), '外部タップと次回遷移へ古い内部操作判定を持ち越さない');

console.log('memory editor unsaved navigation and iOS external touch contract: ok');
