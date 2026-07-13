import type { Env } from '../_shared/env';
import { getSessionUser } from '../_shared/auth';
import { validateAppStatePayload } from '../_shared/appState';
import { json } from '../_shared/http';

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5MB

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** 同一ミリ秒内の連続更新でも、楽観ロック用versionを必ず前進させる。 */
export function nextDataVersion(expectedVersion: string | null, nowMs = Date.now()): string {
  const expectedMs = expectedVersion ? Date.parse(expectedVersion) : Number.NaN;
  const nextMs = Number.isFinite(expectedMs) ? Math.max(nowMs, expectedMs + 1) : nowMs;
  return new Date(nextMs).toISOString();
}

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

  const validation = validateAppStatePayload(appState);
  if (!validation.ok) {
    return json({ error: `保存データが破損しています: ${validation.error ?? '形式不明'}` }, { status: 500 });
  }

  return json({ appState, updatedAt: row.updated_at });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'ログインしていません' }, { status: 401 });

  const raw = await request.text();
  if (utf8ByteLength(raw) > MAX_BODY_BYTES) {
    return json({ error: '保存データが大きすぎます' }, { status: 413 });
  }

  let appState: unknown;
  try {
    appState = JSON.parse(raw);
  } catch {
    return json({ error: 'リクエストの形式が正しくありません' }, { status: 400 });
  }

  const validation = validateAppStatePayload(appState);
  if (!validation.ok) {
    return json({ error: validation.error ?? '学習データの形式が正しくありません' }, { status: 400 });
  }

  const expectedHeader = request.headers.get('X-Data-Version');
  const expectedVersion = expectedHeader && expectedHeader !== 'null' ? expectedHeader : null;
  const now = nextDataVersion(expectedVersion);
  let saved = true;
  if (expectedHeader === 'null') {
    const result = await env.DB.prepare(
      'INSERT INTO user_data (user_id, app_state, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING',
    ).bind(user.id, JSON.stringify(appState), now).run();
    saved = result.meta.changes === 1;
  } else if (expectedHeader) {
    const result = await env.DB.prepare(
      'UPDATE user_data SET app_state = ?, updated_at = ? WHERE user_id = ? AND updated_at = ?',
    ).bind(JSON.stringify(appState), now, user.id, expectedHeader).run();
    saved = result.meta.changes === 1;
  } else {
    // X-Data-Version を送れない旧クライアントは、まだクラウドにデータがない
    // 初回移行だけを許可する。既存データへの無条件 UPDATE は別端末の更新を
    // 巻き戻してしまうため、競合(409)として扱う。
    const result = await env.DB.prepare(
      'INSERT INTO user_data (user_id, app_state, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING',
    ).bind(user.id, JSON.stringify(appState), now).run();
    saved = result.meta.changes === 1;
  }

  if (!saved) {
    const current = await env.DB.prepare('SELECT updated_at FROM user_data WHERE user_id = ?')
      .bind(user.id)
      .first<{ updated_at: string }>();
    return json(
      { error: '別の端末またはタブでデータが更新されています。再読み込みして最新データを確認してください', updatedAt: current?.updated_at ?? null },
      { status: 409 },
    );
  }

  return json({ ok: true, updatedAt: now });
};
