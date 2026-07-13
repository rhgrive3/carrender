/** D1全体保存の楽観的ロック回帰テスト。 */
/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />
import { onRequestPut } from '../functions/api/data';

let appState = JSON.stringify({ value: 'initial' });
let version = '2026-07-11T00:00:00.000Z';

const db = {
  prepare(sql: string) {
    return {
      bind(...args: unknown[]) {
        return {
          async first<T>() {
            if (sql.includes('FROM sessions JOIN users')) {
              return { id: 'user', username: 'tester', expires_at: '2099-01-01T00:00:00.000Z' } as T;
            }
            if (sql.includes('SELECT updated_at FROM user_data')) return { updated_at: version } as T;
            return null;
          },
          async run() {
            if (sql.startsWith('UPDATE user_data')) {
              const [nextState, nextVersion, userId, expected] = args as [string, string, string, string];
              if (userId === 'user' && expected === version) {
                appState = nextState;
                version = nextVersion;
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }
            if (sql.startsWith('INSERT INTO user_data')) {
              // このfixtureでは既に user_data があるため、DO NOTHING は競合になる。
              return { meta: { changes: 0 } };
            }
            return { meta: { changes: 1 } };
          },
        };
      },
    };
  },
} as unknown as D1Database;

async function put(value: string, expectedVersion?: string) {
  const headers: Record<string, string> = {
    Cookie: 'sc_session=session',
    'Content-Type': 'application/json',
  };
  if (expectedVersion !== undefined) headers['X-Data-Version'] = expectedVersion;
  const request = new Request('https://example.test/api/data', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ value }),
  });
  return await onRequestPut({ request, env: { DB: db } } as Parameters<typeof onRequestPut>[0]) as Response;
}

const originalVersion = version;
const first = await put('first-device', originalVersion);
const firstSavedVersion = version;
const second = await put('stale-second-device', originalVersion);
const legacy = await put('legacy-unconditional-client');

const ok = first.status === 200
  && second.status === 409
  && legacy.status === 409
  && JSON.parse(appState).value === 'first-device'
  && firstSavedVersion === version;
console.log(ok
  ? '✅ 古いupdatedAtでの後勝ち上書きを409で拒否'
  : '❌ D1競合検出に失敗', { first: first.status, second: second.status, legacy: legacy.status, appState, version });
process.exit(ok ? 0 : 1);
