import type { Env } from '../../_shared/env';
import { createSession } from '../../_shared/auth';
import { sessionCookieHeader } from '../../_shared/cookies';
import { json, withSetCookie } from '../../_shared/http';
import { verifyPassword } from '../../_shared/password';

const INVALID_CREDENTIALS_MESSAGE = 'ユーザー名またはパスワードが正しくありません';
// 存在しないユーザーでも実ユーザーと同じPBKDF2処理を行い、応答時間差から
// ユーザー名の存在を推定できないようにする。値は実アカウントと無関係な固定ダミー。
const DUMMY_PASSWORD_SALT = '000102030405060708090a0b0c0d0e0f';
const DUMMY_PASSWORD_HASH = '821af11bf76e30570cf3c74721915204ab0e5a3dd1399301cc023535d27b09a9';

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

  const ok = await verifyPassword(
    password,
    user?.password_salt ?? DUMMY_PASSWORD_SALT,
    user?.password_hash ?? DUMMY_PASSWORD_HASH,
  );
  if (!user || !ok) {
    return json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 401 });
  }

  const sessionId = await createSession(env, user.id);

  return withSetCookie(json({ userId: user.id, username: user.username }), sessionCookieHeader(sessionId));
};