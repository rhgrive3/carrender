import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/screens/LoginScreen.tsx', import.meta.url), 'utf8');

assert.match(source, /useState\(readOnlineStatus\)/, '初期通信状態をログイン画面の状態として保持する');
assert.match(source, /addEventListener\('online', updateConnectivity\)/, 'オンライン復帰を監視する');
assert.match(source, /addEventListener\('offline', updateConnectivity\)/, 'オフライン移行を監視する');
assert.match(source, /removeEventListener\('online', updateConnectivity\)/, 'オンライン監視を解除する');
assert.match(source, /removeEventListener\('offline', updateConnectivity\)/, 'オフライン監視を解除する');
assert.match(source, /if \(offline\) \{[\s\S]*?通信が戻ってからもう一度試してください/, '送信処理でもオフライン認証を防ぐ');
assert.match(source, /disabled=\{busy \|\| offline\}/, 'オフライン中は認証ボタンを無効化する');
assert.match(source, /auth-offline-note" role="status" aria-live="polite"/, '通信状態の変化を支援技術へ通知する');
assert.match(source, /オフラインでは認証できません/, '実行できない理由をボタン上でも明示する');

console.log('✅ auth connectivity state regressions passed');
