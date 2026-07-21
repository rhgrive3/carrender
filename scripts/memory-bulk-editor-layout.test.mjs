import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const editor = await readFile(new URL('../src/features/memory/ui/MemoryBulkEditor.tsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles/memory-bulk-editor.css', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.match(editor, /<h2>まとめて追加<\/h2>/u, '画面名を短く分かりやすくする');
assert.match(editor, /memory-bulk-workspace" onPaste=\{onPaste\}/u, '表内のどの入力欄でも複数行貼り付けを受け取る');
assert.match(editor, /data-app-screen-label="暗記カードをまとめて追加"/u, '画面遷移を文書タイトルと支援技術へ伝える');
assert.match(editor, /data-label=\{COLUMN_LABEL\[column\]\}/u, '狭い画面で各入力欄のラベルを復元できる');
assert.match(editor, /className="memory-bulk-row-number"/u, '各カードへ行番号を表示する');
assert.match(editor, /aria-required=\{required\}[\s\S]*aria-invalid=\{invalid \|\| undefined\}/u, '必須項目と入力不足を支援技術へ伝える');
assert.match(editor, /nativeEvent\.isComposing \|\| event\.nativeEvent\.keyCode === 229/u, '日本語変換確定のEnterで勝手に次行を増やさない');
assert.match(editor, /memory-add-row" disabled=\{saving\}[\s\S]*1行追加[\s\S]*memory-add-five[\s\S]*5行追加/u, '1行・5行を用途に応じて追加できる');
assert.match(editor, /memory-bulk-clear[\s\S]*入力をクリア/u, '入力全消去の導線を用意する');
assert.match(editor, /memory-bulk-action-summary[\s\S]*incompleteCount[\s\S]*memory-bulk-action-buttons/u, '保存前に件数と不足状態を固定フッターで確認できる');

assert.match(
  editor,
  /const leaveEditor = \(destination: Parameters<typeof navigate>\[0\]\) => \{[\s\S]*if \(saving\) return;[\s\S]*hasAnyInput && !window\.confirm\('入力中のカードを破棄して移動しますか？'\)[\s\S]*navigate\(destination\);/u,
  '入力済みの一括追加画面から離れる前に破棄確認する',
);
assert.match(
  editor,
  /aria-label="1枚入力へ戻る"[\s\S]*onClick=\{\(\) => leaveEditor\(\{ name: 'editor', setId \}\)\}/u,
  '左上の戻る操作も未保存確認を通す',
);
assert.match(
  editor,
  /onClick=\{\(\) => leaveEditor\(setId \? \{ name: 'set', setId \} : \{ name: 'home' \}\)\}>キャンセル/u,
  '下部のキャンセル操作も未保存確認を通す',
);
assert.doesNotMatch(editor, /aria-label="1枚入力へ戻る"[\s\S]{0,180}navigate\(/u, '戻るボタンから直接遷移して入力を捨てない');
assert.match(
  editor,
  /if \(!hasAnyInput \|\| saving\) return undefined;[\s\S]*window\.addEventListener\('beforeunload', onBeforeUnload\)[\s\S]*window\.removeEventListener\('beforeunload', onBeforeUnload\)/u,
  '入力中の再読み込み・タブ終了もブラウザ確認で保護する',
);

assert.match(styles, /@media \(max-width: 1200px\)[\s\S]*\.memory-grid-scroll \{[\s\S]*max-height: none;[\s\S]*overflow: visible;/u, 'iPad mini横向きを含め入れ子スクロールと横長表を解除する');
assert.match(styles, /@media \(max-width: 1200px\)[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/u, 'iPadではカード内を2列で読みやすくする');
assert.match(styles, /@media \(max-width: 680px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/u, 'スマホでは1列フォームへ切り替える');
assert.match(styles, /@media \(max-width: 680px\)[\s\S]*font-size: 16px/u, 'iOSで入力時の自動拡大を防ぐ');
assert.match(styles, /\.memory-bulk-delete \{[\s\S]*min-width: 44px;[\s\S]*min-height: 44px;/u, '削除操作を十分なタッチ領域にする');
assert.match(styles, /\.memory-bulk-actions \{[\s\S]*justify-content: space-between/u, '保存操作と入力状態を同じ固定領域へまとめる');
assert.match(main, /import '\.\/styles\/memory-bulk-editor\.css';/u, '一括追加専用CSSを読み込む');
assert.ok(main.indexOf('memory-bulk-editor.css') < main.indexOf('layoutContracts.css'), '永続レイアウト契約より前に専用CSSを読み込む');

console.log('✅ memory bulk editor responsive layout and unsaved navigation contract passed');
