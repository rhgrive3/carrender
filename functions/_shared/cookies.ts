export const SESSION_COOKIE_NAME = 'sc_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30日

export function parseCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      // 壊れたpercent-encodingを認証API全体の500エラーへ波及させない。
      return null;
    }
  }
  return null;
}

export function sessionCookieHeader(sessionId: string): string {
  return `${SESSION_COOKIE_NAME}=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function sessionExpiryISO(): string {
  return new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
}
