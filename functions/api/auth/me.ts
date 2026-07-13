import type { Env } from '../../_shared/env';
import { getSessionUser } from '../../_shared/auth';
import { json } from '../../_shared/http';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'ログインしていません' }, { status: 401 });
  return json({ userId: user.id, username: user.username });
};
