import type { Env } from '../../_shared/env';
import { createSession } from '../../_shared/auth';
import { sessionCookieHeader } from '../../_shared/cookies';
import { json, withSetCookie } from '../../_shared/http';
import { generateSalt, hashPassword } from '../../_shared/password';
import { validatePassword, validateUsername } from '../../_shared/validate';

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
    return json({ error: 'このユーザー名は既に使われています' }, { status: 409 });
  }

  const userId = crypto.randomUUID();
  const salt = generateSalt();
  const hash = await hashPassword(pass, salt);
  const now = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO users (id, username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(userId, uname, hash, salt, now)
    .run();

  const sessionId = await createSession(env, userId);

  return withSetCookie(json({ username: uname }, { status: 201 }), sessionCookieHeader(sessionId));
};
