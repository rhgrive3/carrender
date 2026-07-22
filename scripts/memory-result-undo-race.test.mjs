import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryResult.tsx', import.meta.url), 'utf8');

assert.equal(source.includes('const mounted = useRef(true)'), true);
assert.match(source, /const activeSessionId = useRef\(sessionId\)[\s\S]*?activeSessionId\.current = sessionId/u, '同じ結果画面インスタンス内で切り替わった現在セッションを追跡する');
assert.equal(source.includes('const undoInFlightSessionId = useRef<string>();'), true, 'React再描画前でも同一セッションの取り消しを同期的にロックする');
assert.equal(source.includes('const undoActionToken = useRef(0);'), true, '所有者・セッションをまたぐ古い取り消し完了を世代トークンで識別する');
assert.match(source, /undoing \|\| undoInFlightSessionId\.current === session\.id/u, 'state反映前の同一セッション再実行を拒否する');
assert.equal(source.includes('const actionRepository = repository;'), true, '取り消し開始時の所有者リポジトリを固定する');
assert.equal(source.includes('const actionToken = ++undoActionToken.current;'), true, '各取り消し操作へ一意の世代を割り当てる');
assert.equal(source.includes('undoInFlightSessionId.current = actionSessionId;'), true, '非同期処理開始前にロックを取得する');
assert.equal(source.includes('const actionSessionId = session.id;'), true, '取り消し開始時のセッションIDを固定する');
assert.match(source, /const isCurrentAction = \(\) => \([\s\S]*?activeSessionId\.current === actionSessionId[\s\S]*?repository === actionRepository[\s\S]*?undoActionToken\.current === actionToken[\s\S]*?\);/u, '現在画面・所有者・操作世代が全て一致する場合だけUIへ結果を反映する');
assert.match(source, /if \(!isCurrentAction\(\)\) return;[\s\S]*?navigate\(\{ name: 'study'/u, '古い取り消し完了で切替後の画面を上書きしない');
assert.match(source, /catch \(caught\) \{\s*if \(isCurrentAction\(\)\) toast/u, '所有者またはセッション切替後に古い取り消しのToastを出さない');
assert.match(source, /if \(undoActionToken\.current === actionToken\) \{\s*undoInFlightSessionId\.current = undefined;\s*if \(mounted\.current\) setUndoing\(false\);\s*\}/u, '古いfinallyで新しい所有者・セッションの操作ロックを解除しない');

assert.match(source, /import \{[^}]*useLayoutEffect[^}]*\} from 'react'/u, '結果切替の描画前リセットにuseLayoutEffectを使う');
assert.match(source, /useLayoutEffect\(\(\) => \{\s*undoActionToken\.current \+= 1;\s*setSession\(undefined\);\s*setAttempts\(\[\]\);\s*setBundle\(undefined\);\s*setLoadError\(undefined\);\s*setSyncingResult\(false\);\s*setSyncWarning\(undefined\);\s*setUndoing\(false\);\s*undoInFlightSessionId\.current = undefined;\s*\}, \[reloadKey, repository, sessionId\]\)/u, '所有者・セッション切替または再読み込み時に旧操作世代・結果・同期表示を描画前に破棄する');
assert.equal(source.includes('}, [repository, sessionId]);'), false, '再読み込み時に古い読込エラーを残さない');
const layoutResetAt = source.indexOf('useLayoutEffect(() => {');
const loadEffectAt = source.indexOf('useEffect(() => {\n    if (!repository) return;', layoutResetAt);
assert.equal(layoutResetAt >= 0 && layoutResetAt < loadEffectAt, true, '旧結果を破棄してから新しい結果の非同期読込を始める');
assert.equal(source.includes('setSession(undefined);\n    setAttempts([]);\n    setBundle(undefined);\n    setLoadError(undefined);\n    setUndoing(false);\n    undoInFlightSessionId.current = undefined;\n    void (async () => {'), false, '結果切替の破棄を描画後の通常effectへ戻さない');

const refreshAt = source.indexOf('await refresh();');
const refreshCatchAt = source.indexOf("console.warn('暗記結果の取り消し後に一覧を更新できませんでした'", refreshAt);
const syncAt = source.indexOf('void requestSync(true).catch(() => undefined);', refreshAt);
const guardAt = source.indexOf('if (!isCurrentAction()) return;', syncAt);
const navigateAt = source.indexOf("navigate({ name: 'study'", guardAt);
assert.equal(refreshAt < refreshCatchAt && refreshCatchAt < syncAt && syncAt < guardAt && guardAt < navigateAt, true);
assert.match(source, /try \{\s*await refresh\(\);\s*\} catch \(caught\) \{[\s\S]*?console\.warn\('暗記結果の取り消し後に一覧を更新できませんでした', caught\);\s*\}/u, '保存済みの回答取り消しを一覧更新失敗として扱わない');
assert.equal(source.includes('void requestSync(true);', refreshAt), false, '取り消し後の同期失敗を未処理のPromise rejectionにしない');

assert.equal(source.includes('const loadResult = async () => {'), true, '初回表示と同期後更新で同じ結果読込処理を使う');
assert.equal(source.includes('const applyResult = (result: Awaited<ReturnType<typeof loadResult>>) => {'), true, 'ローカル表示と同期後再読込へ同じセッション状態判定を適用する');
assert.match(source, /result\.loaded\.status === 'active'[\s\S]*?navigate\(\{ name: 'study', sessionId: result\.loaded\.id \}\);[\s\S]*?return false;/u, '別端末の取り消しで学習中へ戻ったセッションは結果画面へ残さず学習へ戻す');
assert.match(source, /result\.loaded\.status !== 'completed'[\s\S]*?この学習セッションは終了済みです/u, '完了済み以外の終了状態を学習完了として表示しない');
assert.equal(source.includes('if (!applyResult(initial)) return;'), true, '端末内の完了結果を同期待ちせず表示し、activeなら学習へ戻す');
assert.equal(source.includes('applyResult(synced);'), true, '同期確認後の最新セッション状態も結果画面へ反映する');
assert.match(source, /cancelled \|\| undoInFlightSessionId\.current === sessionId/u, '離脱中またはUndo開始後に背景同期の再読込で画面を上書きしない');
assert.equal(source.includes('[navigate, reloadKey, repository, requestSync, sessionId]'), true, '結果状態判定で使う画面遷移関数をeffect依存へ含める');
const initialLoadAt = source.indexOf('const initial = await loadResult();');
const initialApplyAt = source.indexOf('if (!applyResult(initial)) return;', initialLoadAt);
const resultSyncAt = source.indexOf('await requestSync(true);', initialApplyAt);
const syncedLoadAt = source.indexOf('const synced = await loadResult();', resultSyncAt);
const syncedApplyAt = source.indexOf('applyResult(synced);', syncedLoadAt);
assert.equal(initialLoadAt < initialApplyAt && initialApplyAt < resultSyncAt && resultSyncAt < syncedLoadAt && syncedLoadAt < syncedApplyAt, true, '端末結果を先に公開し、背景同期後に同じセッションだけ更新する');

assert.match(source, /new Set\(session\?\.initialTargetIds \?\? \[\]\)\.size/u, '重複した初期出題IDを結果画面のカード件数で1件へ正規化する');
assert.equal(source.includes('カード {initialTargetCount}件'), true, '表示件数は重複除外後の初期出題数を使う');
assert.equal(source.includes('カード {session.initialTargetIds.length}件'), false, '同期競合で膨らみうる生配列長へ戻さない');
assert.match(source, /new Set\(session\?\.needsReviewTargetIds \?\? \[\]\)/u, '重複した復習対象IDを結果画面で1件へ正規化する');
assert.equal(source.includes('<small>次回も優先</small><b>{needsReview.length}</b>'), true, '表示件数も重複除外後の一覧と一致させる');
assert.match(source, /return \{[\s\S]*?targetId,[\s\S]*?label:/u, '表示名と安定した学習対象IDを組で保持する');
assert.equal(source.includes('needsReview.map(({ targetId, label }) => <span key={targetId} role="listitem">{label}</span>)'), true, '同名カードでもtargetIdをReact keyに使い、一覧項目として伝える');
assert.equal(source.includes('needsReview.map((label) => <span key={label}>'), false, '重複しうる表示名をkeyへ戻さない');

assert.equal(source.includes('aria-busy={undoing}'), true, '取り消し処理中であることをボタン自身へ公開する');
assert.equal(source.includes("{undoing ? '取り消し中…' : '最後を取り消す'}"), true, '処理中はボタン表示を進捗表示へ切り替える');
assert.equal(source.includes('role="status" aria-live="polite">{undoing ? \'最後の回答を取り消しています\' : \'\'}</span>'), true, 'VoiceOverへ取り消し開始を通知する');

assert.match(source, /role="alert"[\s\S]*?aria-atomic="true"[\s\S]*?aria-labelledby="memory-result-error-title"[\s\S]*?aria-describedby="memory-result-error-detail"/u, '読込エラーを見出しと詳細を含む一まとまりの通知として伝える');
assert.equal(source.includes('role="group" aria-label="読込エラーの操作"'), true, '読込失敗時の再試行と離脱を一組の操作として伝える');
assert.match(source, /role="status" aria-live="polite" aria-atomic="true" aria-busy="true"/u, '読込中の状態を一まとまりの進行中通知として伝える');
assert.equal(source.includes('aria-describedby="memory-result-summary"'), true, '結果画面とカード数・回答数の要約を関連付ける');
assert.equal(source.includes('回答 {attempts.length}回'), true, '回答件数は集計カードと同じ実際の回答行から表示する');
assert.equal(source.includes('回答 {session.answerCount}回'), false, '同期競合でずれうるセッション集計値を結果要約へ戻さない');
assert.equal(source.includes('aria-label={`覚えた ${counts.remembered}件`}'), true, '集計カードの名称と件数を単独でも理解できる読み上げへまとめる');
assert.equal(source.includes('aria-label={`次回も優先 ${needsReview.length}件`}'), true, '復習優先件数も単独で意味が伝わるようにする');

console.log('memory result local-first and undo race contract passed');
