import type { Env } from '../_shared/env';
import { getSessionUser } from '../_shared/auth';
import { json } from '../_shared/http';

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5MB

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'ログインしていません' }, { status: 401 });

  const row = await env.DB.prepare('SELECT app_state, updated_at FROM user_data WHERE user_id = ?')
    .bind(user.id)
    .first<{ app_state: string; updated_at: string }>();

  if (!row) return json({ appState: null, updatedAt: null });

  let appState: unknown;
  try {
    appState = JSON.parse(row.app_state);
  } catch {
    return json({ error: '保存データの読み込みに失敗しました' }, { status: 500 });
  }

  return json({ appState, updatedAt: row.updated_at });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'ログインしていません' }, { status: 401 });

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: '保存データが大きすぎます' }, { status: 413 });
  }

  let appState: unknown;
  try {
    appState = JSON.parse(raw);
  } catch {
    return json({ error: 'リクエストの形式が正しくありません' }, { status: 400 });
  }

  if (typeof appState !== 'object' || appState === null) {
    return json({ error: '学習データの形式が正しくありません' }, { status: 400 });
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO user_data (user_id, app_state, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET app_state = excluded.app_state, updated_at = excluded.updated_at`,
  )
    .bind(user.id, JSON.stringify(appState), now)
    .run();

  return json({ ok: true, updatedAt: now });
};
