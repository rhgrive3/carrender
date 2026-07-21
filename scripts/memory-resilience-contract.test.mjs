import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [resultSource, detailSource, homeSource, setupSource, studySource, contextSource] = await Promise.all([
  readFile(new URL('../src/features/memory/ui/MemoryResult.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/memory/ui/MemorySetDetail.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/memory/ui/MemoryHome.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/memory/ui/MemoryStudySetup.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/memory/ui/MemoryStudy.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/features/memory/ui/MemoryContext.tsx', import.meta.url), 'utf8'),
]);

assert.match(resultSource, /if \(!loaded\) throw new Error\('学習結果が見つかりません'\)/, '削除済み・不明な結果を無限ローディングにしない');
assert.match(resultSource, /\.catch\(\(caught\) => \{[\s\S]*?setLoadError/, '結果読込のPromise拒否を画面状態へ反映する');
assert.match(resultSource, /role="alert"[\s\S]*?学習結果を開けませんでした[\s\S]*?再読み込み/, '結果読込失敗時に理由と再試行手段を表示する');

assert.match(detailSource, /if \(!next\.sets\[0\]\) throw new Error\('暗記セットが見つかりません'\)/, '削除済みセットを無限ローディングにしない');
assert.match(detailSource, /setLoadError\(caught instanceof Error/, 'セット詳細の読込失敗を保持する');
assert.match(detailSource, /const runAction = async[\s\S]*?catch \(caught\)[\s\S]*?toast/, 'セット編集・削除の保存失敗を未処理にしない');
assert.match(detailSource, /role="alert"[\s\S]*?暗記セットを開けませんでした[\s\S]*?再読み込み/, 'セット詳細に読込失敗と再試行を表示する');

assert.match(homeSource, /repository\.loadSnapshot\(\)[\s\S]*?\.catch\(\(caught\) => \{[\s\S]*?setSnapshotError/, '暗記ホームのスナップショット読込失敗を処理する');
assert.match(homeSource, /createMemorySet[\s\S]*?catch \(caught\)[\s\S]*?暗記セットを作成できませんでした/, 'セット作成失敗を利用者へ通知する');
assert.match(homeSource, /!snapshot && snapshotError[\s\S]*?role="alert"[\s\S]*?再読み込み/, '初回読込失敗で空画面にせず再試行を出す');
assert.match(homeSource, /createSimpleStudySession[\s\S]*?await refresh\(\);[\s\S]*?requestSync\(true\)[\s\S]*?navigate\(\{ name: 'study'/, 'ホームから作成した学習セッションを即時同期してから学習画面へ進む');
assert.match(setupSource, /createSimpleStudySession[\s\S]*?await refresh\(\);[\s\S]*?requestSync\(true\)[\s\S]*?navigate\(\{ name: 'study'/, '学習設定から作成したセッションも即時同期してから学習画面へ進む');

assert.match(studySource, /const mounted = useRef\(true\)/, '学習画面の生存状態を追跡する');
assert.match(studySource, /const activeSessionId = useRef\(sessionId\)[\s\S]*?activeSessionId\.current = sessionId/, '同じ画面インスタンス内で切り替わった現在セッションを追跡する');
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
assert.match(studySource, /const requestSyncSafely = \(force: boolean\) => \{[\s\S]*?requestSync\(force\)\.catch\(\(\) => (?:undefined|\{[\s\S]*?\})\)/, '暗記学習の同期失敗を明示的に吸収する');
assert.match(studySource, /await refresh\(\);[\s\S]*?requestSyncSafely[\s\S]*?activeSessionId\.current !== actionSessionId[\s\S]*?setSession/, '回答保存後は同期を維持しつつ、古いセッションへ状態を反映しない');
assert.equal((studySource.match(/^\s+requestSyncSafely\(/gm) ?? []).length, 4, '旧形式終了・復元不能終了・回答保存・取り消しの全4経路が安全な同期要求を使う');
assert.doesNotMatch(studySource, /void requestSync\((?:false|result\.session\.status === 'completed')\);/, '同期失敗を未処理にする直接呼出しへ戻さない');
assert.match(studySource, /mounted\.current && activeSessionId\.current === actionSessionId && actionToken\.current === token/, '別セッションへ切替後に古い操作のToastを出さない');

assert.match(contextSource, /IndexedDBを開けない場合だけ暗記機能全体のエラーにする/, '端末データ初期化と同期失敗を別の状態として扱う');
assert.match(contextSource, /const requestSync = useCallback\([\s\S]*?catch \(caught\)[\s\S]*?setSyncStatus\(offline \? 'offline' : 'error'\)/, '同期前のIndexedDB読込失敗も未処理Promiseにしない');
assert.match(contextSource, /setSyncError\(caught instanceof Error \? caught\.message : '暗記データを同期できませんでした'\)/, '起動時の同期失敗を端末データの致命エラーと分離する');
assert.match(contextSource, /const syncInFlight = useRef<Promise<void> \| null>\(null\)/, '同期中Promiseを保持して多重実行を判定する');
assert.match(contextSource, /if \(syncInFlight\.current\) \{[\s\S]*?return syncInFlight\.current;[\s\S]*?\}/, '回答保存・画面復帰・手動同期が重なった場合は実行中の同期へ合流する');
assert.match(contextSource, /run\.finally\(\(\) => \{[\s\S]*?syncInFlight\.current === run[\s\S]*?syncInFlight\.current = null/, '同期完了後だけsingle-flightロックを解除する');

console.log('✅ memory resilience contracts passed');