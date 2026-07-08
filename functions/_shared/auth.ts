import type { Env } from './env';
import { parseCookie, SESSION_COOKIE_NAME, sessionExpiryISO } from './cookies';

export interface AuthUser {
  id: string;
  username: string;
}

export async function getSessionUser(request: Request, env: Env): Promise<AuthUser | null> {
  const sessionId = parseCookie(request, SESSION_COOKIE_NAME);
  if (!sessionId) return null;

  const row = await env.DB.prepare(
    `SELECT users.id AS id, users.username AS username, sessions.expires_at AS expires_at
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = ?`,
  )
    .bind(sessionId)
    .first<{ id: string; username: string; expires_at: string }>();

  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    return null;
  }

  return { id: row.id, username: row.username };
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(sessionId, userId, sessionExpiryISO(), now)
    .run();
  return sessionId;
}

export async function deleteSessionByRequest(request: Request, env: Env): Promise<void> {
  const sessionId = parseCookie(request, SESSION_COOKIE_NAME);
  if (!sessionId) return;
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}
