import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/screens/LoginScreen.tsx', import.meta.url), 'utf8');

assert.match(source, /const \[passwordConfirmation, setPasswordConfirmation\] = useState\(''\)/, '確認用パスワードを独立して保持する');
assert.match(source, /mode === 'register' && password !== passwordConfirmation/, '新規登録時だけ一致確認を行う');
assert.match(source, /確認用パスワードが一致しません/, '不一致理由を利用者へ明示する');
assert.match(source, /id="auth-password-confirmation"/, '確認用入力欄を新規登録画面へ表示する');
assert.match(source, /autoComplete="new-password"/, 'パスワードマネージャーへ新規パスワード入力として伝える');
assert.match(source, /setPassword\(''\)[\s\S]*setPasswordConfirmation\(''\)[\s\S]*setShowPassword\(false\)/, 'モード切り替え時に認証情報と表示状態を破棄する');

console.log('✅ auth registration confirmation regressions passed');
