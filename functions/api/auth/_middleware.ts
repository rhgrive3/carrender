import type { Env } from '../../_shared/env';
import { json } from '../../_shared/http';

const WINDOW_SECONDS = 15 * 60;
const BLOCK_SECONDS = 15 * 60;
const MAX_FAILURES = 8;
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

interface RateLimitRow {
  failure_count: number;
  window_started_at: number;
  blocked_until: number;
}

function clientAddress(request: Request): string {
  const cloudflareAddress = request.headers.get('CF-Connecting-IP')?.trim();
  if (cloudflareAddress) return cloudflareAddress;
  const forwarded = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim();
  return forwarded || 'unknown';
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loginRateKey(request: Request): Promise<string | null> {
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const username = (body as { username?: unknown }).username;
  if (typeof username !== 'string' || username.trim() === '') return null;
  return sha256Hex(`${clientAddress(request)}\u0000${username.trim().toLocaleLowerCase('en-US')}`);
}

function retryAfterResponse(blockedUntil: number, now: number): Response {
  const retryAfterSeconds = Math.max(1, blockedUntil - now);
  return json({
    error: `ログイン試行が多すぎます。${Math.ceil(retryAfterSeconds / 60)}分後に再試行してください`,
    code: 'LOGIN_RATE_LIMITED',
    retryAfterSeconds,
  }, {
    status: 429,
    headers: {
      ...NO_STORE_HEADERS,
      'Retry-After': String(retryAfterSeconds),
    },
  });
}

function isMissingSchema(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table:\s*auth_login_limits/i.test(message);
}

async function loadRateLimit(env: Env, rateKey: string): Promise<RateLimitRow | null> {
  return env.DB.prepare(
    `SELECT failure_count, window_started_at, blocked_until
     FROM auth_login_limits WHERE rate_key = ?`,
  ).bind(rateKey).first<RateLimitRow>();
}

async function clearRateLimit(env: Env, rateKey: string): Promise<void> {
  await env.DB.prepare('DELETE FROM auth_login_limits WHERE rate_key = ?').bind(rateKey).run();
}

async function recordFailure(env: Env, rateKey: string, now: number): Promise<RateLimitRow | null> {
  await env.DB.prepare(
    `INSERT INTO auth_login_limits
       (rate_key, failure_count, window_started_at, blocked_until, updated_at)
     VALUES (?, 1, ?, 0, ?)
     ON CONFLICT(rate_key) DO UPDATE SET
       failure_count = CASE
         WHEN excluded.updated_at - auth_login_limits.window_started_at >= ? THEN 1
         ELSE auth_login_limits.failure_count + 1
       END,
       window_started_at = CASE
         WHEN excluded.updated_at - auth_login_limits.window_started_at >= ? THEN excluded.updated_at
         ELSE auth_login_limits.window_started_at
       END,
       blocked_until = CASE
         WHEN (
           CASE
             WHEN excluded.updated_at - auth_login_limits.window_started_at >= ? THEN 1
             ELSE auth_login_limits.failure_count + 1
           END
         ) >= ? THEN excluded.updated_at + ?
         ELSE 0
       END,
       updated_at = excluded.updated_at`,
  ).bind(
    rateKey,
    now,
    now,
    WINDOW_SECONDS,
    WINDOW_SECONDS,
    WINDOW_SECONDS,
    MAX_FAILURES,
    BLOCK_SECONDS,
  ).run();
  return loadRateLimit(env, rateKey);
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  if (request.method !== 'POST' || !url.pathname.endsWith('/api/auth/login')) {
    return context.next();
  }

  const rateKey = await loginRateKey(request);
  if (!rateKey) return context.next();
  const now = Math.floor(Date.now() / 1000);

  try {
    const existing = await loadRateLimit(env, rateKey);
    if (existing && existing.blocked_until > now) {
      return retryAfterResponse(existing.blocked_until, now);
    }
  } catch (error) {
    if (isMissingSchema(error)) {
      console.error(JSON.stringify({ message: 'auth rate-limit migration is missing' }));
      return context.next();
    }
    console.error(JSON.stringify({ message: 'auth rate-limit lookup failed', error: String(error) }));
    return json({ error: 'ログイン試行の確認に失敗しました' }, { status: 503, headers: NO_STORE_HEADERS });
  }

  const response = await context.next();
  try {
    if (response.ok) {
      await clearRateLimit(env, rateKey);
      return response;
    }
    if (response.status !== 401) return response;
    const updated = await recordFailure(env, rateKey, now);
    if (updated && updated.blocked_until > now) {
      return retryAfterResponse(updated.blocked_until, now);
    }
  } catch (error) {
    if (isMissingSchema(error)) {
      console.error(JSON.stringify({ message: 'auth rate-limit migration is missing' }));
      return response;
    }
    console.error(JSON.stringify({ message: 'auth rate-limit update failed', error: String(error) }));
  }
  return response;
};
