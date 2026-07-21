import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const studySource = await readFile(new URL('../src/features/memory/ui/MemoryStudy.tsx', import.meta.url), 'utf8');
const contextSource = await readFile(new URL('../src/features/memory/ui/MemoryContext.tsx', import.meta.url), 'utf8');

assert.match(studySource, /if \(loaded\.status === 'completed'\) \{[\s\S]*?if \(!cancelled\) navigate\(\{ name: 'result', sessionId: loaded\.id \}\);[\s\S]*?return;/, '完了済みセッションの読込中に離脱した場合は古い結果画面へ遷移しない');
assert.doesNotMatch(studySource, /if \(loaded\.status === 'completed'\) \{\s*navigate\(/, '完了済みセッションから無条件に結果画面へ遷移する実装へ戻さない');
assert.match(studySource, /const actionInFlight = useRef\(false\)/, 'Reactの再描画前でも回答操作を排他できる同期ロックを持つ');
assert.match(studySource, /const actionToken = useRef\(0\)/, 'セッション切替後の古い操作を識別する世代トークンを持つ');
assert.match(studySource, /const beginAction = \(\) => \{[\s\S]*?if \(actionInFlight\.current\) return undefined;[\s\S]*?actionInFlight\.current = true/, '回答・取り消しの多重実行を同期的に拒否する');
assert.match(studySource, /const finishAction = \(token: number\) => \{[\s\S]*?if \(actionToken\.current !== token\) return;[\s\S]*?actionInFlight\.current = false;[\s\S]*?setBusy\(false\)/, '現在の操作だけsingle-flightロックと表示状態を解除する');
assert.equal((studySource.match(/const token = beginAction\(\);/g) ?? []).length, 2, '回答保存と取り消しの両方がsingle-flightロックを使う');
assert.equal((studySource.match(/const actionSessionId = session\.id;/g) ?? []).length, 2, '回答保存と取り消しが開始時のセッションIDを固定する');
assert.match(studySource, /if \(!mounted\.current \|\| activeSessionId\.current !== actionSessionId \|\| actionToken\.current !== token\) return;[\s\S]*?setSession\(result\.session\)/, '古い回答保存完了で切替後のセッション状態を上書きしない');
assert.match(studySource, /if \(!mounted\.current \|\| activeSessionId\.current !== actionSessionId \|\| actionToken\.current !== token\) return;[\s\S]*?setSession\(restored\.session\)/, '古い取り消し完了で切替後のセッション状態を上書きしない');
assert.match(studySource, /const requestSyncSafely = \(force: boolean\) => \{[\s\S]*?requestSync\(force\)\.catch\(\(\) => (?:undefined|\{[\s\S]*?\})\)/, '回答・取り消し後の同期失敗を明示的に吸収する');
assert.match(studySource, /await refresh\(\);[\s\S]*?requestSyncSafely[\s\S]*?activeSessionId\.current !== actionSessionId[\s\S]*?setSession/, '回答保存後は同期を維持しつつ、古いセッションへ状態を反映しない');
assert.equal((studySource.match(/requestSyncSafely\(/g) ?? []).length, 2, '回答保存と取り消しの両方が安全な同期要求を使う');
assert.doesNotMatch(studySource, /void requestSync\((?:false|result\.session\.status === 'completed')\);/, '同期失敗を未処理にする直接呼出しへ戻さない');
assert.match(studySource, /mounted\.current && activeSessionId\.current === actionSessionId && actionToken\.current === token/, '別セッションへ切替後に古い操作のToastを出さない');

assert.match(contextSource, /IndexedDBを開けない場合だけ暗記機能全体のエラーにする/, '端末データ初期化と同期失敗を別の状態として扱う');
assert.match(contextSource, /const requestSync = useCallback\([\s\S]*?catch \(caught\)[\s\S]*?setSyncStatus\(offline \? 'offline' : 'error'\)/, '同期前のIndexedDB読込失敗も未処理Promiseにしない');
assert.match(contextSource, /setSyncError\(caught instanceof Error \? caught\.message : '暗記データを同期できませんでした'\)/, '起動時の同期失敗を端末データの致命エラーと分離する');

console.log('memory study and context resilience contract passed');
