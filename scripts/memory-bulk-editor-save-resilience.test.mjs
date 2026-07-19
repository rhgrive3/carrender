import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryBulkEditor.tsx', import.meta.url), 'utf8');

assert.match(source, /const saveInFlight = useRef\(false\)[\s\S]*if \(!repository \|\| saveInFlight\.current\) return;[\s\S]*saveInFlight\.current = true/u, '一括保存を再描画前からsingle-flight化する');
assert.match(source, /const mountedRef = useRef\(false\)[\s\S]*activeSetIdRef[\s\S]*if \(!mountedRef\.current \|\| activeSetIdRef\.current !== actionSetId\) return/u, '離脱または対象セット変更後に古い保存完了を画面へ反映しない');
assert.match(source, /try \{\s*await refresh\(\);\s*\} catch \(caught\) \{[\s\S]*暗記カード一括保存後に一覧を更新できませんでした/u, '端末保存後の一覧更新失敗を保存失敗から分離する');
assert.match(source, /requestSync\(true\)\.catch\(\(\) => undefined\)/u, '一括保存後の同期失敗を未処理Promiseにしない');
assert.match(source, /<section className="memory-bulk-editor" aria-busy=\{saving\}>/u, '一括登録画面全体へ保存中状態を通知する');
assert.match(source, /aria-label="1枚入力へ戻る" disabled=\{saving\}/u, '保存中は単票入力への移動を防ぐ');
assert.match(source, /<input disabled=\{saving\}[\s\S]*<select disabled=\{saving\}[\s\S]*行を削除/u, '保存中は表の入力・セット変更・行削除を止める');
assert.match(source, /memory-add-row" disabled=\{saving\}/u, '保存中は行追加を止める');
assert.match(source, /className="btn btn-ghost" disabled=\{saving\}[\s\S]*>キャンセル</u, '保存中はキャンセル遷移を止める');
assert.match(source, /aria-busy=\{saving\}[\s\S]*saving \? '保存中…'/u, '保存ボタンへ処理中状態と文言を表示する');
assert.match(source, /if \(saving\) \{\s*event\.preventDefault\(\);\s*return;\s*\}/u, '保存中の貼り付けで入力内容を変更しない');

console.log('memory bulk editor save resilience contract: ok');
