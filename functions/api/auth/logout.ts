import type { Env } from '../../_shared/env';
import { deleteSessionByRequest } from '../../_shared/auth';
import { clearSessionCookieHeader } from '../../_shared/cookies';
import { json, withSetCookie } from '../../_shared/http';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  await deleteSessionByRequest(request, env);
  return withSetCookie(json({ ok: true }), clearSessionCookieHeader());
};
