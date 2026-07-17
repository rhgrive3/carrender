/** End-to-end regression for session.taskId reference validation on both save APIs. */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const base = 'http://127.0.0.1:8793/';
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
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve(output)
      : reject(new Error(`${program} ${args.join(' ')} exited ${code}\n${output}`)));
  });
}

async function waitForServer(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(base)).ok) return;
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
    process.platform === 'win32' ? server.kill('SIGTERM') : process.kill(-server.pid, 'SIGTERM');
  } catch {
    server.kill('SIGTERM');
  }
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
}

async function jsonRequest(path, { cookie, body, method } = {}) {
  const response = await fetch(new URL(path, base), {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
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
    body: { username, password: 'session-task-reference-test-password' },
  });
  return {
    ...result,
    cookie: (result.response.headers.get('set-cookie') ?? '').split(';')[0],
  };
}

const hash = (value) => createHash('sha256').update(value).digest('hex');
const utf8Length = (value) => Buffer.byteLength(value, 'utf8');

function appState(taskId) {
  const now = '2026-07-17T00:00:00.000Z';
  return {
    version: 8,
    schemaVersion: 8,
    isDemo: false,
    onboarded: true,
    goal: null,
    subjects: [{ id: 'subject-1', name: '数学', color: '#4f7cff', importance: 4, weakness: 3 }],
    materials: [{
      id: 'material-1',
      subjectId: 'subject-1',
      name: '問題集',
      unit: '問',
      totalAmount: 100,
      doneAmount: 1,
      completedRanges: [{ start: 1, end: 1 }],
      totalUnits: 100,
      startDate: '2026-07-17',
      targetDate: '2026-08-20',
      priority: 4,
      difficulty: 3,
      minutesPerUnit: 10,
      unitStep: 1,
      splittable: true,
      preferredCadence: { type: 'timesPerWeek', count: 4 },
      dailyTarget: null,
      weeklyTarget: 4,
      deadlinePolicy: 'strict',
      examRelevance: 4,
      reviewEnabled: false,
      reviewIntervals: [1, 3, 7],
      paused: false,
      round: 1,
      archived: false,
      createdAt: now,
    }],
    tasks: [{
      id: 'task-1',
      subjectId: 'subject-1',
      materialId: 'material-1',
      title: '問題集 1問',
      scheduledDate: '2026-07-17',
      estimatedMinutes: 10,
      amount: 1,
      status: 'done',
    }],
    sessions: [{
      id: 'session-1',
      taskId,
      subjectId: 'subject-1',
      materialId: 'material-1',
      date: '2026-07-17',
      startedAt: now,
      minutes: 10,
      amountDone: 1,
      rangeLabel: '1問',
      focus: 4,
      memo: '',
      source: 'timer',
      updatedAt: now,
    }],
    planHistory: [],
    availability: [],
    dayPlans: [],
    fixedEvents: [],
    settings: { theme: 'auto' },
    lastReschedule: null,
    lastPlannedDate: null,
    lastScheduleResult: null,
    lastPlanReason: null,
  };
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
    const sectionChunks = items.length === 0 ? [] : [JSON.stringify(items)];
    const encodedChunks = sectionChunks.map((json, index) => ({
      section,
      index,
      json,
      hash: hash(json),
      byteLength: utf8Length(json),
    }));
    chunks.push(...encodedChunks);
    manifestSections.push({
      name: section,
      chunkCount: encodedChunks.length,
      itemCount: items.length,
      byteLength: encodedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
      hashes: encodedChunks.map((chunk) => chunk.hash),
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

async function begin(cookie, expectedUpdatedAt, encoded) {
  return jsonRequest('/api/data/v2', {
    cookie,
    body: {
      action: 'begin',
      mutationId: 'mutation-orphan-task-reference-0001',
      expectedUpdatedAt,
      manifest: encoded.manifest,
    },
  });
}

async function upload(cookie, generationId, chunks) {
  for (const chunk of chunks) {
    const result = await jsonRequest('/api/data/v2', {
      cookie,
      body: {
        action: 'putChunk',
        generationId,
        section: chunk.section,
        index: chunk.index,
        json: chunk.json,
        hash: chunk.hash,
      },
    });
    if (![200, 201].includes(result.response.status)) {
      throw new Error(`chunk upload failed: ${result.response.status} ${JSON.stringify(result.data)}`);
    }
  }
}

try {
  tempDirectory = await mkdtemp(join(tmpdir(), 'carrender-session-task-api-'));
  const persistence = join(tempDirectory, 'state');
  const site = join(tempDirectory, 'site');
  await mkdir(persistence, { recursive: true });
  await mkdir(site, { recursive: true });
  await writeFile(join(site, 'index.html'), '<!doctype html><title>session task reference test</title>');
  await command('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persistence]);
  const wranglerConfig = await readFile(join(cwd, 'wrangler.toml'), 'utf8');
  const databaseId = /database_id\s*=\s*"([^"]+)"/u.exec(wranglerConfig)?.[1];
  if (!databaseId) throw new Error('wrangler.toml does not contain a D1 database_id');

  server = spawn('npx', [
    'wrangler', 'pages', 'dev', site,
    `--d1=DB=${databaseId}`,
    '--ip=127.0.0.1',
    '--port=8793',
    `--persist-to=${persistence}`,
    '--log-level=error',
    '--show-interactive-dev-session=false',
  ], { cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const append = (chunk) => { serverOutput = `${serverOutput}${chunk.toString()}`.slice(-40_000); };
  server.stdout.on('data', append);
  server.stderr.on('data', append);
  await waitForServer();

  const user = await register(`taskref${process.pid}`.slice(0, 20));
  check('テストユーザー登録', user.response.status === 201 && user.cookie.startsWith('sc_session='), user);
  if (!user.cookie) throw new Error('registration failed');

  const orphan = appState('missing-task');
  const legacyRejected = await jsonRequest('/api/data', {
    cookie: user.cookie,
    body: orphan,
    method: 'PUT',
  });
  check(
    '旧保存APIは存在しないtaskId参照を400で拒否',
    legacyRejected.response.status === 400 && String(legacyRejected.data?.error ?? '').includes('taskId'),
    legacyRejected,
  );

  const validLegacy = await jsonRequest('/api/data', {
    cookie: user.cookie,
    body: appState('task-1'),
    method: 'PUT',
  });
  check('整合した旧形式を移行元として保存', validLegacy.response.status === 200 && typeof validLegacy.data?.updatedAt === 'string', validLegacy);

  const encoded = encodeState(orphan);
  const started = await begin(user.cookie, validLegacy.data.updatedAt, encoded);
  check('孤立参照fixtureのchunked generation開始', started.response.status === 201, started);
  await upload(user.cookie, started.data.generationId, encoded.chunks);
  const committed = await jsonRequest('/api/data/v2', {
    cookie: user.cookie,
    body: { action: 'commit', generationId: started.data.generationId },
  });
  check(
    '分割保存APIも存在しないtaskId参照をcommit時に400で拒否',
    committed.response.status === 400 && String(committed.data?.error ?? '').includes('taskId'),
    committed,
  );

  const head = await jsonRequest('/api/data/v2', { cookie: user.cookie });
  check(
    '拒否した分割世代をheadへ昇格させない',
    head.response.status === 200 && head.data?.generationId === null && head.data?.legacyAvailable === true,
    head,
  );
} catch (error) {
  failures += 1;
  console.error(error);
  if (serverOutput) console.error(serverOutput);
} finally {
  await stopServer();
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
}

console.log(failures === 0
  ? '\n🎉 ALL PASS (session task reference save APIs)'
  : `\n💥 ${failures} FAILURES (session task reference save APIs)`);
process.exit(failures === 0 ? 0 : 1);
