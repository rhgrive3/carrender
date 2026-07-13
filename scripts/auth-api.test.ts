/** Cookie破損と同名登録競合が認証APIを500にしない回帰テスト。 */
/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />
import { parseCookie } from '../functions/_shared/cookies';
import { isUsernameConflict, onRequestPost as register } from '../functions/api/auth/register';

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.error(`  ❌ ${name}`, detail ?? '');
  }
}

console.log('--- 認証API境界 ---');
const malformed = new Request('https://example.test', { headers: { Cookie: 'sc_session=%E0%A4%A; other=ok' } });
const encoded = new Request('https://example.test', { headers: { Cookie: 'sc_session=session%20id' } });
check('壊れたpercent-encoding cookieを未認証として扱う', parseCookie(malformed, 'sc_session') === null);
check('正常なcookie値はdecodeする', parseCookie(encoded, 'sc_session') === 'session id');
check('D1のusername一意制約エラーを識別する', isUsernameConflict(new Error('D1_ERROR: UNIQUE constraint failed: users.username: SQLITE_CONSTRAINT')));
check('無関係なDBエラーを競合へ誤変換しない', !isUsernameConflict(new Error('D1_ERROR: database unavailable')));

const db = {
  prepare(sql: string) {
    return {
      bind() {
        return {
          async first() {
            if (sql.startsWith('SELECT id FROM users')) return null;
            return null;
          },
          async run() {
            if (sql.startsWith('INSERT INTO users')) {
              throw new Error('D1_ERROR: UNIQUE constraint failed: users.username: SQLITE_CONSTRAINT');
            }
            throw new Error(`unexpected query: ${sql}`);
          },
        };
      },
    };
  },
} as unknown as D1Database;

const response = await register({
  request: new Request('https://example.test/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'race-user', password: 'strong-password' }),
  }),
  env: { DB: db },
} as Parameters<typeof register>[0]) as Response;
const body = await response.json() as { error?: string };
check('同時登録raceは500でなく409を返す', response.status === 409 && body.error === 'このユーザー名は既に使われています', {
  status: response.status,
  body,
});
check('認証応答もキャッシュ禁止', response.headers.get('Cache-Control') === 'no-store');

process.exit(failures === 0 ? 0 : 1);
