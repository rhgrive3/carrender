/** Real Cloudflare Pages + local D1 integration verification for chunked main AppState sync. */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const base = 'http://127.0.0.1:8792/';
const chunkBytes = 384 * 1024;
const sections = ['meta', 'goal', 'settings', 'subjects', 'materials', 'tasks', 'sessions', 'planHistory', 'availability', 'dayPlans', 'fixedEvents'];
let tempDirectory;
let server;
let serverOutput = '';
let failures = 0;

function check(name, condition, detail) {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.error(`  ❌ ${name}`, detail ?? '');
  }
}

async function command(program, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${program} ${args.join(' ')} exited ${code}\n${output}`));
    });
  });
}

async function waitForServer(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {
      // Wrangler is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Wrangler Pages did not start\n${serverOutput}`);
}

async function stopServer() {
  if (!server?.pid) return;
  try {
    if (process.platform === 'win32') server.kill('SIGTERM');
    else process.kill(-server.pid, 'SIGTERM');
  } catch {
    server.kill('SIGTERM');
  }
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
}

async function jsonRequest(path, { cookie, body, method } = {}) {
  const actualMethod = method ?? (body === undefined ? 'GET' : 'POST');
  const response = await fetch(new URL(path, base), {
    method: actualMethod,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { response, data };
}

async function register(username) {
  const result = await jsonRequest('/api/auth/register', {
    body: { username, password: 'main-state-test-password' },
  });
  const setCookie = result.response.headers.get('set-cookie') ?? '';
  return { ...result, cookie: setCookie.split(';')[0] };
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function utf8Length(value) {
  return Buffer.byteLength(value, 'utf8');
}

function stateSections(state) {
  return {
    meta: [{
      version: state.version,
      schemaVersion: state.schemaVersion,
      isDemo: state.isDemo,
      onboarded: state.onboarded,
      lastReschedule: state.lastReschedule,
      lastPlannedDate: state.lastPlannedDate,
      lastScheduleResult: state.lastScheduleResult,
      lastPlanReason: state.lastPlanReason,
    }],
    goal: state.goal ? [state.goal] : [],
    settings: [state.settings],
    subjects: state.subjects,
    materials: state.materials,
    tasks: state.tasks,
    sessions: state.sessions,
    planHistory: state.planHistory,
    availability: state.availability,
    dayPlans: state.dayPlans,
    fixedEvents: state.fixedEvents,
  };
}

function encodeState(state) {
  const chunks = [];
  const manifestSections = [];
  const bySection = stateSections(state);
  for (const section of sections) {
    const items = bySection[section];
    const sectionChunks = [];
    let current = [];
    const flush = () => {
      if (current.length === 0) return;
      const json = JSON.stringify(current);
      sectionChunks.push({ section, index: sectionChunks.length, json, hash: hash(json), byteLength: utf8Length(json) });
      current = [];
    };
    for (const item of items) {
      const candidate = [...current, item];
      if (utf8Length(JSON.stringify(candidate)) <= chunkBytes) current = candidate;
      else {
        flush();
        const single = JSON.stringify([item]);
        if (utf8Length(single) > chunkBytes) throw new Error(`${section} single item exceeds chunk limit`);
        current = [item];
      }
    }
    flush();
    chunks.push(...sectionChunks);
    manifestSections.push({
      name: section,
      chunkCount: sectionChunks.length,
      itemCount: items.length,
      byteLength: sectionChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
      hashes: sectionChunks.map((chunk) => chunk.hash),
    });
  }
  return {
    chunks,
    manifest: {
      formatVersion: 1,
      sections: manifestSections,
      totalChunks: chunks.length,
      totalItems: manifestSections.reduce((sum, section) => sum + section.itemCount, 0),
      totalBytes: chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
    },
  };
}

function baseState(sessionCount = 0, memoSize = 0, suffix = '') {
  const now = '2026-07-14T00:00:00.000Z';
  const sessions = Array.from({ length: sessionCount }, (_, index) => ({
    id: `session-${suffix}-${index}`,
    taskId: null,
    subjectId: 'subject-1',
    materialId: 'material-1',
    date: '2026-07-14',
    startedAt: now,
    minutes: 30,
    amountDone: 0,
    rangeLabel: '',
    focus: 4,
    memo: `${suffix}-${index}-${'化学'.repeat(memoSize)}`,
    source: 'manual',
    updatedAt: now,
  }));
  return {
    version: 8,
    schemaVersion: 8,
    isDemo: false,
    onboarded: true,
    goal: { id: 'goal-1', name: `医学部合格${suffix}`, examDate: '2027-02-01', createdAt: now },
    subjects: [{ id: 'subject-1', name: '化学', color: '#123456', importance: 5, weakness: 4 }],
    materials: [{
      id: 'material-1', subjectId: 'subject-1', name: '化学特講', unit: '講義', totalAmount: 20,
      doneAmount: 0, completedRanges: [], totalUnits: 20, startDate: '2026-07-14', targetDate: '2026-08-20',
      priority: 5, difficulty: 4, minutesPerUnit: 60, unitStep: 1, splittable: true,
      preferredCadence: { type: 'timesPerWeek', count: 4 }, dailyTarget: null, weeklyTarget: 4,
      deadlinePolicy: 'strict', examRelevance: 5, reviewEnabled: false, reviewIntervals: [1, 3, 7],
      paused: false, round: 1, archived: false, createdAt: now,
    }],
    tasks: [],
    planHistory: [],
    sessions,
    availability: [],
    dayPlans: [],
    fixedEvents: [],
    settings: { theme: 'auto' },
    lastReschedule: null,
    lastPlannedDate: null,
    lastScheduleResult: null,
    lastPlanReason: suffix || null,
  };
}

async function begin(cookie, mutationId, expectedUpdatedAt, encoded) {
  return jsonRequest('/api/data/v2', {
    cookie,
    body: { action: 'begin', mutationId, expectedUpdatedAt, manifest: encoded.manifest },
  });
}

async function putChunk(cookie, generationId, chunk) {
  return jsonRequest('/api/data/v2', {
    cookie,
    body: { action: 'putChunk', generationId, section: chunk.section, index: chunk.index, json: chunk.json, hash: chunk.hash },
  });
}

async function upload(cookie, generationId, chunks) {
  for (const chunk of chunks) {
    const result = await putChunk(cookie, generationId, chunk);
    if (![200, 201].includes(result.response.status)) throw new Error(`chunk upload failed: ${result.response.status} ${JSON.stringify(result.data)}`);
  }
}

async function commit(cookie, generationId) {
  return jsonRequest('/api/data/v2', { cookie, body: { action: 'commit', generationId } });
}

try {
  tempDirectory = await mkdtemp(join(tmpdir(), 'carrender-main-state-api-'));
  const persistence = join(tempDirectory, 'state');
  const site = join(tempDirectory, 'site');
  await mkdir(persistence, { recursive: true });
  await mkdir(site, { recursive: true });
  await writeFile(join(site, 'index.html'), '<!doctype html><title>main state api test</title>');

  await command('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persistence]);
  const wranglerConfig = await readFile(join(cwd, 'wrangler.toml'), 'utf8');
  const databaseId = /database_id\s*=\s*"([^"]+)"/u.exec(wranglerConfig)?.[1];
  if (!databaseId) throw new Error('wrangler.toml does not contain a D1 database_id');
  server = spawn('npx', [
    'wrangler', 'pages', 'dev', site,
    `--d1=DB=${databaseId}`,
    '--ip=127.0.0.1', '--port=8792', `--persist-to=${persistence}`,
    '--log-level=error', '--show-interactive-dev-session=false',
  ], {
    cwd,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const appendServerOutput = (chunk) => {
    serverOutput = `${serverOutput}${chunk.toString()}`.slice(-40_000);
  };
  server.stdout.on('data', appendServerOutput);
  server.stderr.on('data', appendServerOutput);
  await waitForServer();

  console.log('--- Main AppState API: auth and legacy migration ---');
  const unauthenticatedGet = await jsonRequest('/api/data/v2');
  const unauthenticatedPost = await jsonRequest('/api/data/v2', { body: { action: 'begin' } });
  check('未認証GETを401で拒否', unauthenticatedGet.response.status === 401, unauthenticatedGet);
  check('未認証POSTを401で拒否', unauthenticatedPost.response.status === 401, unauthenticatedPost);

  const user = await register(`mainstate${process.pid}`.slice(0, 20));
  check('ローカルD1へテストユーザー登録', user.response.status === 201 && user.cookie.startsWith('sc_session='), user);
  if (!user.cookie) throw new Error('test user registration failed');

  const empty = await jsonRequest('/api/data/v2', { cookie: user.cookie });
  check('初期状態はheadなし', empty.response.status === 200 && empty.data.generationId === null && empty.data.legacyAvailable === false, empty);
  check('同期応答をno-store', empty.response.headers.get('cache-control') === 'no-store', empty.response.headers.get('cache-control'));

  const legacyState = baseState(1, 1, 'legacy');
  const legacyPut = await jsonRequest('/api/data', { cookie: user.cookie, body: legacyState, method: 'PUT' });
  check('旧形式データを移行元として保存', legacyPut.response.status === 200 && typeof legacyPut.data.updatedAt === 'string', legacyPut);
  const legacyDetected = await jsonRequest('/api/data/v2', { cookie: user.cookie });
  check('v2が旧形式データを検出', legacyDetected.response.status === 200 && legacyDetected.data.legacyAvailable === true, legacyDetected);

  console.log('--- Main AppState API: payload beyond legacy 5 MiB ---');
  const largeState = baseState(9_000, 180, 'large');
  const largeLegacyBytes = utf8Length(JSON.stringify(largeState));
  const largeEncoded = encodeState(largeState);
  check('fixtureが旧5MiB上限を超える', largeLegacyBytes > 5 * 1024 * 1024, largeLegacyBytes);
  check('全chunkが384KiB以下', largeEncoded.chunks.every((chunk) => chunk.byteLength <= chunkBytes), Math.max(...largeEncoded.chunks.map((chunk) => chunk.byteLength)));

  const largeBegin = await begin(user.cookie, 'mutation-large-state-0001', legacyPut.data.updatedAt, largeEncoded);
  check('旧世代をbaseに大容量generation開始', largeBegin.response.status === 201 && largeBegin.data.status === 'staging', largeBegin);
  await upload(user.cookie, largeBegin.data.generationId, largeEncoded.chunks);
  const duplicateChunk = await putChunk(user.cookie, largeBegin.data.generationId, largeEncoded.chunks[0]);
  check('同一chunk再送を冪等受理', duplicateChunk.response.status === 200 && duplicateChunk.data.duplicate === true, duplicateChunk);
  const largeCommit = await commit(user.cookie, largeBegin.data.generationId);
  check('5MiB超状態を原子的にcommit', largeCommit.response.status === 200 && typeof largeCommit.data.updatedAt === 'string', largeCommit);
  let currentVersion = largeCommit.data.updatedAt;

  const currentManifest = await jsonRequest('/api/data/v2', { cookie: user.cookie });
  check('公開headが確定generationだけを参照', currentManifest.response.status === 200 && currentManifest.data.generationId === largeBegin.data.generationId, currentManifest);
  const sessionSection = currentManifest.data.manifest.sections.find((entry) => entry.name === 'sessions');
  const downloadedSessions = [];
  for (let index = 0; index < sessionSection.chunkCount; index += 1) {
    const chunk = await jsonRequest('/api/data/v2', {
      cookie: user.cookie,
      body: { action: 'getChunk', generationId: currentManifest.data.generationId, section: 'sessions', index },
    });
    check(`sessions chunk ${index}をhash付きで取得`, chunk.response.status === 200 && hash(chunk.data.json) === chunk.data.hash, chunk);
    downloadedSessions.push(...JSON.parse(chunk.data.json));
  }
  check('大容量sessionを全件復元', downloadedSessions.length === largeState.sessions.length && downloadedSessions.at(-1).id === largeState.sessions.at(-1).id, downloadedSessions.length);

  const duplicateBegin = await begin(user.cookie, 'mutation-large-state-0001', legacyPut.data.updatedAt, largeEncoded);
  check('同一mutation再送を確定済み成功として返す', duplicateBegin.response.status === 200 && duplicateBegin.data.status === 'committed' && duplicateBegin.data.updatedAt === currentVersion, duplicateBegin);
  const changedEncoded = encodeState({ ...largeState, lastPlanReason: 'different-mutation-content' });
  const mutationReuse = await begin(user.cookie, 'mutation-large-state-0001', legacyPut.data.updatedAt, changedEncoded);
  check('同じmutationIdの内容差替えを拒否', mutationReuse.response.status === 409, mutationReuse);

  const legacyAfterMigrationGet = await jsonRequest('/api/data', { cookie: user.cookie });
  const legacyAfterMigrationPut = await jsonRequest('/api/data', { cookie: user.cookie, body: legacyState, method: 'PUT' });
  check('移行後の旧GETを426で遮断', legacyAfterMigrationGet.response.status === 426 && legacyAfterMigrationGet.data.code === 'CHUNKED_MAIN_STATE_REQUIRED', legacyAfterMigrationGet);
  check('移行後の旧PUTを426で遮断', legacyAfterMigrationPut.response.status === 426, legacyAfterMigrationPut);

  console.log('--- Main AppState API: resumable incomplete upload ---');
  const resumeState = baseState(20, 10, 'resume');
  const resumeEncoded = encodeState(resumeState);
  const resumeBegin = await begin(user.cookie, 'mutation-resume-state-0002', currentVersion, resumeEncoded);
  const missing = resumeEncoded.chunks.at(-1);
  await upload(user.cookie, resumeBegin.data.generationId, resumeEncoded.chunks.slice(0, -1));
  const incompleteCommit = await commit(user.cookie, resumeBegin.data.generationId);
  check('欠損chunkがある世代を公開しない', incompleteCommit.response.status === 409 && /不足/.test(incompleteCommit.data.error), incompleteCommit);
  const headWhileIncomplete = await jsonRequest('/api/data/v2', { cookie: user.cookie });
  check('欠損中も旧headを維持', headWhileIncomplete.data.generationId === largeBegin.data.generationId, headWhileIncomplete);
  await putChunk(user.cookie, resumeBegin.data.generationId, missing);
  const resumedCommit = await commit(user.cookie, resumeBegin.data.generationId);
  check('欠損uploadを再開してcommit', resumedCommit.response.status === 200, resumedCommit);
  currentVersion = resumedCommit.data.updatedAt;

  console.log('--- Main AppState API: concurrent optimistic locking ---');
  const firstState = baseState(2, 2, 'first');
  const secondState = baseState(3, 2, 'second');
  const firstEncoded = encodeState(firstState);
  const secondEncoded = encodeState(secondState);
  const [firstBegin, secondBegin] = await Promise.all([
    begin(user.cookie, 'mutation-concurrent-first-0003', currentVersion, firstEncoded),
    begin(user.cookie, 'mutation-concurrent-second-0004', currentVersion, secondEncoded),
  ]);
  check('同じbaseから2世代をstaging可能', firstBegin.response.status === 201 && secondBegin.response.status === 201, { firstBegin, secondBegin });
  await Promise.all([
    upload(user.cookie, firstBegin.data.generationId, firstEncoded.chunks),
    upload(user.cookie, secondBegin.data.generationId, secondEncoded.chunks),
  ]);
  const firstCommit = await commit(user.cookie, firstBegin.data.generationId);
  const secondCommit = await commit(user.cookie, secondBegin.data.generationId);
  check('先にcommitした世代だけhead更新', firstCommit.response.status === 200, firstCommit);
  check('後発commitを409で拒否', secondCommit.response.status === 409 && secondCommit.data.updatedAt === firstCommit.data.updatedAt, secondCommit);

  const oldMutationAfterHeadMoved = await begin(user.cookie, 'mutation-resume-state-0002', largeCommit.data.updatedAt, resumeEncoded);
  check('古い確定mutationを最新成功として誤報しない', oldMutationAfterHeadMoved.response.status === 409 && oldMutationAfterHeadMoved.data.updatedAt === firstCommit.data.updatedAt, oldMutationAfterHeadMoved);

  const tamperState = baseState(1, 1, 'tamper');
  const tamperEncoded = encodeState(tamperState);
  const tamperBegin = await begin(user.cookie, 'mutation-tamper-state-0005', firstCommit.data.updatedAt, tamperEncoded);
  const tamperedChunk = { ...tamperEncoded.chunks[0], json: `${tamperEncoded.chunks[0].json} ` };
  const tamperUpload = await putChunk(user.cookie, tamperBegin.data.generationId, tamperedChunk);
  check('manifest hashと異なるchunkを拒否', tamperUpload.response.status === 400, tamperUpload);
} catch (error) {
  failures += 1;
  console.error(error);
  if (serverOutput) console.error(serverOutput);
} finally {
  await stopServer();
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
}

console.log(failures === 0 ? '\n🎉 ALL PASS (main AppState API)' : `\n💥 ${failures} FAILURES (main AppState API)`);
process.exit(failures === 0 ? 0 : 1);
