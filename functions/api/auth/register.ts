import type { Env } from '../../_shared/env';
import { createSession } from '../../_shared/auth';
import { sessionCookieHeader } from '../../_shared/cookies';
import { json, withSetCookie } from '../../_shared/http';
import { generateSalt, hashPassword } from '../../_shared/password';
import { validatePassword, validateUsername } from '../../_shared/validate';

const USERNAME_TAKEN_MESSAGE = 'このユーザー名は既に使われています';

export function isUsernameConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:UNIQUE constraint failed:\s*users\.username|users_username|username.*(?:unique|constraint))/iu.test(message);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'リクエストの形式が正しくありません' }, { status: 400 });
  }

  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };

  const usernameError = validateUsername(username);
  if (usernameError) return json({ error: usernameError }, { status: 400 });

  const passwordError = validatePassword(password);
  if (passwordError) return json({ error: passwordError }, { status: 400 });

  const uname = username as string;
  const pass = password as string;

  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(uname).first();
  if (existing) {
    return json({ error: USERNAME_TAKEN_MESSAGE }, { status: 409 });
  }

  const userId = crypto.randomUUID();
  const salt = generateSalt();
  const hash = await hashPassword(pass, salt);
  const now = new Date().toISOString();

  try {
    await env.DB.prepare(
      'INSERT INTO users (id, username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(userId, uname, hash, salt, now)
      .run();
  } catch (error) {
    // 事前SELECT後に同名登録が入る競合でも、500ではなく一貫して409を返す。
    if (isUsernameConflict(error)) return json({ error: USERNAME_TAKEN_MESSAGE }, { status: 409 });
    throw error;
  }

  const sessionId = await createSession(env, userId);

  return withSetCookie(json({ userId, username: uname }, { status: 201 }), sessionCookieHeader(sessionId));
};
