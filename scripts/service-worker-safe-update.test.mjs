import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [policy, main, vite] = await Promise.all([
  readFile(new URL('../src/lib/serviceWorkerUpdate.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../vite.config.ts', import.meta.url), 'utf8'),
]);

assert.match(vite, /registerType:\s*'prompt'/u, 'waiting workerを利用者操作まで適用しない');
assert.doesNotMatch(vite, /registerType:\s*'autoUpdate'/u, '操作途中に自動reloadする設定へ戻さない');
assert.match(vite, /navigateFallback:\s*'\/index\.html'/u, 'offline navigation fallbackを維持する');
assert.match(vite, /cleanupOutdatedCaches:\s*true/u, '適用後の旧cache cleanupを維持する');

assert.match(policy, /onNeedRefresh\(\)[\s\S]*updateAvailable = true[\s\S]*renderNotice\(\)/u, '更新待ちを画面へ公開する');
assert.match(policy, /new Event\('beforeunload', \{ cancelable: true \}\)/u, '未保存入力の既存保護契約を更新判定にも使う');
assert.match(policy, /\.memory-editor, \.memory-bulk-editor/u, '暗記編集画面を更新blockerへ含める');
assert.match(policy, /studycommander_timer_v1/u, 'タイマー計測中を更新blockerへ含める');
assert.match(policy, /\.memory-study-stage, \.memory-study-shell/u, '暗記学習中を更新blockerへ含める');
assert.match(policy, /更新を待機しています/u, 'blocker中も更新待ちを利用者へ知らせる');
assert.match(policy, /button\.disabled = blockers\.length > 0/u, '操作途中はskipWaiting操作を無効化する');
assert.match(policy, /serviceWorkerUpdateBlockers\(\)\.length > 0[\s\S]*renderNotice\(\)[\s\S]*return/u, 'click直前にもblockerを再検証する');
assert.match(policy, /updateServiceWorker\(true\)/u, '安全な利用者操作だけでwaiting workerを適用しreloadする');
assert.match(policy, /applyCriticalServiceWorkerUpdate/u, '互換性問題向けの明示的な強制更新境界を分離する');
assert.match(policy, /no automatic critical rule is[\s\S]*enabled/u, '通常releaseへ自動強制更新を有効化しない');

assert.match(main, /registerSafeServiceWorkerUpdate\(\)/u, 'アプリ起動時に安全更新管理を登録する');
assert.doesNotMatch(main, /registerSW\(\{\s*immediate:\s*true/u, 'mainから直接auto updateへ戻さない');

console.log('✅ safe service worker update contracts passed');
