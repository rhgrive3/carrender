import { useState } from 'react';
import { Eye, EyeOff, Target, TriangleAlert } from 'lucide-react';
import { useAuth } from '../state/AuthContext';
import { Segmented } from '../components/ui/bits';

type Mode = 'login' | 'register';

function validateUsername(username: string): string | null {
  if (username.length < 3 || username.length > 24) return 'ユーザー名は3〜24文字で入力してください';
  return null;
}

function validatePassword(password: string): string | null {
  if (password.length < 4) return 'パスワードは4文字以上で入力してください';
  return null;
}

export function LoginScreen() {
  const { login, register, busy, error, clearError } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const displayError = localError ?? error;
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;

  const switchMode = (next: Mode) => {
    setMode(next);
    setLocalError(null);
    clearError();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    const trimmedUsername = username.trim();
    const usernameError = validateUsername(trimmedUsername);
    if (usernameError) {
      setLocalError(usernameError);
      return;
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      setLocalError(passwordError);
      return;
    }

    if (mode === 'login') {
      await login(trimmedUsername, password);
    } else {
      await register(trimmedUsername, password);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card-wrap">
        <div className="auth-logo-block">
          <div className="auth-logo" aria-hidden="true">
            <Target size={32} strokeWidth={2} color="#fff" />
          </div>
          <h1 className="auth-title">StudyCommander</h1>
          <p className="auth-subtitle">
            {mode === 'login' ? 'おかえりなさい。続きから始めましょう。' : 'アカウントを作って学習計画を始めましょう。'}
          </p>
        </div>

        <div className="auth-card">
          <div className="auth-mode-switch">
            <Segmented
              ariaLabel="ログイン・新規登録の切り替え"
              options={[
                { value: 'login', label: 'ログイン' },
                { value: 'register', label: '新規登録' },
              ]}
              value={mode}
              onChange={switchMode}
            />
          </div>

          {offline && <div className="auth-offline-note">オフラインです。通信環境を確認してください</div>}

          {displayError && (
            <div className="auth-error" role="alert">
              <TriangleAlert size={15} strokeWidth={2.4} aria-hidden="true" style={{ flexShrink: 0 }} />
              <span>{displayError}</span>
            </div>
          )}

          <form onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor="auth-username">ユーザー名</label>
              <input
                id="auth-username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="3〜24文字"
                maxLength={24}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="auth-password">パスワード</label>
              <div className="password-field-row">
                <input
                  id="auth-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="4文字以上"
                  required
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示する'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={19} strokeWidth={2} aria-hidden="true" /> : <Eye size={19} strokeWidth={2} aria-hidden="true" />}
                </button>
              </div>
              <p className="field-hint">メールアドレスや認証コードは不要です</p>
            </div>

            <button type="submit" className="btn btn-primary btn-block mt-8" disabled={busy}>
              {busy ? '処理中…' : mode === 'login' ? 'ログイン' : '新規登録して始める'}
            </button>
          </form>
        </div>

        <p className="auth-footer-note">
          データはあなたのアカウントに保存され、
          <br />
          他のユーザーから見られることはありません。
        </p>
      </div>
    </div>
  );
}
