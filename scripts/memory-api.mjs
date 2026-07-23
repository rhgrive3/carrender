/** Real Cloudflare Pages + local D1 integration verification for memory sync. */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const base = 'http://127.0.0.1:8791/';
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

async function jsonRequest(path, { cookie, body } = {}) {
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? 'GET' : 'POST',
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
    body: { username, password: 'memory-test-password' },
  });
  const setCookie = result.response.headers.get('set-cookie') ?? '';
  return { ...result, cookie: setCookie.split(';')[0] };
}

const now = '2026-07-12T00:00:00.000Z';
const later = '2026-07-12T00:01:00.000Z';
const clientId = 'client-memory-api-test';

function mutation(entityType, entityId, payload, options = {}) {
  return {
    mutationId: options.mutationId ?? `mutation-${entityType}-${entityId}`,
    clientId,
    entityType,
    entityId,
    entityKey: `${entityType}:${entityId}`,
    operation: options.operation ?? 'create',
    ...(options.baseRevision === undefined ? {} : { baseRevision: options.baseRevision }),
    payload,
    createdAt: options.createdAt ?? now,
  };
}

function syncBody({ cursor, mutations = [], attempts = [] } = {}) {
  return {
    schemaVersion: 1,
    clientId,
    ...(cursor === undefined ? {} : { cursor }),
    mutations,
    attempts,
  };
}

