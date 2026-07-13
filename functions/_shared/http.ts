export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function withSetCookie(res: Response, cookie: string): Response {
  const headers = new Headers(res.headers);
  headers.append('Set-Cookie', cookie);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
