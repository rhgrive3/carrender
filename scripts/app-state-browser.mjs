/** Browser integration tests for the normalized main AppState IndexedDB repository. */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const cwd = new URL('..', import.meta.url).pathname;
const externalBase = process.env.APP_STATE_TEST_BASE_URL;
const base = externalBase ?? 'http://127.0.0.1:4181/';
let server;
let serverOutput = '';
let browser;
let failures = 0;

function check(name, condition, detail) {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.error(`  ❌ ${name}`, detail ?? '');
  }
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Vite did not become ready at ${url}\n${serverOutput}`);
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
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
}

try {
  if (!externalBase) {
    server = spawn(
      'npm',
      ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4181', '--strictPort'],
      { cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const appendOutput = (chunk) => {
      serverOutput = `${serverOutput}${chunk.toString()}`.slice(-20_000);
    };
    server.stdout.on('data', appendOutput);
    server.stderr.on('data', appendOutput);
  }
  await waitForServer(base);

  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(async () => {
    const {
      AppStateIndexedDbRepository,
      MAIN_STATE_STORES,
      deleteMainStateDatabase,
      openMainStateDatabase,
    } = await import('/src/lib/appStateIndexedDb.ts');
    const { emptyState } = await import('/src/state/AppContext.tsx');

    const owner = `main-state-browser-${crypto.randomUUID()}`;
    const otherOwner = `${owner}-other`;
    await deleteMainStateDatabase(owner);
    await deleteMainStateDatabase(otherOwner);

    const repository = new AppStateIndexedDbRepository(owner);
    const now = '2026-07-14T00:00:00.000Z';
    const baseState = {
      ...emptyState(),
      // IndexedDBのgetAllは主キー順で返す。保存元の配列順が違っても移行検証を誤失敗させない。
      availability: [...emptyState().availability].reverse(),
      onboarded: true,
      goal: { id: 'goal-1', name: '医学部合格', examDate: '2027-02-01', createdAt: now },
      subjects: [{ id: 'subject-1', name: '化学', color: '#123456', importance: 5, weakness: 4 }],
      materials: [{
        id: 'material-1', subjectId: 'subject-1', name: '化学特講', unit: '講義', totalAmount: 20,
        doneAmount: 0, completedRanges: [], totalUnits: 20, startDate: '2026-07-14', targetDate: '2026-08-20',
        priority: 5, difficulty: 4, minutesPerUnit: 60, unitStep: 1, splittable: true,
        preferredCadence: { type: 'timesPerWeek', count: 4 }, dailyTarget: null, weeklyTarget: 4,
        deadlinePolicy: 'strict', examRelevance: 5, reviewEnabled: false, reviewIntervals: [1, 3, 7],
        paused: false, round: 1, archived: false, createdAt: now,
      }],
      tasks: [{
        id: 'task-1', subjectId: 'subject-1', materialId: 'material-1', title: '化学特講 第1講',
        rangeLabel: '第1講', rangeStart: 1, rangeEnd: 1, amount: 1, estimatedMinutes: 60, priority: 100,
        dueDate: '2026-08-20', type: 'new', status: 'planned', scheduledDate: '2026-07-15',
        scheduledStart: '18:00', scheduledEnd: '19:00', generatedBy: 'auto', reviewStage: null,
        createdAt: now, updatedAt: now, completedAt: null, sourceType: 'material', sourceId: 'material-1',
        placementStatus: 'scheduled', placementLock: 'none', materialRange: { start: 1, end: 1 },
      }],
    };

    await repository.migrateLegacyState(baseState);
    const restoredBase = await repository.loadState();
    const database = await openMainStateDatabase(owner);
    const storeNames = [...database.objectStoreNames];

    const session = {
      id: 'session-1', taskId: null, subjectId: 'subject-1', materialId: 'material-1', date: '2026-07-14',
      startedAt: now, minutes: 30, amountDone: 0, rangeLabel: '', focus: 4, memo: '', source: 'manual', updatedAt: now,
    };
    const withSession = { ...baseState, sessions: [session] };
    const appendStats = await repository.saveState(withSession, baseState);
    const restoredWithSession = await repository.loadState();

    const withoutTask = { ...withSession, tasks: [] };
    const deleteStats = await repository.saveState(withoutTask, withSession);
    const restoredWithoutTask = await repository.loadState();

    const syncMetadata = {
      owner: 'browser-user', dirty: true, baseUpdatedAt: '2026-07-14T00:00:00.000Z', localChangedAt: now,
    };
    await repository.saveSyncMetadata(syncMetadata);
    const restoredSyncMetadata = await repository.loadSyncMetadata();

    let rollbackRejected = false;
    const invalidState = {
      ...withoutTask,
      sessions: [...withoutTask.sessions, { ...session, id: undefined, memo: 'must rollback' }],
      lastPlanReason: 'must not commit',
    };
    try {
      await repository.saveState(invalidState, withoutTask);
    } catch {
      rollbackRejected = true;
    }
    const afterRollback = await repository.loadState();

    const otherRepository = new AppStateIndexedDbRepository(otherOwner);
    const otherBeforeWrite = await otherRepository.loadState();
    await otherRepository.migrateLegacyState({ ...baseState, goal: { ...baseState.goal, id: 'goal-other', name: '別アカウント' } });
    const originalAfterOtherWrite = await repository.loadState();

    await deleteMainStateDatabase(owner);
    await deleteMainStateDatabase(otherOwner);

    return {
      storeNames,
      restoredBase,
      appendStats,
      restoredWithSession,
      deleteStats,
      restoredWithoutTask,
      restoredSyncMetadata,
      rollbackRejected,
      afterRollback,
      otherBeforeWrite,
      originalAfterOtherWrite,
      expectedStoreNames: Object.values(MAIN_STATE_STORES),
    };
  });

  check('全エンティティstoreを作成する', result.expectedStoreNames.every((name) => result.storeNames.includes(name)), result.storeNames);
  check('旧AppStateを分割保存して復元する', result.restoredBase?.materials?.[0]?.name === '化学特講' && result.restoredBase?.tasks?.length === 1, result.restoredBase);
  check('1件の記録追加は全履歴を書き直さない', result.appendStats.puts === 2 && result.appendStats.deletes === 0, result.appendStats);
  check('追加した記録を復元する', result.restoredWithSession?.sessions?.length === 1, result.restoredWithSession?.sessions);
  check('削除をtombstone前段の差分DELETEとして反映する', result.deleteStats.deletes === 1 && result.restoredWithoutTask?.tasks?.length === 0, result.deleteStats);
  check('クラウド同期世代をアカウントDBへ保持する', result.restoredSyncMetadata?.dirty === true && result.restoredSyncMetadata?.owner === 'browser-user', result.restoredSyncMetadata);
  check('不正な関連書き込みはトランザクション全体をロールバックする', result.rollbackRejected && result.afterRollback?.lastPlanReason !== 'must not commit' && result.afterRollback?.sessions?.length === 1, result.afterRollback);
  check('別アカウントDBは初期状態で空', result.otherBeforeWrite === null, result.otherBeforeWrite);
  check('別アカウントの書き込みが元アカウントへ混ざらない', result.originalAfterOtherWrite?.goal?.name === '医学部合格', result.originalAfterOtherWrite?.goal);
} catch (error) {
  failures += 1;
  console.error(error);
  if (serverOutput) console.error(serverOutput);
} finally {
  await browser?.close();
  await stopServer();
}

console.log(failures === 0 ? '\n🎉 ALL PASS (main AppState IndexedDB)' : `\n💥 ${failures} FAILURES (main AppState IndexedDB)`);
process.exit(failures === 0 ? 0 : 1);