try {
  tempDirectory = await mkdtemp(join(tmpdir(), 'carrender-memory-api-'));
  const persistence = join(tempDirectory, 'state');
  const site = join(tempDirectory, 'site');
  await mkdir(persistence, { recursive: true });
  await mkdir(site, { recursive: true });
  await writeFile(join(site, 'index.html'), '<!doctype html><title>memory api test</title>');

  await command('npx', [
    'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persistence,
  ]);
  const wranglerConfig = await readFile(join(cwd, 'wrangler.toml'), 'utf8');
  const databaseId = /database_id\s*=\s*"([^"]+)"/u.exec(wranglerConfig)?.[1];
  if (!databaseId) throw new Error('wrangler.toml does not contain a D1 database_id');
  server = spawn('npx', [
    'wrangler', 'pages', 'dev', site,
    `--d1=DB=${databaseId}`,
    '--ip=127.0.0.1', '--port=8791', `--persist-to=${persistence}`,
    '--log-level=error', '--show-interactive-dev-session=false',
  ], {
    cwd,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const appendServerOutput = (chunk) => {
    serverOutput = `${serverOutput}${chunk.toString()}`.slice(-30_000);
  };
  server.stdout.on('data', appendServerOutput);
  server.stderr.on('data', appendServerOutput);
  await waitForServer();

  console.log('--- Memory API: auth and initial content sync ---');
  const unauthenticated = await jsonRequest('/api/memory/sync', { body: syncBody() });
  check('未認証同期を401で拒否', unauthenticated.response.status === 401, unauthenticated);

  const firstUser = await register(`memoryapi${process.pid}`.slice(0, 20));
  check('ローカルD1へテストユーザー登録', firstUser.response.status === 201 && firstUser.cookie.startsWith('sc_session='), firstUser);
  check('登録応答が安定したuserIdを返す', typeof firstUser.data?.userId === 'string' && firstUser.data.userId.length > 0, firstUser.data);
  if (!firstUser.cookie) throw new Error(`test user registration failed with ${firstUser.response.status}`);
  const me = await jsonRequest('/api/auth/me', { cookie: firstUser.cookie });
  check('認証確認応答も同じuserIdを返す', me.response.status === 200 && me.data.userId === firstUser.data.userId, me);
  const login = await jsonRequest('/api/auth/login', {
    body: { username: firstUser.data.username, password: 'memory-test-password' },
  });
  check('再ログインしてもuserIdが変わらない', login.response.status === 200 && login.data.userId === firstUser.data.userId, login);

  const item = {
    id: 'item-1', kind: 'expression', label: 'take A into account', lemma: 'take A into account', tags: ['LEAP'],
    source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1,
  };
  const sense = {
    id: 'sense-1', itemId: item.id, promptJa: '〜を考慮する', meaningJa: '〜を考慮する',
    siblingGroupId: 'siblings-1', tags: [], source: 'user', verificationStatus: 'verified',
    createdAt: now, updatedAt: now, revision: 1,
  };
  const answer = {
    id: 'answer-1', senseId: sense.id, displayForm: 'take A into account', citationForm: 'take A into account',
    pattern: 'take {object} into account', acceptedVariants: [], orthographicVariants: [], source: 'user',
    verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1,
  };
  const exercise = {
    id: 'exercise-1', senseId: sense.id, answerId: answer.id, type: 'fill_blank',
    prompt: 'Take the delay ( ) account.', acceptedAnswerIds: [answer.id], requiredTokens: ['into'],
    forbiddenTokens: [], siblingGroupId: sense.siblingGroupId, source: 'user', verificationStatus: 'verified',
    createdAt: now, updatedAt: now, revision: 1,
  };
  const session = {
    id: 'session-1', status: 'active', selectedSetIds: [], initialTargetIds: ['target-output'],
    config: { questionCount: { type: 'count', count: 1 }, direction: 'output', includeUnverifiedAi: false },
    seed: 'api-seed', currentTargetId: 'target-output', queueState: { answerCount: 0 },
    completedTargetIds: [], needsReviewTargetIds: [], answerCount: 0, createdAt: now, updatedAt: now,
  };
  const initialMutations = [
    mutation('exercise', exercise.id, exercise),
    mutation('answer', answer.id, answer),
    mutation('sense', sense.id, sense),
    mutation('session', session.id, session, { operation: 'upsert' }),
    mutation('item', item.id, item),
  ];
  const initialSync = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ mutations: initialMutations }),
  });
  check('子→親の逆順入力もトポロジカル整列して同期', initialSync.response.status === 200 && initialSync.data.acceptedMutationIds.length === 5 && initialSync.data.conflicts.length === 0, initialSync);
  check('同期応答をno-store', initialSync.response.headers.get('cache-control') === 'no-store', initialSync.response.headers.get('cache-control'));
  let cursor = initialSync.data.cursor;

  const parallelItem = { ...item, id: 'item-parallel-idempotent', label: 'parallel idempotent item' };
  const parallelMutation = mutation('item', parallelItem.id, parallelItem, {
    mutationId: 'mutation-item-parallel-idempotent',
  });
  const parallelResults = await Promise.all(Array.from({ length: 2 }, () => jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor, mutations: [parallelMutation] }),
  })));
  check(
    '同一mutationの並行再送をUNIQUE raceで500にせず冪等受理',
    parallelResults.every((result) => result.response.status === 200
      && result.data.acceptedMutationIds.includes(parallelMutation.mutationId)
      && result.data.conflicts.length === 0),
    parallelResults,
  );

  console.log('--- Memory API: attempt idempotency and separated stats ---');
  const attempt = {
    attemptId: 'attempt-1', sessionId: session.id, clientId, itemId: item.id, senseId: sense.id,
    answerId: answer.id, targetId: 'target-output', mode: 'output', exerciseType: 'typed_output',
    userAnswer: 'take A into account', normalizedAnswer: 'take a into account', assessment: 'correct',
    errorTypes: [], hintUsed: false, responseMs: 1100, createdAt: now,
  };
  const firstAttempt = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor, attempts: [attempt] }),
  });
  check('Attemptを受理', firstAttempt.response.status === 200 && firstAttempt.data.acceptedAttemptIds.includes(attempt.attemptId), firstAttempt);
  check(
    '並行mutationからsync changeを1revisionだけ生成',
    (firstAttempt.data.changes.items ?? []).filter((entry) => entry.id === parallelItem.id).length === 1,
    firstAttempt.data.changes.items,
  );
  const firstStats = firstAttempt.data.changes.stats ?? [];
  check(
    '通常OutputでSenseと実際のAnswerだけを集計',
    firstStats.some((stat) => stat.targetType === 'sense' && stat.targetId === sense.id && stat.attempts === 1)
      && firstStats.some((stat) => stat.targetType === 'answer' && stat.targetId === answer.id && stat.attempts === 1),
    firstStats,
  );
  cursor = firstAttempt.data.cursor;

  console.log('--- Memory API: manual weak preference sync ---');
  const outputSenseStat = firstStats.find((stat) => stat.targetType === 'sense' && stat.targetId === sense.id && stat.mode === 'output');
  check('Stat同期レコードがbaseRevision用revisionを含む', Number.isInteger(outputSenseStat?.revision) && outputSenseStat.revision >= 1, outputSenseStat);
  const weakPreference = mutation('stat_preference', `sense:${sense.id}:output`, {
    targetType: 'sense', targetId: sense.id, mode: 'output', manualWeak: true, updatedAt: later,
  }, {
    mutationId: 'mutation-stat-preference-weak', operation: 'upsert', baseRevision: outputSenseStat.revision, createdAt: later,
  });
  const weakResult = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor, mutations: [weakPreference] }),
  });
  const weakStat = (weakResult.data.changes.stats ?? []).find((stat) => stat.id === outputSenseStat.id && stat.manualWeak);
  check(
    'manualWeakを独立mutationで原子的に同期',
    weakResult.response.status === 200
      && weakResult.data.acceptedMutationIds.includes(weakPreference.mutationId)
      && weakStat?.revision === outputSenseStat.revision + 1
      && weakStat.weaknessScore > outputSenseStat.weaknessScore,
    weakResult,
  );
  cursor = weakResult.data.cursor;

  const staleWeakPreference = mutation('stat_preference', `sense:${sense.id}:output`, {
    targetType: 'sense', targetId: sense.id, mode: 'output', manualWeak: false,
    updatedAt: '2026-07-12T00:01:30.000Z',
  }, {
    mutationId: 'mutation-stat-preference-stale', operation: 'upsert', baseRevision: outputSenseStat.revision,
    createdAt: '2026-07-12T00:01:30.000Z',
  });
  const staleWeakResult = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor, mutations: [staleWeakPreference] }),
  });
  check(
    'manualWeakの古いbaseRevisionを上書きせずfull Statで競合化',
    staleWeakResult.response.status === 200
      && staleWeakResult.data.conflicts.length === 1
      && staleWeakResult.data.conflicts[0].serverValue.id === outputSenseStat.id
      && staleWeakResult.data.conflicts[0].serverValue.manualWeak === true
      && staleWeakResult.data.conflicts[0].serverValue.revision === weakStat.revision,
    staleWeakResult,
  );

  const repeatedAttempt = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor, attempts: [attempt] }),
  });
  check('同一Attempt再送を冪等に受理', repeatedAttempt.response.status === 200 && repeatedAttempt.data.acceptedAttemptIds.includes(attempt.attemptId), repeatedAttempt);
  check('同一Attempt再送で統計変更を二重生成しない', (repeatedAttempt.data.changes.stats ?? []).length === 0, repeatedAttempt.data.changes);
  cursor = repeatedAttempt.data.cursor;

  const changedAttempt = { ...attempt, assessment: 'incorrect', errorTypes: ['meaning'] };
  const conflictingAttempt = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor, attempts: [changedAttempt] }),
  });
  check('同じattemptIdを異なる内容で再利用すると409', conflictingAttempt.response.status === 409, conflictingAttempt);

  const exerciseAttempt = {
    ...attempt,
    attemptId: 'attempt-exercise',
    exerciseId: exercise.id,
    targetId: 'target-context-exercise',
    mode: 'context',
    exerciseType: 'fill_blank',
    createdAt: later,
  };
  const explicitExercise = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor, attempts: [exerciseAttempt] }),
  });
  const contextStats = (explicitExercise.data.changes.stats ?? []).filter((stat) => stat.mode === 'context');
  check(
    '指定ExerciseはAnswer/Exerciseのみ集計してSenseへ波及しない',
    explicitExercise.response.status === 200
      && contextStats.some((stat) => stat.targetType === 'answer' && stat.targetId === answer.id)
      && contextStats.some((stat) => stat.targetType === 'exercise' && stat.targetId === exercise.id)
      && !contextStats.some((stat) => stat.targetType === 'sense'),
    contextStats,
  );
  cursor = explicitExercise.data.cursor;

  console.log('--- Memory API: revision conflicts and mutation idempotency ---');
  const updatedItem = { ...item, label: 'take A fully into account', revision: 2, updatedAt: later };
  const updateMutation = mutation('item', item.id, updatedItem, {
    mutationId: 'mutation-item-update-v2', operation: 'update', baseRevision: 1, createdAt: later,
  });
  const update = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor, mutations: [updateMutation] }),
  });
  check('baseRevision一致更新を適用', update.response.status === 200 && update.data.conflicts.length === 0, update);
  cursor = update.data.cursor;

  const memorySet = {
    id: 'set-1', name: 'LEAP test', tags: ['LEAP'], createdAt: now, updatedAt: now, revision: 1,
  };
  const setMember = { setId: memorySet.id, itemId: item.id, order: 0, createdAt: now };
  const setCreation = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor, mutations: [
      mutation('set_member', `${memorySet.id}:${item.id}`, setMember, {
        mutationId: 'mutation-set-member-create', operation: 'upsert',
      }),
      mutation('set', memorySet.id, memorySet),
    ] }),
  });
  check(
    'Set/Memberも親子順に同期',
    setCreation.response.status === 200 && setCreation.data.conflicts.length === 0
      && setCreation.data.acceptedMutationIds.length === 2,
    setCreation,
  );
  cursor = setCreation.data.cursor;
  const deletedSet = { ...memorySet, revision: 2, updatedAt: later, deletedAt: later };
  const setDeletion = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor, mutations: [mutation('set', memorySet.id, deletedSet, {
      mutationId: 'mutation-set-delete', operation: 'delete', baseRevision: 1, createdAt: later,
    })] }),
  });
  check('Set削除はtombstoneとして同期', setDeletion.response.status === 200 && setDeletion.data.conflicts.length === 0, setDeletion);
  cursor = setDeletion.data.cursor;
  const deletedMember = { ...setMember, deletedAt: '2026-07-12T00:01:01.000Z' };
  const lateMemberDeletion = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor, mutations: [mutation('set_member', `${memorySet.id}:${item.id}`, deletedMember, {
      mutationId: 'mutation-set-member-delete-late', operation: 'upsert', createdAt: '2026-07-12T00:01:01.000Z',
    })] }),
  });
  check(
    '親Setが先にtombstone済みでも遅着Member tombstoneを拒否しない',
    lateMemberDeletion.response.status === 200 && lateMemberDeletion.data.conflicts.length === 0
      && lateMemberDeletion.data.acceptedMutationIds.includes('mutation-set-member-delete-late'),
    lateMemberDeletion,
  );
  cursor = lateMemberDeletion.data.cursor;

  const staleItem = { ...item, label: 'stale overwrite', revision: 2, updatedAt: later };
  const staleMutation = mutation('item', item.id, staleItem, {
    mutationId: 'mutation-item-stale', operation: 'update', baseRevision: 1, createdAt: later,
  });
  const leapfrogItem = { ...updatedItem, label: 'must not leapfrog conflict', revision: 3, updatedAt: '2026-07-12T00:02:00.000Z' };
  const leapfrogMutation = mutation('item', item.id, leapfrogItem, {
    mutationId: 'mutation-item-leapfrog', operation: 'update', baseRevision: 2, createdAt: '2026-07-12T00:02:00.000Z',
  });
  const stale = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor, mutations: [staleMutation, leapfrogMutation] }),
  });
  check(
    'baseRevision不一致を自動上書きせず競合化',
    stale.response.status === 200
      && stale.data.conflicts.length === 1
      && stale.data.conflicts[0].serverValue.label === updatedItem.label
      && stale.data.acceptedMutationIds.includes(staleMutation.mutationId)
      && !stale.data.acceptedMutationIds.includes(leapfrogMutation.mutationId)
      && !(stale.data.changes.items ?? []).some((entry) => entry.label === leapfrogItem.label),
    stale,
  );
  check('競合後の同一entity後続mutationを適用・受理しない', !stale.data.acceptedMutationIds.includes(leapfrogMutation.mutationId), stale);
  const firstConflictId = stale.data.conflicts[0]?.id;

  const repeatedStale = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor, mutations: [staleMutation] }),
  });
  check('同一競合mutation再送で競合レコードを二重化しない', repeatedStale.response.status === 200 && repeatedStale.data.conflicts[0]?.id === firstConflictId, repeatedStale);

  const dependentSense = {
    ...sense,
    id: 'sense-dependent-on-conflict',
    itemId: item.id,
    promptJa: '競合親に依存する意味',
    meaningJa: '競合親に依存する意味',
    revision: 1,
  };
  const dependentMutation = mutation('sense', dependentSense.id, dependentSense, {
    mutationId: 'mutation-sense-dependent-on-conflict',
  });
  const blockedDependent = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor, mutations: [dependentMutation, staleMutation] }),
  });
  check(
    '親mutation競合時は依存する子mutationも保留して誤適用しない',
    blockedDependent.response.status === 200
      && blockedDependent.data.conflicts[0]?.id === firstConflictId
      && !blockedDependent.data.acceptedMutationIds.includes(dependentMutation.mutationId)
      && !(blockedDependent.data.changes.senses ?? []).some((entry) => entry.id === dependentSense.id),
    blockedDependent,
  );

  const reusedMutation = clone(updateMutation);
  reusedMutation.payload.label = 'different payload';
  const conflictingMutationId = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor, mutations: [reusedMutation] }),
  });
  check('同じmutationIdを異なる内容で再利用すると409', conflictingMutationId.response.status === 409, conflictingMutationId);

  console.log('--- Memory API: safe undo and tenant isolation ---');
  const racingAttempt = {
    ...attempt,
    attemptId: 'attempt-racing-undo',
    createdAt: '2026-07-12T00:01:30.000Z',
  };
  const racingVoid = mutation('attempt_void', racingAttempt.attemptId, {
    attemptId: racingAttempt.attemptId,
    undoneAt: '2026-07-12T00:01:31.000Z',
  }, {
    mutationId: 'mutation-racing-attempt-void', operation: 'upsert', createdAt: '2026-07-12T00:01:31.000Z',
  });
  const racingUndoResult = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor, mutations: [racingVoid], attempts: [racingAttempt] }),
  });
  check(
    '初回Attemptと同時到着したvoidをappend後に安全適用',
    racingUndoResult.response.status === 200
      && racingUndoResult.data.acceptedAttemptIds.includes(racingAttempt.attemptId)
      && racingUndoResult.data.acceptedMutationIds.includes(racingVoid.mutationId)
      && (racingUndoResult.data.changes.attempts ?? []).some((entry) =>
        entry.attemptId === racingAttempt.attemptId && entry.undoneAt
      ),
    racingUndoResult,
  );

  const separatelyRacingAttempt = {
    ...attempt,
    attemptId: 'attempt-separate-racing-undo',
    createdAt: '2026-07-12T00:01:40.000Z',
  };
  const separatelyRacingVoid = mutation('attempt_void', separatelyRacingAttempt.attemptId, {
    attemptId: separatelyRacingAttempt.attemptId,
    undoneAt: '2026-07-12T00:01:41.000Z',
  }, {
    mutationId: 'mutation-separate-racing-attempt-void', operation: 'upsert', createdAt: '2026-07-12T00:01:41.000Z',
  });
  const earlyVoid = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor, mutations: [separatelyRacingVoid] }),
  });
  check(
    'Attemptより先着したvoidを誤競合・誤受理せず再送待ちにする',
    earlyVoid.response.status === 200
      && !earlyVoid.data.acceptedMutationIds.includes(separatelyRacingVoid.mutationId)
      && earlyVoid.data.conflicts.length === 0,
    earlyVoid,
  );
  const retriedVoid = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor, mutations: [separatelyRacingVoid], attempts: [separatelyRacingAttempt] }),
  });
  check(
    'Attempt到着後の同一void再送を適用',
    retriedVoid.response.status === 200
      && retriedVoid.data.acceptedAttemptIds.includes(separatelyRacingAttempt.attemptId)
      && retriedVoid.data.acceptedMutationIds.includes(separatelyRacingVoid.mutationId),
    retriedVoid,
  );

  const voidMutation = mutation('attempt_void', attempt.attemptId, {
    attemptId: attempt.attemptId,
    undoneAt: '2026-07-12T00:02:00.000Z',
  }, {
    mutationId: 'mutation-attempt-void', operation: 'upsert', createdAt: '2026-07-12T00:02:00.000Z',
  });
  const voidResult = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor, mutations: [voidMutation] }),
  });
  const voidStats = voidResult.data.changes.stats ?? [];
  check('同期済みAttempt取消をvoid mutationとして受理', voidResult.response.status === 200 && voidResult.data.acceptedMutationIds.includes(voidMutation.mutationId), voidResult);
  check(
    '取消後にAttemptログを消さず統計を再集計',
    (voidResult.data.changes.attempts ?? []).some((entry) => entry.attemptId === attempt.attemptId && entry.undoneAt)
      && voidStats.some((stat) => stat.targetType === 'sense' && stat.targetId === sense.id && stat.attempts === 0),
    voidResult.data.changes,
  );

  const secondUser = await register(`memoryiso${process.pid}`.slice(0, 20));
  const isolatedPull = await jsonRequest('/api/memory/sync', {
    cookie: secondUser.cookie,
    body: syncBody(),
  });
  check(
    '全読書きがuser_id分離され別ユーザーへ漏れない',
    isolatedPull.response.status === 200
      && Object.values(isolatedPull.data.changes).every((records) => records.length === 0),
    isolatedPull.data.changes,
  );

  const duplicateIds = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ attempts: [exerciseAttempt, exerciseAttempt] }),
  });
  check('同一リクエスト内の重複attemptIdを400で拒否', duplicateIds.response.status === 400, duplicateIds);

  const tooManyAttempts = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ attempts: Array.from({ length: 3 }, (_, index) => ({
      ...exerciseAttempt,
      attemptId: `attempt-over-query-budget-${index}`,
    })) }),
  });
  check('FreeプランのD1 query上限を越え得るAttempt batchを400で拒否', tooManyAttempts.response.status === 400, tooManyAttempts);

  const excessiveAcceptedAnswers = {
    ...exercise,
    id: 'exercise-too-many-answers',
    acceptedAnswerIds: Array.from({ length: 99 }, (_, index) => `answer-${index}`),
  };
  const excessiveAnswersResult = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ mutations: [mutation('exercise', excessiveAcceptedAnswers.id, excessiveAcceptedAnswers)] }),
  });
  check('D1 bind上限を越え得るacceptedAnswerIdsを検証段階で拒否', excessiveAnswersResult.response.status === 400, excessiveAnswersResult);

  const oversizedSession = {
    ...session,
    id: 'session-oversized-record',
    queueState: { chunks: Array.from({ length: 6 }, () => 'x'.repeat(50_000)) },
  };
  const oversizedRecordResult = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ mutations: [mutation('session', oversizedSession.id, oversizedSession, {
      mutationId: 'mutation-oversized-session', operation: 'upsert',
    })] }),
  });
  check('D1 row/Worker memoryを圧迫する巨大recordを413で拒否', oversizedRecordResult.response.status === 413, oversizedRecordResult);

  const missingTargetPreference = mutation('stat_preference', 'sense:not-owned:output', {
    targetType: 'sense', targetId: 'not-owned', mode: 'output', manualWeak: true, updatedAt: later,
  }, {
    mutationId: 'mutation-missing-target-preference', operation: 'upsert', baseRevision: 0, createdAt: later,
  });
  const missingTargetResult = await jsonRequest('/api/memory/sync', {
    cookie: secondUser.cookie,
    body: syncBody({ mutations: [missingTargetPreference] }),
  });
  check(
    '別ユーザーに存在する可能性があるtargetへStatを作らずnull競合化',
    missingTargetResult.response.status === 200
      && missingTargetResult.data.conflicts.length === 1
      && missingTargetResult.data.conflicts[0].serverValue === null,
    missingTargetResult,
  );

  console.log('--- Memory API: full-backup restore upsert semantics ---');
  const restoreUser = await register(`restoreapi${process.pid}`.slice(0, 20));
  check('空クラウド復元用ユーザーを登録', restoreUser.response.status === 201 && Boolean(restoreUser.cookie), restoreUser);
  if (!restoreUser.cookie) throw new Error('restore test user registration failed');

  const restoredItem = {
    ...item,
    id: 'restore-item',
    label: 'restored item',
    lemma: 'restored item',
    revision: 2,
    updatedAt: later,
  };
  const restoredSense = {
    ...sense,
    id: 'restore-sense',
    itemId: restoredItem.id,
    siblingGroupId: 'restore-siblings',
    revision: 2,
    updatedAt: later,
  };
  const restoredAnswer = {
    ...answer,
    id: 'restore-answer',
    senseId: restoredSense.id,
    displayForm: 'restored answer',
    citationForm: 'restored answer',
    revision: 2,
    updatedAt: later,
  };
  const restoreMutations = [
    mutation('answer', restoredAnswer.id, restoredAnswer, {
      mutationId: 'restore-upsert-answer', operation: 'upsert', baseRevision: 1, createdAt: later,
    }),
    mutation('sense', restoredSense.id, restoredSense, {
      mutationId: 'restore-upsert-sense', operation: 'upsert', baseRevision: 1, createdAt: later,
    }),
    mutation('item', restoredItem.id, restoredItem, {
      mutationId: 'restore-upsert-item', operation: 'upsert', baseRevision: 1, createdAt: later,
    }),
  ];
  const emptyCloudRestore = await jsonRequest('/api/memory/sync', {
    cookie: restoreUser.cookie,
    body: syncBody({ mutations: restoreMutations }),
  });
  check(
    '空クラウドへ復元したrevisioned entityをparent-first insertして競合にしない',
    emptyCloudRestore.response.status === 200
      && emptyCloudRestore.data.acceptedMutationIds.length === restoreMutations.length
      && emptyCloudRestore.data.conflicts.length === 0,
    emptyCloudRestore,
  );

  const restoredItemV3 = { ...restoredItem, label: 'restored item v3', revision: 3, updatedAt: '2026-07-12T00:02:00.000Z' };
  const equalRevisionRestore = await jsonRequest('/api/memory/sync', {
    cookie: restoreUser.cookie,
    body: syncBody({ mutations: [mutation('item', restoredItem.id, restoredItemV3, {
      mutationId: 'restore-upsert-item-v3', operation: 'upsert', baseRevision: 2,
      createdAt: '2026-07-12T00:02:00.000Z',
    })] }),
  });
  check(
    'クラウドがbackup観測revisionと一致すればupsert更新を適用',
    equalRevisionRestore.response.status === 200
      && equalRevisionRestore.data.acceptedMutationIds.includes('restore-upsert-item-v3')
      && equalRevisionRestore.data.conflicts.length === 0,
    equalRevisionRestore,
  );

  const staleRestore = await jsonRequest('/api/memory/sync', {
    cookie: restoreUser.cookie,
    body: syncBody({ mutations: [mutation('item', restoredItem.id, restoredItem, {
      mutationId: 'restore-upsert-item-stale', operation: 'upsert', baseRevision: 1,
      createdAt: '2026-07-12T00:03:00.000Z',
    })] }),
  });
  check(
    'クラウドがbackupより先へ進んだentityだけ明示競合にする',
    staleRestore.response.status === 200
      && staleRestore.data.conflicts.length === 1
      && staleRestore.data.conflicts[0].entityId === restoredItem.id,
    staleRestore,
  );

  const missingTombstone = {
    ...item,
    id: 'restore-missing-tombstone',
    label: 'already deleted',
    lemma: 'already deleted',
    revision: 2,
    updatedAt: later,
    deletedAt: later,
  };
  const tombstoneRestore = await jsonRequest('/api/memory/sync', {
    cookie: restoreUser.cookie,
    body: syncBody({ mutations: [mutation('item', missingTombstone.id, missingTombstone, {
      mutationId: 'restore-upsert-missing-tombstone', operation: 'upsert', baseRevision: 1, createdAt: later,
    })] }),
  });
  check(
    '空クラウドに存在しないtombstoneを適用済みとして大量競合にしない',
    tombstoneRestore.response.status === 200
      && tombstoneRestore.data.acceptedMutationIds.includes('restore-upsert-missing-tombstone')
      && tombstoneRestore.data.conflicts.length === 0,
    tombstoneRestore,
  );

  console.log('--- Memory API: cursor pagination ---');
  let drained = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor }),
  });
  while (drained.data.hasMore === true) {
    drained = await jsonRequest('/api/memory/sync', {
      cookie: firstUser.cookie,
      body: syncBody({ cursor: drained.data.cursor }),
    });
  }
  const cursorBeforeBulk = drained.data.cursor;
  const highCursor = String(Number.MAX_SAFE_INTEGER);
  for (let page = 0; page < 21; page += 1) {
    const bulkMutations = Array.from({ length: 5 }, (_, offset) => {
      const index = page * 5 + offset;
      const bulkSession = {
        ...session,
        id: `pagination-session-${index}`,
        initialTargetIds: [`pagination-target-${index}`],
        currentTargetId: `pagination-target-${index}`,
        seed: `pagination-seed-${index}`,
      };
      return mutation('session', bulkSession.id, bulkSession, {
        mutationId: `mutation-pagination-session-${index}`, operation: 'upsert',
      });
    });
    const seeded = await jsonRequest('/api/memory/sync', {
      cookie: firstUser.cookie,
      body: syncBody({ cursor: highCursor, mutations: bulkMutations }),
    });
    if (seeded.response.status !== 200 || seeded.data.acceptedMutationIds.length !== bulkMutations.length) {
      throw new Error(`pagination seed ${page} failed: ${JSON.stringify(seeded.data)}`);
    }
  }
  const firstPage = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor: cursorBeforeBulk }),
  });
  check(
    'pullを100件で区切りhasMoreと次cursorを返す',
    firstPage.response.status === 200
      && firstPage.data.hasMore === true
      && Object.values(firstPage.data.changes).reduce((total, records) => total + records.length, 0) === 100
      && BigInt(firstPage.data.cursor) > BigInt(cursorBeforeBulk),
    firstPage,
  );
  const secondPage = await jsonRequest('/api/memory/sync', {
    cookie: firstUser.cookie,
    body: syncBody({ cursor: firstPage.data.cursor }),
  });
  check(
    '次cursorから残件を欠損・重複なく取得',
    secondPage.response.status === 200
      && secondPage.data.hasMore !== true
      && Object.values(secondPage.data.changes).reduce((total, records) => total + records.length, 0) === 5
      && BigInt(secondPage.data.cursor) > BigInt(firstPage.data.cursor),
    secondPage,
  );
} catch (error) {
  failures += 1;
  console.error('  ❌ memory API integration crashed', error);
  if (serverOutput) console.error(serverOutput);
} finally {
  await stopServer();
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

console.log(failures === 0 ? '\n🎉 ALL PASS (memory API/D1)' : `\n💥 ${failures} FAILURES (memory API/D1)`);
process.exit(failures === 0 ? 0 : 1);
