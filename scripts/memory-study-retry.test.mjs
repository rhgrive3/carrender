import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryStudy.tsx', import.meta.url), 'utf8');

assert.match(source, /const \[reloadKey, setReloadKey\] = useState\(0\)/, '暗記学習の再読込状態を保持する');
assert.match(source, /setSession\(undefined\);[\s\S]*?setBundle\(undefined\);[\s\S]*?setLoadError\(undefined\)/, '再読込前に古いセッション・内容・エラーを消す');
assert.match(source, /\[navigate, refresh, reloadKey, repository, requestSync, sessionId\]/, '再読込操作と同期関数変更でセッション読込effectを再実行する');
assert.match(source, /role="alert"[\s\S]*?セッションを開けませんでした[\s\S]*?setReloadKey[\s\S]*?再読み込み/, '読込失敗時に理由と再試行導線を表示する');
assert.match(source, /再読み込み[\s\S]*?暗記ホームへ戻る/, '再試行できない恒久エラーではホームへ戻れる');

assert.match(source, /旧形式の暗記セッション終了後に一覧を更新できませんでした/, '旧形式セッション保存後の一覧更新失敗を分離する');
assert.match(source, /復元不能な暗記セッション終了後に一覧を更新できませんでした/, '復元不能セッション保存後の一覧更新失敗を分離する');
assert.match(source, /saveSession\([\s\S]*?status: 'abandoned'[\s\S]*?try \{\s*await refresh\(\);\s*\} catch \(caught\) \{[\s\S]*?void requestSync\(false\)\.catch[\s\S]*?旧形式の問題セッションは廃止されました/u, '旧形式セッションでは一覧更新失敗後も終了状態を同期して本来の案内を維持する');
assert.match(source, /sessionContentIsRestorable[\s\S]*?saveSession\([\s\S]*?status: 'abandoned'[\s\S]*?try \{\s*await refresh\(\);\s*\} catch \(caught\) \{[\s\S]*?void requestSync\(false\)\.catch[\s\S]*?学習中のカードが編集または削除されました/u, '復元不能セッションでは一覧更新失敗後も終了状態を同期して本来の案内を維持する');
assert.equal(source.includes("await refresh();\n        throw new Error('旧形式の問題セッション"), false, '一覧更新失敗を旧形式セッション終了失敗として扱わない');
assert.equal(source.includes("await refresh();\n        throw new Error('学習中のカードが編集または削除"), false, '一覧更新失敗を復元不能セッション終了失敗として扱わない');

assert.match(source, /const refreshAfterPersist = async \(operation: '回答保存' \| '回答取り消し'\) => \{\s*try \{\s*await refresh\(\);\s*\} catch \(caught\) \{\s*console\.warn\(`暗記学習の\$\{operation\}後に一覧を更新できませんでした`, caught\);\s*\}\s*\};/u, '端末保存後の一覧更新失敗を操作失敗から分離する');
assert.match(source, /await refreshAfterPersist\('回答保存'\);\s*requestSyncSafely\(result\.session\.status === 'completed'\);/u, '回答保存後は一覧更新失敗でも同期と画面更新を続ける');
assert.match(source, /await refreshAfterPersist\('回答取り消し'\);\s*requestSyncSafely\(false\);/u, '回答取り消し後は一覧更新失敗でも同期と画面更新を続ける');
assert.equal(source.includes('await refresh();\n      requestSyncSafely(result.session.status'), false, '回答保存済み処理を一覧更新失敗として再試行させない');
assert.equal(source.includes('await refresh();\n      requestSyncSafely(false);'), false, '取り消し保存済み処理を一覧更新失敗として再試行させない');

assert.match(source, /const actionToken = useRef\(0\)/, '暗記学習操作へ世代トークンを持たせる');
assert.match(source, /import \{[^}]*useLayoutEffect[^}]*\} from 'react'/u, 'セッション切替の描画前リセットにuseLayoutEffectを使う');
assert.match(source, /useLayoutEffect\(\(\) => \{\s*actionToken\.current \+= 1;[\s\S]*?actionInFlight\.current = false;[\s\S]*?pointerStartX\.current = null;[\s\S]*?ignoreNextClick\.current = false;[\s\S]*?setSession\(undefined\);[\s\S]*?setBundle\(undefined\);[\s\S]*?setLoadError\(undefined\);[\s\S]*?setRevealed\(false\);[\s\S]*?setFlipDirection\(undefined\);[\s\S]*?setBusy\(false\);\s*\}, \[repository, sessionId\]\)/u, '所有者またはセッション切替時に旧カード・操作・ポインター状態を描画前に破棄する');
assert.match(source, /const finishAction = \(token: number\) => \{\s*if \(actionToken\.current !== token\) return;[\s\S]*setBusy\(false\)/u, '古い操作のfinallyが新しい画面のbusy状態を解除しない');
assert.match(source, /activeSessionId\.current !== actionSessionId \|\| actionToken\.current !== token/u, '回答・取り消し結果は現在の操作トークンが一致する場合だけ反映する');
assert.equal(source.includes('finally {\n      finishAction();'), false, '操作トークンなしでbusy状態を解除しない');

console.log('✅ memory study retry contract passed');
