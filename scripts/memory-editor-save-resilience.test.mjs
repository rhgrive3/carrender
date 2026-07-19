import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryEditor.tsx', import.meta.url), 'utf8');

assert.match(source, /const saveInFlight = useRef\(false\)[\s\S]*if \(!repository \|\| saveInFlight\.current \|\| loadError \|\| \(itemId && !original\)\) return;[\s\S]*saveInFlight\.current = true/u, 'カード保存を再描画前からsingle-flight化し、既存カード読込前の保存を拒否する');
assert.match(source, /const isLoading = Boolean\(itemId && repository && !original && !loadError\)/u, '既存カードの読込状態を明示する');
assert.match(source, /if \(isLoading\) \{[\s\S]*aria-busy="true"[\s\S]*カードを読み込んでいます…[\s\S]*role="status"[\s\S]*読み込み中…/u, '読込完了前は空の編集フォームではなく読込状態を表示する');
assert.ok(source.indexOf('if (isLoading)') < source.indexOf('return (\n    <section className="memory-editor memory-simple-editor" aria-busy={saving}>'), '編集フォームは読込ガードより後で描画する');
assert.match(source, /try \{\s*await refresh\(\);\s*\} catch \(caught\) \{[\s\S]*暗記カード保存後に一覧を更新できませんでした/u, '端末保存後の一覧更新失敗を保存失敗から分離する');
assert.match(source, /requestSync\(true\)\.catch\(\(\) => undefined\)/u, '保存後の同期失敗を未処理Promiseにしない');
assert.match(source, /const mountedRef = useRef\(false\)[\s\S]*activeItemIdRef[\s\S]*if \(!mountedRef\.current \|\| activeItemIdRef\.current !== actionItemId\) return/u, '離脱または別カード切替後に古い保存完了を画面へ反映しない');
assert.match(source, /setOriginal\(undefined\);[\s\S]*setDraft\(blankDraft\(\)\);[\s\S]*setLoadError\(undefined\)/u, '編集対象切替時に旧カード内容を消す');
assert.match(source, /\.catch\(\(caught\) => \{[\s\S]*setLoadError/u, 'カード読込失敗を利用者へ表示する');
assert.match(source, /カードを開けませんでした[\s\S]*role="alert"/u, '読込失敗時に空の編集フォームを表示しない');
assert.match(source, /<section className="memory-editor memory-simple-editor" aria-busy=\{saving\}>[\s\S]*<fieldset className="memory-editor-card card" disabled=\{saving\}>/u, '保存中はフォーム全体を固定し処理中状態を通知する');
assert.match(source, /aria-label="戻る" disabled=\{saving\}/u, '保存中は戻る操作を止める');
assert.match(source, /aria-busy=\{saving\}[\s\S]*保存中…/u, '保存ボタン自体へ処理中状態を表示する');

console.log('memory editor save resilience contract: ok');
