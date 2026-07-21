import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const editor = await readFile(new URL('../src/features/memory/ui/MemoryBulkEditor.tsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles/memory-bulk-editor.css', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.match(editor, /<h2>まとめて追加<\/h2>/u);
assert.match(editor, /memory-bulk-workspace" onPaste=\{onPaste\}/u);
assert.match(editor, /data-app-screen-label="暗記カードをまとめて追加"/u);
assert.match(editor, /data-label=\{COLUMN_LABEL\[column\]\}/u);
assert.match(editor, /className="memory-bulk-row-number"/u);
assert.match(editor, /aria-required=\{required\}[\s\S]*aria-invalid=\{invalid \|\| undefined\}/u);
assert.match(editor, /nativeEvent\.isComposing \|\| event\.nativeEvent\.keyCode === 229/u);
assert.match(editor, /memory-add-row" disabled=\{saving\}[\s\S]*1行追加[\s\S]*memory-add-five[\s\S]*5行追加/u);
assert.match(editor, /memory-bulk-clear[\s\S]*入力をクリア/u);
assert.match(editor, /memory-bulk-action-summary[\s\S]*incompleteCount[\s\S]*memory-bulk-action-buttons/u);
assert.match(styles, /@media \(max-width: 1200px\)[\s\S]*\.memory-grid-scroll \{[\s\S]*max-height: none;[\s\S]*overflow: visible;/u);
assert.match(styles, /@media \(max-width: 1200px\)[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/u);
assert.match(styles, /@media \(max-width: 680px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/u);
assert.match(styles, /@media \(max-width: 680px\)[\s\S]*font-size: 16px/u);
assert.match(styles, /\.memory-bulk-delete \{[\s\S]*min-width: 44px;[\s\S]*min-height: 44px;/u);
assert.match(styles, /\.memory-bulk-actions \{[\s\S]*justify-content: space-between/u);
assert.match(main, /import '\.\/styles\/memory-bulk-editor\.css';/u);
assert.ok(main.indexOf('memory-bulk-editor.css') < main.indexOf('layoutContracts.css'));

console.log('memory bulk editor responsive layout contract passed');
