import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryBulkEditor.tsx', import.meta.url), 'utf8');

assert.match(source, /const saveInFlight = useRef\(false\)[\s\S]*if \(!repository \|\| saveInFlight\.current\) return;[\s\S]*saveInFlight\.current = true/u, '一括保存を再描画前からsingle-flight化する');
assert.match(source, /const activeRepositoryRef = useRef\(repository\)[\s\S]*const saveActionTokenRef = useRef\(0\)[\s\S]*useLayoutEffect\(\(\) => \{[\s\S]*activeRepositoryRef\.current = repository;[\s\S]*activeSetIdRef\.current = setId;[\s\S]*saveActionTokenRef\.current \+= 1;[\s\S]*saveInFlight\.current = false;[\s\S]*setSaving\(false\);[\s\S]*setRows/u, '所有者・対象セット切替時に旧入力、保存世代、排他状態を描画前に破棄する');
assert.match(source, /const actionRepository = repository;[\s\S]*const actionRows = validRows;[\s\S]*const actionDuplicatePreview = duplicatePreview;[\s\S]*const actionToken = saveActionTokenRef\.current \+ 1/u, '保存開始時のrepository・入力・重複確認・操作世代を固定する');
assert.match(source, /const isCurrentAction = \(\) => \([\s\S]*activeRepositoryRef\.current === actionRepository[\s\S]*activeSetIdRef\.current === actionSetId[\s\S]*saveActionTokenRef\.current === actionToken/u, '保存完了の反映条件に所有者・セット・操作世代を含める');
assert.match(source, /findImportDuplicates\(parsedRows, await actionRepository\.loadContent\(\)\)[\s\S]*if \(!isCurrentAction\(\)\) return;[\s\S]*importParsedRows\(\{[\s\S]*repository: actionRepository[\s\S]*if \(!isCurrentAction\(\)\) return;[\s\S]*await refresh\(\);[\s\S]*if \(!isCurrentAction\(\)\) return;[\s\S]*requestSync\(true\)/u, '所有者切替後に旧保存から現在一覧の更新・同期・重複UI更新を実行しない');
assert.match(source, /try \{\s*await refresh\(\);\s*\} catch \(caught\) \{[\s\S]*暗記カード一括保存後に一覧を更新できませんでした/u, '端末保存後の一覧更新失敗を保存失敗から分離する');
assert.match(source, /finally \{[\s\S]*if \(saveActionTokenRef\.current === actionToken\) \{[\s\S]*saveInFlight\.current = false;[\s\S]*setSaving\(false\)/u, '旧保存のfinallyが新しい所有者側の保存ロックを解除しない');
assert.match(source, /requestSync\(true\)\.catch\(\(\) => undefined\)/u, '一括保存後の同期失敗を未処理Promiseにしない');
assert.match(source, /<section className="memory-bulk-editor" aria-busy=\{saving\}>/u, '一括登録画面全体へ保存中状態を通知する');
assert.match(source, /aria-label="1枚入力へ戻る" disabled=\{saving\}/u, '保存中は単票入力への移動を防ぐ');
assert.match(source, /<input disabled=\{saving\}[\s\S]*<select disabled=\{saving\}[\s\S]*行を削除/u, '保存中は表の入力・セット変更・行削除を止める');
assert.match(source, /memory-add-row" disabled=\{saving\}/u, '保存中は行追加を止める');
assert.match(source, /className="btn btn-ghost" disabled=\{saving\}[\s\S]*>キャンセル</u, '保存中はキャンセル遷移を止める');
assert.match(source, /aria-busy=\{saving\}[\s\S]*saving \? '保存中…'/u, '保存ボタンへ処理中状態と文言を表示する');
assert.match(source, /if \(saving\) \{\s*event\.preventDefault\(\);\s*return;\s*\}/u, '保存中の貼り付けで入力内容を変更しない');

console.log('memory bulk editor owner/save resilience contract: ok');
