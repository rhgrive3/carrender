function hasDisallowedChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const isControl = code <= 31 || code === 127;
    const isWhitespace = code === 32 || code === 9 || code === 10 || code === 13;
    if (isControl || isWhitespace) return true;
  }
  return false;
}

export function validateUsername(username: unknown): string | null {
  if (typeof username !== 'string' || username.length === 0) return 'ユーザー名を入力してください';
  if (username.trim() !== username) return 'ユーザー名の前後に空白は使えません';
  if (username.length < 3 || username.length > 24) return 'ユーザー名は3〜24文字で入力してください';
  if (hasDisallowedChar(username)) return 'ユーザー名に使用できない文字が含まれています';
  return null;
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length === 0) return 'パスワードを入力してください';
  if (password.length < 4) return 'パスワードは4文字以上で入力してください';
  if (password.length > 256) return 'パスワードが長すぎます';
  return null;
}
