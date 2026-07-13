import type { Env } from '../../_shared/env';
import { createSession } from '../../_shared/auth';
import { sessionCookieHeader } from '../../_shared/cookies';
import { json, withSetCookie } from '../../_shared/http';
import { verifyPassword } from '../../_shared/password';

const INVALID_CREDENTIALS_MESSAGE = 'ユーザー名またはパスワードが正しくありません';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'リクエストの形式が正しくありません' }, { status: 400 });
  }

  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 400 });
  }

  const user = await env.DB.prepare(
    'SELECT id, username, password_hash, password_salt FROM users WHERE username = ?',
  )
    .bind(username)
    .first<{ id: string; username: string; password_hash: string; password_salt: string }>();

  if (!user) {
    return json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 401 });
  }

  const ok = await verifyPassword(password, user.password_salt, user.password_hash);
  if (!ok) {
    return json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 401 });
  }

  const sessionId = await createSession(env, user.id);

  return withSetCookie(json({ userId: user.id, username: user.username }), sessionCookieHeader(sessionId));
};
