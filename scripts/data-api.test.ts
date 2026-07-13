/** D1全体保存の楽観的ロック・応答安全性・構造検証の回帰テスト。 */
/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />
import { nextDataVersion, onRequestGet, onRequestPut, utf8ByteLength } from '../functions/api/data';

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  PASS ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}`, detail ?? '');
  }
}

function validState(value: string) {
  return {
    version: 4,
    schemaVersion: 4,
    isDemo: false,
    onboarded: true,
    goal: null,
    subjects: [],
    materials: [],
    tasks: [],
    sessions: [],
    availability: [],
    dayPlans: [],
    fixedEvents: [],
    settings: { theme: 'auto' },
    lastReschedule: null,
    lastPlannedDate: null,
    value,
  };
}

let appState = JSON.stringify(validState('initial'));
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
            if (sql.includes('SELECT app_state, updated_at FROM user_data')) {
              return { app_state: appState, updated_at: version } as T;
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

async function putBody(body: string, expectedVersion?: string) {
  const headers: Record<string, string> = {
    Cookie: 'sc_session=session',
    'Content-Type': 'application/json',
  };
  if (expectedVersion !== undefined) headers['X-Data-Version'] = expectedVersion;
  const request = new Request('https://example.test/api/data', { method: 'PUT', headers, body });
  return await onRequestPut({ request, env: { DB: db } } as Parameters<typeof onRequestPut>[0]) as Response;
}

async function put(value: string, expectedVersion?: string) {
  return putBody(JSON.stringify(validState(value)), expectedVersion);
}

console.log('--- D1全体保存API ---');
const originalVersion = version;
const first = await put('first-device', originalVersion);
const firstSavedVersion = version;
const second = await put('stale-second-device', originalVersion);
const legacy = await put('legacy-unconditional-client');
const get = await onRequestGet({
  request: new Request('https://example.test/api/data', { headers: { Cookie: 'sc_session=session' } }),
  env: { DB: db },
} as Parameters<typeof onRequestGet>[0]) as Response;

check('古いupdatedAtでの後勝ち上書きを409で拒否', first.status === 200
  && second.status === 409
  && legacy.status === 409
  && JSON.parse(appState).value === 'first-device'
  && firstSavedVersion === version,
{ first: first.status, second: second.status, legacy: legacy.status, appState, version });
check('機密データAPIは保存を禁止する', [first, second, legacy, get].every((response) => response.headers.get('Cache-Control') === 'no-store'));
check('JSON応答はMIME sniffingを禁止する', get.headers.get('X-Content-Type-Options') === 'nosniff');
check('同一ミリ秒でもversionを必ず前進させる', nextDataVersion(originalVersion, Date.parse(originalVersion)) > originalVersion);
check('UTF-8バイト数で日本語・絵文字を計測する', utf8ByteLength('😀') === 4 && utf8ByteLength('あ') === 3);

const arrayResponse = await putBody('[]', version);
check('配列をAppStateとして受理しない', arrayResponse.status === 400, arrayResponse.status);
const malformedResponse = await putBody(JSON.stringify({
  onboarded: true,
  settings: {},
  subjects: [],
  materials: 'broken',
  tasks: [],
  sessions: [],
}), version);
check('構造が壊れたAppStateを保存しない', malformedResponse.status === 400, malformedResponse.status);

const validSnapshot = appState;
appState = JSON.stringify({ onboarded: true, settings: {}, subjects: [], materials: 'broken', tasks: [], sessions: [] });
const corruptedGet = await onRequestGet({
  request: new Request('https://example.test/api/data', { headers: { Cookie: 'sc_session=session' } }),
  env: { DB: db },
} as Parameters<typeof onRequestGet>[0]) as Response;
check('D1内の破損AppStateをクライアントへ返さない', corruptedGet.status === 500, corruptedGet.status);
appState = validSnapshot;

const multibyteOversize = JSON.stringify({ value: '😀'.repeat(1_400_000) });
check('多バイト本文fixtureは文字数5MB未満かつ実バイト5MB超', multibyteOversize.length < 5 * 1024 * 1024
  && utf8ByteLength(multibyteOversize) > 5 * 1024 * 1024,
{ chars: multibyteOversize.length, bytes: utf8ByteLength(multibyteOversize) });
const oversizeResponse = await putBody(multibyteOversize, version);
check('保存上限をUTF-8バイト単位で413拒否', oversizeResponse.status === 413, oversizeResponse.status);

process.exit(failures === 0 ? 0 : 1);
