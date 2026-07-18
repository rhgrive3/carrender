import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/features/memory/ui/MemoryStudy.tsx', import.meta.url), 'utf8');

assert.match(source, /const \[reloadKey, setReloadKey\] = useState\(0\)/, '暗記学習の再読込状態を保持する');
assert.match(source, /setSession\(undefined\);[\s\S]*?setBundle\(undefined\);[\s\S]*?setLoadError\(undefined\)/, '再読込前に古いセッション・内容・エラーを消す');
assert.match(source, /\[navigate, refresh, reloadKey, repository, sessionId\]/, '再読込操作でセッション読込effectを再実行する');
assert.match(source, /role="alert"[\s\S]*?セッションを開けませんでした[\s\S]*?setReloadKey[\s\S]*?再読み込み/, '読込失敗時に理由と再試行導線を表示する');
assert.match(source, /再読み込み[\s\S]*?暗記ホームへ戻る/, '再試行できない恒久エラーではホームへ戻れる');

assert.match(source, /const refreshAfterPersist = async \(operation: '回答保存' \| '回答取り消し'\) => \{\s*try \{\s*await refresh\(\);\s*\} catch \(caught\) \{\s*console\.warn\(`暗記学習の\$\{operation\}後に一覧を更新できませんでした`, caught\);\s*\}\s*\};/u, '端末保存後の一覧更新失敗を操作失敗から分離する');
assert.match(source, /await refreshAfterPersist\('回答保存'\);\s*requestSyncSafely\(result\.session\.status === 'completed'\);/u, '回答保存後は一覧更新失敗でも同期と画面更新を続ける');
assert.match(source, /await refreshAfterPersist\('回答取り消し'\);\s*requestSyncSafely\(false\);/u, '回答取り消し後は一覧更新失敗でも同期と画面更新を続ける');
assert.equal(source.includes('await refresh();\n      requestSyncSafely(result.session.status'), false, '回答保存済み処理を一覧更新失敗として再試行させない');
assert.equal(source.includes('await refresh();\n      requestSyncSafely(false);'), false, '取り消し保存済み処理を一覧更新失敗として再試行させない');

console.log('✅ memory study retry contract passed');
