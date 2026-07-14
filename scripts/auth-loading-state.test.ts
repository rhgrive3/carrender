import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const checkingBranch = appSource.match(/if \(status === 'checking'\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';

assert.ok(checkingBranch, '認証確認中の分岐が存在する');
assert.match(checkingBranch, /role="status"/, '認証確認中であることを支援技術へ通知する');
assert.match(checkingBranch, /aria-live="polite"/, '状態メッセージを割り込みすぎず読み上げる');
assert.match(checkingBranch, /aria-busy="true"/, '処理中であることを明示する');
assert.match(checkingBranch, /アカウント情報を確認しています…/, '待機理由を画面上でも説明する');
assert.doesNotMatch(checkingBranch, /aria-hidden="true"[^>]*className="auth-shell"|className="auth-shell"[^>]*aria-hidden="true"/, '認証確認画面全体を読み上げ対象から除外しない');

console.log('✅ auth loading state regressions passed');
