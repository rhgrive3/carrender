/** D1全体保存の楽観的ロック・応答安全性・構造検証の回帰テスト。 */
/// <reference types="node" />
/// <reference types="@cloudflare/workers-types" />
import { validateAppStatePayload } from '../functions/_shared/appState';
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

console.log('--- AppState構造・参照整合性 ---');
const structured = {
  ...validState('structured'),
  goal: { id: 'goal', name: '試験', examDate: '2026-08-31', createdAt: '2026-07-14T00:00:00.000Z' },
  subjects: [{ id: 'subject', name: '数学', color: '#4f7cff', importance: 3, weakness: 3 }],
  materials: [{
    id: 'material', subjectId: 'subject', name: '問題集', totalAmount: 10, doneAmount: 2, minutesPerUnit: 10,
    startDate: '2026-07-14', targetDate: '2026-08-20', completedRanges: [{ start: 1, end: 2 }], archived: false,
  }],
  tasks: [{
    id: 'task', subjectId: 'subject', materialId: 'material', title: '問題集', scheduledDate: '2026-07-14',
    estimatedMinutes: 20, amount: 2, status: 'planned', scheduledStart: '18:00', scheduledEnd: '18:20',
  }],
  sessions: [{
    id: 'session', subjectId: 'subject', materialId: 'material', date: '2026-07-14',
    startedAt: '2026-07-14T09:00:00.000Z', minutes: 20, amountDone: 2,
  }],
  availability: [{ weekday: 1, minutes: 120, windows: [{ start: '18:00', end: '20:00' }] }],
  dayPlans: [{ date: '2026-07-15', availabilityWindows: null }],
  fixedEvents: [{ id: 'event', title: '学校', weekday: 1, date: null, start: '08:00', end: '16:00' }],
  planHistory: [],
};
check('内部整合したAppStateを受理', validateAppStatePayload(structured).ok, validateAppStatePayload(structured));
check('教材総量超過の完了量を拒否', !validateAppStatePayload({ ...structured, materials: [{ ...structured.materials[0], doneAmount: 11 }] }).ok);
check('重複IDを拒否', !validateAppStatePayload({ ...structured, subjects: [...structured.subjects, { ...structured.subjects[0] }] }).ok);
check('存在しない科目参照を拒否', !validateAppStatePayload({ ...structured, materials: [{ ...structured.materials[0], subjectId: 'missing' }] }).ok);
check('未完了タスクの存在しない教材参照を拒否', !validateAppStatePayload({ ...structured, tasks: [{ ...structured.tasks[0], materialId: 'missing' }] }).ok);
check('教材期限が試験日より後なら拒否', !validateAppStatePayload({ ...structured, materials: [{ ...structured.materials[0], targetDate: '2026-09-01' }] }).ok);
const legacyGoalOverflow = { ...structured, materials: [{ ...structured.materials[0], targetDate: '2026-09-01' }] };
const beforeLegacyRead = appState;
appState = JSON.stringify(legacyGoalOverflow);
const legacyGoalOverflowGet = await onRequestGet({
  request: new Request('https://example.test/api/data', { headers: { Cookie: 'sc_session=session' } }),
  env: { DB: db },
} as Parameters<typeof onRequestGet>[0]) as Response;
appState = beforeLegacyRead;
check('保存済み旧データの目標日超過だけはv6移行のためGETできる', legacyGoalOverflowGet.status === 200, legacyGoalOverflowGet.status);
check('不正な時刻と日付を拒否', !validateAppStatePayload({ ...structured, tasks: [{ ...structured.tasks[0], scheduledDate: '2026-02-30', scheduledStart: '25:00', scheduledEnd: '26:00' }] }).ok);
check('固定予定の片側だけの有効期間を拒否', !validateAppStatePayload({
  ...structured,
  fixedEvents: [{ ...structured.fixedEvents[0], startDate: '2026-07-01', endDate: null }],
}).ok);
check('対象日を持たない固定予定を拒否', !validateAppStatePayload({
  ...structured,
  fixedEvents: [{ ...structured.fixedEvents[0], weekday: null, date: null }],
}).ok);
check('同じ日の日別例外を重複登録できない', !validateAppStatePayload({
  ...structured,
  dayPlans: [...structured.dayPlans, { ...structured.dayPlans[0] }],
}).ok);
check('不正な未達成履歴を拒否', !validateAppStatePayload({
  ...structured,
  planHistory: [{
    id: 'missed:bad', taskId: 'old', subjectId: 'subject', materialId: 'material', title: '',
    scheduledDate: '2026-07-13', estimatedMinutes: 20, amount: -1, type: 'new', outcome: 'missed',
    rangeStart: 2, rangeEnd: 1, capturedAt: 'not-a-date',
  }],
}).ok);
const historicalReferences = {
  ...structured,
  tasks: [{ ...structured.tasks[0], id: 'done-old', materialId: 'deleted-material', status: 'done' }],
  sessions: [{ ...structured.sessions[0], id: 'session-old', materialId: 'deleted-material' }],
  planHistory: [{
    id: 'missed:old', taskId: 'old', subjectId: 'subject', materialId: 'deleted-material', title: '削除済み教材',
    scheduledDate: '2026-07-13', estimatedMinutes: 20, amount: 2, type: 'new', outcome: 'missed',
    rangeStart: 1, rangeEnd: 2, capturedAt: '2026-07-14T00:00:00.000Z',
  }],
};
check('削除済み教材を指す完了履歴・実績は保持可能', validateAppStatePayload(historicalReferences).ok, validateAppStatePayload(historicalReferences));

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
