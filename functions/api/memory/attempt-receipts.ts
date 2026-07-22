import type { Env } from '../../_shared/env';
import { getSessionUser } from '../../_shared/auth';
import { json } from '../../_shared/http';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };
const MAX_ATTEMPT_IDS = 500;
const MAX_ATTEMPT_ID_LENGTH = 200;

interface AttemptReceiptRequest {
  schemaVersion: 1;
  attemptIds: string[];
}

function parseRequest(value: unknown): AttemptReceiptRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || !Array.isArray(record.attemptIds)) return null;
  if (record.attemptIds.length > MAX_ATTEMPT_IDS) return null;
  const attemptIds = record.attemptIds;
  if (attemptIds.some((id) => typeof id !== 'string' || id.length === 0 || id.length > MAX_ATTEMPT_ID_LENGTH)) return null;
  return { schemaVersion: 1, attemptIds: [...new Set(attemptIds)] as string[] };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'ログインしていません' }, { status: 401, headers: NO_STORE_HEADERS });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSONが不正です' }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const input = parseRequest(body);
  if (!input) return json({ error: `attemptIdsは最大${MAX_ATTEMPT_IDS}件の有効な配列にしてください` }, { status: 400, headers: NO_STORE_HEADERS });

  if (input.attemptIds.length === 0) {
    return json({ schemaVersion: 1, serverTime: new Date().toISOString(), existingAttemptIds: [] }, { headers: NO_STORE_HEADERS });
  }

  const placeholders = input.attemptIds.map(() => '?').join(', ');
  try {
    const result = await env.DB.prepare(
      `SELECT attempt_id FROM memory_attempts WHERE user_id = ? AND attempt_id IN (${placeholders})`,
    ).bind(user.id, ...input.attemptIds).all<{ attempt_id: string }>();
    return json({
      schemaVersion: 1,
      serverTime: new Date().toISOString(),
      existingAttemptIds: (result.results ?? []).map((row) => row.attempt_id),
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table:\s*memory_attempts/i.test(message)) {
      return json({ error: '暗記カード用データベースの更新が未適用です' }, { status: 503, headers: NO_STORE_HEADERS });
    }
    console.error(JSON.stringify({ message: 'memory attempt receipt lookup failed', userId: user.id, error: message }));
    return json({ error: '回答履歴の同期状況を確認できませんでした' }, { status: 500, headers: NO_STORE_HEADERS });
  }
};
