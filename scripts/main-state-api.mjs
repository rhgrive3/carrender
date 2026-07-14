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
  else { failures += 1; console.error(`  ❌ ${name}`, detail ?? ''); }
}
async function command(program, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve(output) : reject(new Error(`${program} ${args.join(' ')} exited ${code}\n${output}`)));
  });
}
async function waitForServer(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(base)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Wrangler Pages did not start\n${serverOutput}`);
}
async function stopServer() {
  if (!server?.pid) return;
  try { process.platform === 'win32' ? server.kill('SIGTERM') : process.kill(-server.pid, 'SIGTERM'); }
  catch { server.kill('SIGTERM'); }
  await Promise.race([new Promise((resolve) => server.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 3_000))]);
}
async function jsonRequest(path, { cookie, body, method } = {}) {
  const response = await fetch(new URL(path, base), {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data;
  try { data = await response.json(); } catch { data = null; }
  return { response, data };
}
async function register(username) {
  const result = await jsonRequest('/api/auth/register', { body: { username, password: 'main-state-test-password' } });
  return { ...result, cookie: (result.response.headers.get('set-cookie') ?? '').split(';')[0] };
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
const utf8Length = (value) => Buffer.byteLength(value, 'utf8');

function stateSections(state) {
  return {
    meta: [{ version: state.version, schemaVersion: state.schemaVersion, isDemo: state.isDemo, onboarded: state.onboarded,
      lastReschedule: state.lastReschedule, lastPlannedDate: state.lastPlannedDate,
      lastScheduleResult: state.lastScheduleResult, lastPlanReason: state.lastPlanReason }],
    goal: state.goal ? [state.goal] : [], settings: [state.settings], subjects: state.subjects,
    materials: state.materials, tasks: state.tasks, sessions: state.sessions, planHistory: state.planHistory,
    availability: state.availability, dayPlans: state.dayPlans, fixedEvents: state.fixedEvents,
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
    manifestSections.push({ name: section, chunkCount: sectionChunks.length, itemCount: items.length,
      byteLength: sectionChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0), hashes: sectionChunks.map((chunk) => chunk.hash) });
  }
  return { chunks, manifest: { formatVersion: 1, sections: manifestSections, totalChunks: chunks.length,
    totalItems: manifestSections.reduce((sum, section) => sum + section.itemCount, 0),
    totalBytes: chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0) } };
}
function baseState(sessionCount = 0, memoSize = 0, suffix = '') {
  const now = '2026-07-14T00:00:00.000Z';
  return {
    version: 8, schemaVersion: 8, isDemo: false, onboarded: true,
    goal: { id: 'goal-1', name: `医学部合格${suffix}`, examDate: '2027-02-01', createdAt: now },
    subjects: [{ id: 'subject-1', name: '化学', color: '#123456', importance: 5, weakness: 4 }],
    materials: [{ id: 'material-1', subjectId: 'subject-1', name: '化学特講', unit: '講義', totalAmount: 20,
      doneAmount: 0, completedRanges: [], totalUnits: 20, startDate: '2026-07-14', targetDate: '2026-08-20',
      priority: 5, difficulty: 4, minutesPerUnit: 60, unitStep: 1, splittable: true,
      preferredCadence: { type: 'timesPerWeek', count: 4 }, dailyTarget: null, weeklyTarget: 4,
      deadlinePolicy: 'strict', examRelevance: 5, reviewEnabled: false, reviewIntervals: [1, 3, 7],
      paused: false, round: 1, archived: false, createdAt: now }],
    tasks: [], planHistory: [],
    sessions: Array.from({ length: sessionCount }, (_, index) => ({
      id: `session-${suffix}-${index}`, taskId: null, subjectId: 'subject-1', materialId: 'material-1',
      date: '2026-07-14', startedAt: now, minutes: 30, amountDone: 0, rangeLabel: '', focus: 4,
      memo: `${suffix}-${index}-${'化学'.repeat(memoSize)}`, source: 'manual', updatedAt: now,
    })),
    availability: [], dayPlans: [], fixedEvents: [], settings: { theme: 'auto' },
    lastReschedule: null, lastPlannedDate: null, lastScheduleResult: null, lastPlanReason: suffix || null,
  };
}
async function begin(cookie, mutationId, expectedUpdatedAt, encoded) {
  return jsonRequest('/api/data/v2', { cookie, body: { action: 'begin', mutationId, expectedUpdatedAt, manifest: encoded.manifest } });
}
async function putChunk(cookie, generationId, chunk) {
  return jsonRequest('/api/data/v2', { cookie, body: { action: 'putChunk', generationId, section: chunk.section,
    index: chunk.index, json: chunk.json, hash: chunk.hash } });
}
async function upload(cookie, generationId, chunks) {
  for (const chunk of chunks) {
    const result = await putChunk(cookie, generationId, chunk);
    if (![200, 201].includes(result.response.status)) throw new Error(`chunk upload failed: ${result.response.status} ${JSON.stringify(result.data)}`);
  }
}
const commit = (cookie, generationId) => jsonRequest('/api/data/v2', { cookie, body: { action: 'commit', generationId } });

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
  server = spawn('npx', ['wrangler', 'pages', 'dev', site, `--d1=DB=${databaseId}`, '--ip=127.0.0.1', '--port=8792',
    `--persist-to=${persistence}`, '--log-level=error', '--show-interactive-dev-session=false'],
  { cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const append = (chunk) => { serverOutput = `${serverOutput}${chunk.toString()}`.slice(-40_000); };
  server.stdout.on('data', append); server.stderr.on('data', append);
  await waitForServer();

  const unauthenticated = await jsonRequest('/api/data/v2');
  check('未認証を401で拒否', unauthenticated.response.status === 401, unauthenticated);
  const user = await register(`mainstate${process.pid}`.slice(0, 20));
  check('テストユーザー登録', user.response.status === 201 && user.cookie.startsWith('sc_session='), user);
  if (!user.cookie) throw new Error('registration failed');

  const empty = await jsonRequest('/api/data/v2', { cookie: user.cookie });
  check('初期headなし/no-store', empty.response.status === 200 && empty.data.generationId === null
    && empty.data.legacyAvailable === false && empty.response.headers.get('cache-control') === 'no-store', empty);

  const legacyState = baseState(1, 1, 'legacy');
  const legacyPut = await jsonRequest('/api/data', { cookie: user.cookie, body: legacyState, method: 'PUT' });
  check('旧形式を移行元として保存', legacyPut.response.status === 200 && typeof legacyPut.data.updatedAt === 'string', legacyPut);

  const largeState = baseState(9_000, 180, 'large');
  const encodedLarge = encodeState(largeState);
  check('fixtureが旧5MiBを超える', utf8Length(JSON.stringify(largeState)) > 5 * 1024 * 1024);
  check('全chunkが384KiB以下', encodedLarge.chunks.every((chunk) => chunk.byteLength <= chunkBytes));
  const largeBegin = await begin(user.cookie, 'mutation-large-state-0001', legacyPut.data.updatedAt, encodedLarge);
  check('大容量generation開始', largeBegin.response.status === 201, largeBegin);
  await upload(user.cookie, largeBegin.data.generationId, encodedLarge.chunks);
  const duplicateChunk = await putChunk(user.cookie, largeBegin.data.generationId, encodedLarge.chunks[0]);
  check('chunk再送を冪等受理', duplicateChunk.response.status === 200 && duplicateChunk.data.duplicate === true, duplicateChunk);
  const largeCommit = await commit(user.cookie, largeBegin.data.generationId);
  check('5MiB超状態をcommit', largeCommit.response.status === 200, largeCommit);
  let currentVersion = largeCommit.data.updatedAt;

  const manifest = await jsonRequest('/api/data/v2', { cookie: user.cookie });
  const sessionSection = manifest.data.manifest.sections.find((entry) => entry.name === 'sessions');
  let downloadedCount = 0;
  for (let index = 0; index < sessionSection.chunkCount; index += 1) {
    const chunk = await jsonRequest('/api/data/v2', { cookie: user.cookie,
      body: { action: 'getChunk', generationId: manifest.data.generationId, section: 'sessions', index } });
    check(`session chunk ${index} hash`, chunk.response.status === 200 && hash(chunk.data.json) === chunk.data.hash, chunk);
    downloadedCount += JSON.parse(chunk.data.json).length;
  }
  check('大容量sessionを全件復元', downloadedCount === largeState.sessions.length, downloadedCount);

  const duplicateBegin = await begin(user.cookie, 'mutation-large-state-0001', legacyPut.data.updatedAt, encodedLarge);
  check('同一mutation再送を確定済み成功として返す', duplicateBegin.response.status === 200 && duplicateBegin.data.updatedAt === currentVersion, duplicateBegin);
  const changedEncoded = encodeState({ ...largeState, lastPlanReason: 'different-mutation-content' });
  const mutationReuse = await begin(user.cookie, 'mutation-large-state-0001', legacyPut.data.updatedAt, changedEncoded);
  check('mutationId内容差替えを拒否', mutationReuse.response.status === 409, mutationReuse);

  const legacyAfter = await jsonRequest('/api/data', { cookie: user.cookie });
  check('移行後の旧APIを426で遮断', legacyAfter.response.status === 426 && legacyAfter.data.code === 'CHUNKED_MAIN_STATE_REQUIRED', legacyAfter);

  const resumeEncoded = encodeState(baseState(20, 10, 'resume'));
  const resumeBegin = await begin(user.cookie, 'mutation-resume-state-0002', currentVersion, resumeEncoded);
  const missing = resumeEncoded.chunks.at(-1);
  await upload(user.cookie, resumeBegin.data.generationId, resumeEncoded.chunks.slice(0, -1));
  const incomplete = await commit(user.cookie, resumeBegin.data.generationId);
  check('欠損chunkのcommitを拒否', incomplete.response.status === 409, incomplete);
  await putChunk(user.cookie, resumeBegin.data.generationId, missing);
  const resumed = await commit(user.cookie, resumeBegin.data.generationId);
  check('欠損uploadを再開してcommit', resumed.response.status === 200, resumed);
  currentVersion = resumed.data.updatedAt;

  const firstEncoded = encodeState(baseState(2, 2, 'first'));
  const secondEncoded = encodeState(baseState(3, 2, 'second'));
  const [firstBegin, secondBegin] = await Promise.all([
    begin(user.cookie, 'mutation-concurrent-first-0003', currentVersion, firstEncoded),
    begin(user.cookie, 'mutation-concurrent-second-0004', currentVersion, secondEncoded),
  ]);
  await Promise.all([upload(user.cookie, firstBegin.data.generationId, firstEncoded.chunks), upload(user.cookie, secondBegin.data.generationId, secondEncoded.chunks)]);
  const firstCommit = await commit(user.cookie, firstBegin.data.generationId);
  const secondCommit = await commit(user.cookie, secondBegin.data.generationId);
  check('並行commitの先着だけ成功', firstCommit.response.status === 200 && secondCommit.response.status === 409, { firstCommit, secondCommit });

  const oldMutation = await begin(user.cookie, 'mutation-resume-state-0002', largeCommit.data.updatedAt, resumeEncoded);
  check('古い確定mutationを最新成功と誤報しない', oldMutation.response.status === 409, oldMutation);

  const tamperEncoded = encodeState(baseState(1, 1, 'tamper'));
  const tamperBegin = await begin(user.cookie, 'mutation-tamper-state-0005', firstCommit.data.updatedAt, tamperEncoded);
  const tampered = { ...tamperEncoded.chunks[0], json: `${tamperEncoded.chunks[0].json} ` };
  const tamperUpload = await putChunk(user.cookie, tamperBegin.data.generationId, tampered);
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
