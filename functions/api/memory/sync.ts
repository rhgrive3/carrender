import type { Env } from '../../_shared/env';
import { getSessionUser } from '../../_shared/auth';
import { json } from '../../_shared/http';
import { syncMemoryData } from '../../_shared/memory-sync';
import { MemoryValidationError, readMemorySyncRequest } from '../../_shared/memory-validation';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'ログインしていません' }, { status: 401, headers: NO_STORE_HEADERS });

  try {
    const input = await readMemorySyncRequest(request);
    const output = await syncMemoryData(env, user.id, input);
    return json(output, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof MemoryValidationError) {
      return json({ error: error.message }, { status: error.status, headers: NO_STORE_HEADERS });
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table:\s*memory_/i.test(message)) {
      console.error(JSON.stringify({ message: 'memory schema migration is missing', userId: user.id, error: message }));
      return json(
        { error: '暗記カード用データベースの更新が未適用です（管理者がD1 migrationを実行する必要があります）' },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
    console.error(JSON.stringify({
      message: 'memory sync failed',
      userId: user.id,
      error: message,
    }));
    return json({ error: '暗記データの同期に失敗しました' }, { status: 500, headers: NO_STORE_HEADERS });
  }
};
