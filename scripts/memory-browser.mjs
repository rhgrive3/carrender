/**
 * Browser integration test for the memory IndexedDB/repository layer.
 * Starts Vite itself unless MEMORY_TEST_BASE_URL points at an existing server.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const cwd = new URL('..', import.meta.url).pathname;
const externalBase = process.env.MEMORY_TEST_BASE_URL;
const base = externalBase ?? 'http://127.0.0.1:4179/';
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
      ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4179', '--strictPort'],
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
  const context = await browser.newContext({
    viewport: { width: 1133, height: 744 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const criticalRequests = [];
  let criticalPath = false;
  page.on('request', (request) => {
    // Noto Sans JP unicode ranges are discovered lazily when the app renders
    // previously unseen Japanese glyphs. They are shell assets, not learning
    // data/API traffic, and can start after networkidle depending on font cache.
    if (criticalPath && request.resourceType() !== 'font') {
      criticalRequests.push(`${request.method()} ${request.url()}`);
    }
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });

  // Warm every module before simulating a disconnected learning operation.
  await page.evaluate(async () => {
    await Promise.all([
      import('/src/features/memory/infrastructure/indexedDb.ts'),
      import('/src/features/memory/infrastructure/repositories.ts'),
      import('/src/features/memory/domain/importExport.ts'),
      import('/src/features/memory/application/selectedSetImport.ts'),
    ]);
  });
  // Font unicode-range requests can be discovered after DOMContentLoaded. They are
  // shell hydration, not answer-path traffic, so let the initial page settle before
  // starting the critical-path recorder.
  await page.waitForLoadState('networkidle');
  await context.setOffline(true);
  criticalPath = true;

  const result = await page.evaluate(async () => {
    const { deleteMemoryDatabase, MEMORY_STORES, migrateMemoryDatabaseOwner, openMemoryDatabase } = await import(
      '/src/features/memory/infrastructure/indexedDb.ts'
    );
    const { MemoryRepository } = await import('/src/features/memory/infrastructure/repositories.ts');
    const { createSelectedSetExport } = await import('/src/features/memory/domain/importExport.ts');
    const { importSelectedSetExport, previewSelectedSetImport } = await import(
      '/src/features/memory/application/selectedSetImport.ts'
    );
    const upgradeOwner = `browser-upgrade-${crypto.randomUUID()}`;
    const upgradeName = `studycommander-memory-v1:${upgradeOwner.normalize('NFKC')}`;
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(upgradeName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('memoryItems', { keyPath: 'id' });
        db.createObjectStore('memorySenses', { keyPath: 'id' });
        db.createObjectStore('memoryAnswers', { keyPath: 'id' });
        db.createObjectStore('memoryExamples', { keyPath: 'id' });
        db.createObjectStore('memoryExercises', { keyPath: 'id' });
        db.createObjectStore('memorySets', { keyPath: 'id' });
        db.createObjectStore('memorySetMembers', { keyPath: ['setId', 'itemId'] });
        db.createObjectStore('memoryStats', { keyPath: 'id' });
        db.createObjectStore('memoryAttempts', { keyPath: 'attemptId' }).put({
          attemptId: 'legacy-attempt', senseId: 'legacy-sense', answerId: 'legacy-answer', exerciseId: 'legacy-exercise',
        });
        db.createObjectStore('memorySessions', { keyPath: 'id' });
        db.createObjectStore('memoryPendingMutations', { keyPath: 'mutationId' }).put({
          mutationId: 'legacy-mutation', entityKey: 'item:legacy', createdAt: '2026-01-01T00:00:00.000Z',
        });
        db.createObjectStore('memoryConflicts', { keyPath: 'id' });
        db.createObjectStore('memoryMeta', { keyPath: 'key' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); resolve(); };
    });
    const upgraded = await openMemoryDatabase(upgradeOwner);
    const upgradeTransaction = upgraded.transaction(
      [MEMORY_STORES.attempts, MEMORY_STORES.sessions, MEMORY_STORES.pendingMutations, MEMORY_STORES.conflicts],
      'readonly',
    );
    const upgradedAttemptStore = upgradeTransaction.objectStore(MEMORY_STORES.attempts);
    const upgradedSessionStore = upgradeTransaction.objectStore(MEMORY_STORES.sessions);
    const upgradedPendingStore = upgradeTransaction.objectStore(MEMORY_STORES.pendingMutations);
    const upgradedConflictStore = upgradeTransaction.objectStore(MEMORY_STORES.conflicts);
    const upgradePreserved = await new Promise((resolve, reject) => {
      const request = upgradedAttemptStore.get('legacy-attempt');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(Boolean(request.result));
    });
    const upgradeIndexes = {
      sense: upgradedAttemptStore.indexNames.contains('senseId'),
      answer: upgradedAttemptStore.indexNames.contains('answerId'),
      exercise: upgradedAttemptStore.indexNames.contains('exerciseId'),
      attemptCreated: upgradedAttemptStore.indexNames.contains('createdAtId'),
      attemptSessionCreated: upgradedAttemptStore.indexNames.contains('sessionCreatedAtId'),
      attemptTargetCreated: upgradedAttemptStore.indexNames.contains('targetCreatedAtId'),
      sessionUpdated: upgradedSessionStore.indexNames.contains('updatedAtId'),
      activeSessionUpdated: upgradedSessionStore.indexNames.contains('statusUpdatedAtId'),
      conflictCreated: upgradedConflictStore.indexNames.contains('createdAtId'),
      sequence: upgradedPendingStore.indexNames.contains('localSequence'),
    };
    upgraded.close();
    await deleteMemoryDatabase(upgradeOwner);

    const owner = `browser-test-${crypto.randomUUID()}`;
    await deleteMemoryDatabase(owner);
    const repository = new MemoryRepository(owner);
    const now = '2026-07-12T00:00:00.000Z';
    const common = {
      source: 'user', verificationStatus: 'verified', createdAt: now, updatedAt: now, revision: 1,
    };
    const item = { ...common, id: 'item-shared', kind: 'expression', label: 'take A into account', tags: ['LEAP'] };
    const senseA = {
      ...common, id: 'sense-a', itemId: item.id, promptJa: '考慮する', meaningJa: '考慮する',
      siblingGroupId: 'sibling-item-shared', tags: [],
    };
    const senseB = {
      ...common, id: 'sense-b', itemId: item.id, promptJa: '配慮する', meaningJa: '配慮する',
      siblingGroupId: 'sibling-item-shared', tags: [],
    };
    const answerA = {
      ...common, id: 'answer-a', senseId: senseA.id, displayForm: 'take A into account',
      citationForm: 'take A into account', acceptedVariants: [], orthographicVariants: [],
    };
    const answerB = {
      ...common, id: 'answer-b', senseId: senseA.id, displayForm: 'allow for A',
      citationForm: 'allow for A', acceptedVariants: [], orthographicVariants: [],
    };
    const setA = { id: 'set-a', name: 'LEAP', tags: [], createdAt: now, updatedAt: now, revision: 1 };
    const setB = { id: 'set-b', name: '英作文', tags: [], createdAt: now, updatedAt: now, revision: 1 };
    const members = [
      { setId: setA.id, itemId: item.id, order: 0, createdAt: now },
      { setId: setB.id, itemId: item.id, order: 0, createdAt: now },
    ];

    const database = await openMemoryDatabase(owner);
    const storeNames = [...database.objectStoreNames];
    const clientId = await repository.clientId();
    const clientIdAgain = await repository.clientId();
    await repository.createSet(setA);
    await repository.createSet(setB);
    await repository.saveContentBundle({
      items: [item], senses: [senseA, senseB], answers: [answerA, answerB], examples: [], exercises: [],
    }, members);
    const selected = await repository.loadSetBundle([setA.id, setB.id]);
    const pendingAfterEdit = await repository.pendingMutations(100);
    const pendingTypes = pendingAfterEdit.map((mutation) => mutation.entityType);
    const stableMutationSequence = pendingAfterEdit.every((mutation) => Number.isSafeInteger(mutation.localSequence))
      && new Set(pendingAfterEdit.map((mutation) => mutation.localSequence)).size === pendingAfterEdit.length;
    const parentBeforeChildren = pendingTypes.indexOf('item') < pendingTypes.indexOf('sense')
      && pendingTypes.indexOf('sense') < pendingTypes.indexOf('answer')
      && pendingTypes.indexOf('item') < pendingTypes.indexOf('set_member');

    const emptyStat = {
      id: 'sense:sense-a:output', targetType: 'sense', targetId: senseA.id, mode: 'output', attempts: 0,
      correctCount: 0, partialCount: 0, incorrectCount: 0, skippedCount: 0, consecutiveCorrect: 0,
      consecutiveIncorrect: 0, averageResponseMs: 0, hintCount: 0, manualWeak: false, weaknessScore: 0,
      updatedAt: now,
    };
    const answeredStat = {
      ...emptyStat, attempts: 1, incorrectCount: 1, consecutiveIncorrect: 1, weaknessScore: 70,
      lastAttemptAt: now,
    };
    const baseSession = {
      id: 'session-1', status: 'active', selectedSetIds: [setA.id, setB.id], initialTargetIds: ['target-a'],
      config: { questionCount: { type: 'count', count: 1 }, direction: 'output', includeUnverifiedAi: false },
      seed: 'browser-seed', currentTargetId: 'target-a', queueState: { position: 1 }, completedTargetIds: [],
      needsReviewTargetIds: [], answerCount: 1, createdAt: now, updatedAt: now,
    };
    const attempt = {
      attemptId: 'attempt-1', sessionId: baseSession.id, clientId, itemId: item.id, senseId: senseA.id,
      targetId: 'target-a', mode: 'output', exerciseType: 'flashcard', userAnswer: '', normalizedAnswer: '',
      assessment: 'incorrect', errorTypes: ['recall'], hintUsed: false, responseMs: 900, createdAt: now,
    };

    await repository.saveAttempt(attempt, [answeredStat], baseSession);
    await repository.saveAttempt(attempt, [answeredStat], baseSession);
    const attemptCountAfterDuplicate = await repository.store.count(MEMORY_STORES.attempts);
    let attemptOverwriteRejected = false;
    try {
      await repository.saveAttempt(
        { ...attempt, assessment: 'correct', errorTypes: [] },
        [{ ...answeredStat, correctCount: 1, incorrectCount: 0 }],
        baseSession,
      );
    } catch {
      attemptOverwriteRejected = true;
    }
    const attemptAfterOverwrite = await repository.store.get(MEMORY_STORES.attempts, attempt.attemptId);
    const activeSessionBeforeUndo = await repository.getActiveSession();
    const restoredSession = { ...baseSession, answerCount: 0, queueState: { position: 0 } };
    const concurrentUndo = await Promise.allSettled([
      repository.undoAttempt(attempt.attemptId, [emptyStat], restoredSession),
      repository.undoAttempt(attempt.attemptId, [emptyStat], restoredSession),
    ]);
    const unsyncedAttemptAfterUndo = await repository.store.get(MEMORY_STORES.attempts, attempt.attemptId);
    const restoredStat = await repository.store.get(MEMORY_STORES.stats, emptyStat.id);
    const sessionAfterUndo = await repository.getSession(baseSession.id);
    const pendingAfterUnsyncedUndo = await repository.pendingMutations(100);
    const concurrentUndoSingle = concurrentUndo.filter((entry) => entry.status === 'fulfilled').length === 1
      && pendingAfterUnsyncedUndo.filter((mutation) =>
        mutation.entityType === 'attempt_void' && mutation.entityId === attempt.attemptId
      ).length === 1;

    // Emulate an attempt upload whose response arrives after the local undo.
    await repository.commitSyncResponse({
      serverTime: '2026-07-12T00:00:01.000Z',
      cursor: '1',
      acceptedMutationIds: [],
      acceptedAttemptIds: [attempt.attemptId],
      sentAttemptIds: [attempt.attemptId],
      conflicts: [],
      changes: {
        attempts: [{ ...attempt, syncedAt: '2026-07-12T00:00:01.000Z' }],
        stats: [{ ...answeredStat, updatedAt: '2026-07-12T00:00:01.000Z' }],
      },
    });
    const racedUndoAttempt = await repository.store.get(MEMORY_STORES.attempts, attempt.attemptId);
    const racedUndoStat = await repository.store.get(MEMORY_STORES.stats, emptyStat.id);

    const syncedAttempt = { ...attempt, attemptId: 'attempt-synced', syncedAt: now };
    await repository.saveAttempt(syncedAttempt, [answeredStat], baseSession);
    await repository.undoAttempt(syncedAttempt.attemptId, [emptyStat], restoredSession);
    const rawSyncedAttempt = await repository.store.get(MEMORY_STORES.attempts, syncedAttempt.attemptId);
    const visibleAttemptsAfterSyncedUndo = await repository.getSessionAttempts(baseSession.id);
    const pendingAfterSyncedUndo = await repository.pendingMutations(100);
    const remoteProtected = { ...item, id: 'remote-protected', label: 'local revision 3', revision: 3 };
    await repository.store.put(MEMORY_STORES.items, remoteProtected);
    await repository.applyRemoteChanges({
      items: [{ ...remoteProtected, label: 'stale remote revision 2', revision: 2 }],
    });
    const protectedAfterRemote = await repository.store.get(MEMORY_STORES.items, remoteProtected.id);

    const manualWeakStat = await repository.setManualWeak('sense', senseA.id, 'output', true);
    const manualWeakPending = (await repository.pendingMutations(200)).find((mutation) =>
      mutation.entityType === 'stat_preference' && mutation.entityId === emptyStat.id
    );
    await repository.applyRemoteChanges({
      stats: [{ ...manualWeakStat, manualWeak: false, weaknessScore: 0, revision: 99, updatedAt: '2026-07-12T00:10:00.000Z' }],
    });
    const manualWeakAfterPull = await repository.store.get(MEMORY_STORES.stats, emptyStat.id);
    const manualWeakAtomicAndProtected = manualWeakStat.manualWeak
      && manualWeakPending?.baseRevision === 0
      && manualWeakPending?.payload?.manualWeak === true
      && !Object.hasOwn(manualWeakPending?.payload ?? {}, 'revision')
      && manualWeakAfterPull?.manualWeak === true;

    let scannedAllStats = false;
    const originalGetAll = repository.store.getAll.bind(repository.store);
    repository.store.getAll = async (...args) => {
      if (args[0] === MEMORY_STORES.stats) scannedAllStats = true;
      return originalGetAll(...args);
    };
    const targetedStats = await repository.getStats(new Set([senseA.id]));
    repository.store.getAll = originalGetAll;
    const targetedStatsUseIndex = !scannedAllStats && targetedStats.some((stat) => stat.targetId === senseA.id);

    const dependencyItem = { ...item, id: 'dependency-item', label: 'dependency parent' };
    const dependencySense = { ...senseA, id: 'dependency-sense', itemId: dependencyItem.id };
    const dependencyAnswer = { ...answerA, id: 'dependency-answer', senseId: dependencySense.id };
    await repository.saveContentBundle({
      items: [dependencyItem], senses: [dependencySense], answers: [dependencyAnswer], examples: [], exercises: [],
    });
    await repository.addConflicts([{
      id: 'dependency-parent-conflict',
      entityType: 'item',
      entityId: dependencyItem.id,
      entityKey: `item:${dependencyItem.id}`,
      localValue: dependencyItem,
      serverValue: { ...dependencyItem, label: 'server dependency parent' },
      baseRevision: 0,
      createdAt: now,
    }]);
    const dependencyAttempt = {
      ...attempt,
      attemptId: 'dependency-attempt',
      itemId: dependencyItem.id,
      senseId: dependencySense.id,
      answerId: dependencyAnswer.id,
      targetId: 'dependency-target',
    };
    await repository.saveAttempt(
      dependencyAttempt,
      [{ ...answeredStat, id: 'answer:dependency-answer:output', targetType: 'answer', targetId: dependencyAnswer.id }],
      baseSession,
    );
    const dependencyAttemptBlocked = !(await repository.unsyncedAttempts(500)).some((entry) =>
      entry.attemptId === dependencyAttempt.attemptId
    );
    const dependencyBlockedCandidates = await repository.syncablePendingMutations(500);
    const dependencyChildrenBlocked = !dependencyBlockedCandidates.some((mutation) =>
      mutation.entityId === dependencySense.id || mutation.entityId === dependencyAnswer.id
    );
    await repository.resolveConflictWithLocal('dependency-parent-conflict');
    const dependencyResumed = await repository.syncablePendingMutations(500);
    const dependencyAttemptResumed = (await repository.unsyncedAttempts(500)).some((entry) =>
      entry.attemptId === dependencyAttempt.attemptId
    );
    const resumedTypes = dependencyResumed
      .filter((mutation) => [dependencyItem.id, dependencySense.id, dependencyAnswer.id].includes(mutation.entityId))
      .map((mutation) => mutation.entityType);
    const dependencyResumesParentFirst = resumedTypes.indexOf('item') >= 0
      && resumedTypes.indexOf('item') < resumedTypes.indexOf('sense')
      && resumedTypes.indexOf('sense') < resumedTypes.indexOf('answer');

    const deleteItem = { ...item, id: 'delete-dependency-item', label: 'delete parent' };
    const deleteSense = { ...senseA, id: 'delete-dependency-sense', itemId: deleteItem.id };
    const deleteAnswer = { ...answerA, id: 'delete-dependency-answer', senseId: deleteSense.id };
    await repository.saveContentBundle({
      items: [deleteItem], senses: [deleteSense], answers: [deleteAnswer], examples: [], exercises: [],
    });
    await repository.tombstone('answer', deleteAnswer.id);
    await repository.tombstone('sense', deleteSense.id);
    await repository.tombstone('item', deleteItem.id);
    await repository.addConflicts([{
      id: 'dependency-child-delete-conflict',
      entityType: 'answer',
      entityId: deleteAnswer.id,
      entityKey: `answer:${deleteAnswer.id}`,
      localValue: { ...deleteAnswer, deletedAt: now, revision: 2 },
      serverValue: deleteAnswer,
      baseRevision: 1,
      createdAt: now,
    }]);
    const deleteCandidates = await repository.syncablePendingMutations(500);
    const deleteDependencyBlocked = !deleteCandidates.some((mutation) =>
      mutation.operation === 'delete'
      && (mutation.entityId === deleteSense.id || mutation.entityId === deleteItem.id)
    );

    const conflictItem = { ...item, id: 'conflict-item', label: 'local conflict item' };
    await repository.saveContentBundle({ items: [conflictItem], senses: [], answers: [], examples: [], exercises: [] });
    const conflictMutation = (await repository.pendingMutations(200)).find((mutation) => mutation.entityId === conflictItem.id);
    const cursorBeforeFailedCommit = await repository.syncCursor();
    let failedCommitRolledBack = false;
    if (conflictMutation) {
      try {
        await repository.commitSyncResponse({
          serverTime: now,
          cursor: '99',
          acceptedMutationIds: [conflictMutation.mutationId],
          acceptedAttemptIds: [],
          sentAttemptIds: [],
          conflicts: [{
            entityType: 'item', entityId: conflictItem.id, entityKey: `item:${conflictItem.id}`,
            localValue: conflictItem, serverValue: { ...conflictItem, label: 'server item' }, createdAt: now,
          }],
          changes: {},
        });
      } catch {
        const stillPending = (await repository.pendingMutations(200)).some((mutation) =>
          mutation.mutationId === conflictMutation.mutationId
        );
        failedCommitRolledBack = stillPending && (await repository.syncCursor()) === cursorBeforeFailedCommit;
      }
      const conflict = {
        id: 'conflict-local-commit', mutationId: conflictMutation.mutationId, entityType: 'item',
        entityId: conflictItem.id, entityKey: `item:${conflictItem.id}`, localValue: conflictItem,
        serverValue: { ...conflictItem, label: 'server item' }, createdAt: now,
      };
      await repository.commitSyncResponse({
        serverTime: now,
        cursor: '2',
        acceptedMutationIds: [conflictMutation.mutationId],
        acceptedAttemptIds: [],
        sentAttemptIds: [],
        conflicts: [conflict],
        changes: { items: [conflict.serverValue] },
      });
      await repository.saveContentBundle({
        items: [{ ...conflictItem, label: 'later local edit', revision: 2, updatedAt: '2026-07-12T00:00:02.000Z' }],
        senses: [], answers: [], examples: [], exercises: [],
      });
    }
    const conflictStored = (await repository.listConflicts()).some((conflict) => conflict.id === 'conflict-local-commit');
    const conflictLocalPreserved = (await repository.store.get(MEMORY_STORES.items, conflictItem.id))?.label === 'later local edit';
    const conflictEntityBlocked = !(await repository.syncablePendingMutations(200)).some((mutation) =>
      mutation.entityId === conflictItem.id
    );
    await repository.resolveConflictWithLocal('conflict-local-commit');
    const rebasedConflictMutation = (await repository.syncablePendingMutations(200)).find((mutation) =>
      mutation.entityId === conflictItem.id
    );
    const localConflictRebased = rebasedConflictMutation?.baseRevision === 1
      && rebasedConflictMutation?.operation === 'update'
      && rebasedConflictMutation?.payload?.revision === 2;

    const answerLatencies = [];
    for (let index = 0; index < 40; index += 1) {
      const started = performance.now();
      await repository.saveAttempt(
        { ...attempt, attemptId: `attempt-perf-${index}`, createdAt: new Date(Date.parse(now) + index + 1).toISOString() },
        [{ ...answeredStat, attempts: index + 1, incorrectCount: index + 1 }],
        { ...baseSession, answerCount: index + 1, updatedAt: new Date(Date.parse(now) + index + 1).toISOString() },
      );
      answerLatencies.push(performance.now() - started);
    }
    const sortedAnswerLatencies = [...answerLatencies].sort((left, right) => left - right);
    const answerP95Ms = sortedAnswerLatencies[Math.ceil(sortedAnswerLatencies.length * 0.95) - 1];
    const senseHistory = await repository.getStatTargetAttempts('sense', senseA.id, 10);

    const inputHistoryAttempt = {
      ...attempt,
      attemptId: 'attempt-history-input',
      mode: 'input',
      assessment: 'correct',
      errorTypes: [],
      createdAt: '2026-07-12T00:02:00.000Z',
    };
    const inputHistoryStat = {
      ...emptyStat,
      id: 'sense:sense-a:input',
      mode: 'input',
      attempts: 1,
      correctCount: 1,
      consecutiveCorrect: 1,
      lastAttemptAt: inputHistoryAttempt.createdAt,
      updatedAt: inputHistoryAttempt.createdAt,
    };
    await repository.saveAttempt(inputHistoryAttempt, [inputHistoryStat], baseSession);
    const inputSenseHistory = await repository.getStatTargetAttempts('sense', senseA.id, 'input', 100);
    const outputSenseHistory = await repository.getStatTargetAttempts('sense', senseA.id, 'output', 100);
    const statHistoryModeFiltered = inputSenseHistory.length === 1
      && inputSenseHistory.every((entry) => entry.mode === 'input')
      && outputSenseHistory.length > 0
      && outputSenseHistory.every((entry) => entry.mode === 'output');

    const staleActiveSession = {
      ...baseSession,
      id: 'session-stale-active',
      seed: 'browser-stale-seed',
      createdAt: '2026-07-12T00:02:01.000Z',
      updatedAt: '2026-07-12T00:02:01.000Z',
    };
    await repository.saveSession(staleActiveSession, false);
    const replacementSession = {
      ...baseSession,
      id: 'session-replacement',
      seed: 'browser-replacement-seed',
      answerCount: 0,
      queueState: { position: 0 },
      createdAt: '2026-07-12T00:02:02.000Z',
      updatedAt: '2026-07-12T00:02:02.000Z',
    };
    await repository.startSession(replacementSession);
    const sessionsAfterStart = await repository.listSessions(100);
    const sessionMutationsAfterStart = (await repository.pendingMutations(500)).filter((mutation) =>
      mutation.entityType === 'session'
      && [baseSession.id, staleActiveSession.id, replacementSession.id].includes(mutation.entityId)
    );
    const activeSessionsAfterStart = sessionsAfterStart.filter((session) => session.status === 'active');
    const startSessionAbandonsPrevious = activeSessionsAfterStart.length === 1
      && activeSessionsAfterStart[0].id === replacementSession.id
      && sessionsAfterStart.find((session) => session.id === baseSession.id)?.status === 'abandoned'
      && sessionsAfterStart.find((session) => session.id === staleActiveSession.id)?.status === 'abandoned'
      && sessionMutationsAfterStart.length === 3
      && sessionMutationsAfterStart.every((mutation) => {
        const expectedStatus = mutation.entityId === replacementSession.id ? 'active' : 'abandoned';
        return mutation.payload?.status === expectedStatus;
      });

    await repository.tombstone('set', setA.id);
    const setsAfterDelete = await repository.listSets();
    const contentAfterSetDelete = await repository.loadContent();
    const fullBackupExport = await repository.exportAll();
    const fullBackupKeepsTombstonesAndVoids = fullBackupExport.snapshot.items.some((entry) =>
      entry.id === deleteItem.id && typeof entry.deletedAt === 'string'
    ) && fullBackupExport.snapshot.sets.some((entry) =>
      entry.id === setA.id && typeof entry.deletedAt === 'string'
    ) && fullBackupExport.attempts.some((entry) =>
      entry.attemptId === attempt.attemptId && typeof entry.undoneAt === 'string'
    );

    let transactionRejected = false;
    try {
      await repository.store.write([
        { store: MEMORY_STORES.items, type: 'put', value: { ...item, id: 'rollback-marker' } },
        { store: MEMORY_STORES.senses, type: 'put', value: { itemId: item.id } },
      ]);
    } catch {
      transactionRejected = true;
    }
    // Let IndexedDB deliver the abort event before the verification read.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const rollbackMarker = await repository.store.get(MEMORY_STORES.items, 'rollback-marker');

    const legacyOwner = `legacy-owner-${crypto.randomUUID()}`;
    const userIdOwner = `user-id-${crypto.randomUUID()}`;
    const legacyRepository = new MemoryRepository(legacyOwner);
    const targetRepository = new MemoryRepository(userIdOwner);
    const migratedItem = { ...item, id: 'migrated-item', label: 'legacy username data' };
    const sharedLegacyItem = { ...item, id: 'migration-shared', label: 'older legacy value' };
    const sharedTargetItem = {
      ...sharedLegacyItem,
      label: 'newer target value',
      revision: 2,
      updatedAt: '2026-07-12T00:01:00.000Z',
    };
    await legacyRepository.saveContentBundle({
      items: [migratedItem, sharedLegacyItem], senses: [], answers: [], examples: [], exercises: [],
    });
    await targetRepository.saveContentBundle({
      items: [sharedTargetItem], senses: [], answers: [], examples: [], exercises: [],
    });
    await migrateMemoryDatabaseOwner(legacyOwner, userIdOwner);
    const migratedRepository = new MemoryRepository(userIdOwner);
    const migratedContent = await migratedRepository.loadContent();
    const migratedPending = await migratedRepository.pendingMutations(20);
    const ownerMigrationPreserved = migratedContent.items.some((entry) => entry.id === migratedItem.id)
      && migratedContent.items.some((entry) => entry.id === sharedTargetItem.id && entry.label === sharedTargetItem.label)
      && migratedPending.some((mutation) => mutation.entityId === migratedItem.id)
      && new Set(migratedPending.map((mutation) => mutation.clientId)).size === 2
      && migratedPending.every((mutation) => Number.isSafeInteger(mutation.localSequence))
      && new Set(migratedPending.map((mutation) => mutation.localSequence)).size === migratedPending.length;
    targetRepository.close();
    migratedRepository.close();
    await deleteMemoryDatabase(userIdOwner);

    const backupOwner = `backup-owner-${crypto.randomUUID()}`;
    const backupRepository = new MemoryRepository(backupOwner);
    await backupRepository.store.put(MEMORY_STORES.items, { ...item, id: 'must-be-cleared' });
    await backupRepository.replaceFromBackup({
      snapshot: {
        items: [item], senses: [senseA], answers: [answerA], examples: [], exercises: [],
        sets: [setA], setMembers: [members[0]], stats: [emptyStat],
      },
      attempts: [{ ...attempt, syncedAt: now, undoneAt: '2026-07-12T00:03:00.000Z' }],
      sessions: [baseSession],
    });
    const [backupContent, backupAttempt, backupPending, backupCursor, clearedMarker] = await Promise.all([
      backupRepository.loadContent(),
      backupRepository.store.get(MEMORY_STORES.attempts, attempt.attemptId),
      backupRepository.pendingMutations(100),
      backupRepository.syncCursor(),
      backupRepository.store.get(MEMORY_STORES.items, 'must-be-cleared'),
    ]);
    const backupRestoreReadyToSync = backupContent.items.some((entry) => entry.id === item.id)
      && clearedMarker === undefined
      && backupAttempt?.syncedAt === undefined
      && backupAttempt?.undoneAt
      && backupCursor === '0'
      && backupPending.some((mutation) =>
        mutation.entityType === 'item'
        && mutation.baseRevision === item.revision
        && mutation.payload?.revision === item.revision + 1
      )
      && backupPending.some((mutation) => mutation.entityType === 'session')
      && backupPending.some((mutation) => mutation.entityType === 'stat_preference')
      && backupPending.some((mutation) => mutation.entityType === 'attempt_void');
    await backupRepository.applyRemoteChanges({
      items: [{ ...item, label: 'remote must not replace pending restore', revision: 99 }],
      stats: [{ ...emptyStat, manualWeak: true, revision: 99, updatedAt: '2026-07-12T00:05:00.000Z' }],
    });
    const [backupProtectedContent, backupProtectedStat] = await Promise.all([
      backupRepository.loadContent(),
      backupRepository.store.get(MEMORY_STORES.stats, emptyStat.id),
    ]);
    const backupProtectedFromPull = backupProtectedContent.items.some((entry) =>
      entry.id === item.id && entry.label === item.label
    ) && backupProtectedStat?.manualWeak === false;
    let failedBackupRolledBack = false;
    try {
      await backupRepository.replaceFromBackup({
        snapshot: {
          items: [{ ...item, id: 'replacement-that-must-rollback' }], senses: [], answers: [], examples: [], exercises: [],
          sets: [], setMembers: [],
          stats: [{ ...emptyStat, id: 'duplicate-stat-a' }, { ...emptyStat, id: 'duplicate-stat-b' }],
        },
        attempts: [],
        sessions: [],
      });
    } catch {
      const afterFailure = await backupRepository.loadContent();
      const pendingAfterFailure = await backupRepository.pendingMutations(100);
      failedBackupRolledBack = afterFailure.items.some((entry) => entry.id === item.id)
        && !afterFailure.items.some((entry) => entry.id === 'replacement-that-must-rollback')
        && pendingAfterFailure.length === backupPending.length;
    }
    backupRepository.close();
    await deleteMemoryDatabase(backupOwner);

    const selectedImportOwner = `selected-import-${crypto.randomUUID()}`;
    const selectedImportRepository = new MemoryRepository(selectedImportOwner);
    const selectedSourceContent = {
      items: [{ ...item, revision: 4 }],
      senses: [{ ...senseA, revision: 4 }],
      answers: [{ ...answerA, revision: 4 }],
      examples: [],
      exercises: [],
    };
    const selectedSourceSet = { ...setA, revision: 4 };
    const selectedSourceMember = { ...members[0] };
    const selectedDocument = createSelectedSetExport({
      sets: [selectedSourceSet],
      setMembers: [selectedSourceMember],
      content: selectedSourceContent,
      selectedSetIds: [selectedSourceSet.id],
      exportId: 'browser-selected-export',
      exportedAt: now,
      includeStats: true,
      stats: [emptyStat],
    });
    const firstSelectedImport = await importSelectedSetExport({
      repository: selectedImportRepository,
      document: selectedDocument,
    });
    const selectedAfterFirst = await selectedImportRepository.exportAll();
    const selectedPendingAfterFirst = await selectedImportRepository.pendingMutations(100);
    const repeatedSelectedImport = await importSelectedSetExport({
      repository: selectedImportRepository,
      document: selectedDocument,
    });
    const selectedPendingAfterRepeat = await selectedImportRepository.pendingMutations(100);
    const selectedRoundTripDefault = firstSelectedImport.imported === 5
      && firstSelectedImport.importedStats === 0
      && selectedAfterFirst.snapshot.items.some((entry) => entry.id === item.id && entry.revision === 1)
      && selectedAfterFirst.snapshot.sets.some((entry) => entry.id === setA.id && entry.revision === 1)
      && selectedAfterFirst.snapshot.stats.length === 0
      && selectedPendingAfterFirst.length === 5
      && repeatedSelectedImport.imported === 0
      && repeatedSelectedImport.skippedIdentical === 5
      && selectedPendingAfterRepeat.length === selectedPendingAfterFirst.length;

    const conflictingSelectedDocument = {
      ...selectedDocument,
      items: selectedDocument.items.map((entry) => ({ ...entry, label: 'conflicting imported label' })),
    };
    const selectedConflictPreview = previewSelectedSetImport(conflictingSelectedDocument, selectedAfterFirst.snapshot);
    let selectedConflictRejected = false;
    try {
      await importSelectedSetExport({
        repository: selectedImportRepository,
        document: conflictingSelectedDocument,
      });
    } catch {
      selectedConflictRejected = true;
    }
    const selectedAfterConflict = await selectedImportRepository.exportAll();
    const selectedPendingAfterConflict = await selectedImportRepository.pendingMutations(100);
    const selectedConflictProtectsLocal = selectedConflictPreview.conflicts.some((entry) => entry.entityId === item.id)
      && selectedConflictRejected
      && selectedAfterConflict.snapshot.items.some((entry) => entry.id === item.id && entry.label === item.label)
      && selectedPendingAfterConflict.length === selectedPendingAfterFirst.length;

    const selectedStatsImport = await importSelectedSetExport({
      repository: selectedImportRepository,
      document: selectedDocument,
      includeStats: true,
    });
    const selectedAfterStats = await selectedImportRepository.exportAll();
    const selectedPendingAfterStats = await selectedImportRepository.pendingMutations(100);
    const selectedStatsRequireConfirmation = selectedStatsImport.imported === 0
      && selectedStatsImport.importedStats === 1
      && selectedAfterStats.snapshot.stats.some((entry) => entry.id === emptyStat.id)
      && selectedPendingAfterStats.length === selectedPendingAfterFirst.length;
    selectedImportRepository.close();
    await deleteMemoryDatabase(selectedImportOwner);

    const output = {
      storeNames,
      upgradePreserved,
      upgradeIndexes,
      stableClientId: clientId === clientIdAgain,
      selected: {
        sets: selected.sets.length,
        members: selected.setMembers.length,
        items: selected.items.length,
        senses: selected.senses.length,
        answers: selected.answers.length,
      },
      pendingAfterEdit: pendingAfterEdit.length,
      stableMutationSequence,
      parentBeforeChildren,
      attemptCountAfterDuplicate,
      attemptOverwriteRejected: attemptOverwriteRejected && attemptAfterOverwrite?.assessment === 'incorrect',
      concurrentUndoSingle,
      activeSessionAnswerCount: activeSessionBeforeUndo?.answerCount,
      unsyncedAttemptKeptAsVoid: typeof unsyncedAttemptAfterUndo?.undoneAt === 'string'
        && pendingAfterUnsyncedUndo.some((mutation) =>
          mutation.entityType === 'attempt_void' && mutation.entityId === attempt.attemptId
        ),
      restoredStatAttempts: restoredStat?.attempts,
      restoredSessionAnswerCount: sessionAfterUndo?.answerCount,
      racedUndoPreserved: typeof racedUndoAttempt?.undoneAt === 'string' && typeof racedUndoAttempt?.syncedAt === 'string',
      racedUndoStatAttempts: racedUndoStat?.attempts,
      syncedUndoKeptVoid: typeof rawSyncedAttempt?.undoneAt === 'string',
      visibleAttemptsAfterSyncedUndo: visibleAttemptsAfterSyncedUndo.length,
      queuedAttemptVoid: pendingAfterSyncedUndo.some((mutation) =>
        mutation.entityType === 'attempt_void' && mutation.entityId === syncedAttempt.attemptId
      ),
      senseHistoryCount: senseHistory.length,
      statHistoryModeFiltered,
      startSessionAbandonsPrevious,
      fullBackupKeepsTombstonesAndVoids,
      protectedRemoteRevision: protectedAfterRemote?.revision,
      manualWeakAtomicAndProtected,
      targetedStatsUseIndex,
      dependencyChildrenBlocked,
      dependencyResumesParentFirst,
      dependencyAttemptBlockedAndResumed: dependencyAttemptBlocked && dependencyAttemptResumed,
      deleteDependencyBlocked,
      failedCommitRolledBack,
      conflictStored,
      conflictLocalPreserved,
      conflictEntityBlocked,
      localConflictRebased,
      ownerMigrationPreserved,
      backupRestoreReadyToSync,
      backupProtectedFromPull,
      failedBackupRolledBack,
      selectedRoundTripDefault,
      selectedConflictProtectsLocal,
      selectedStatsRequireConfirmation,
      answerP95Ms,
      remainingSetIds: setsAfterDelete.map((set) => set.id),
      itemSurvivedSetDelete: contentAfterSetDelete.items.some((entry) => entry.id === item.id),
      transactionRejected,
      transactionRolledBack: rollbackMarker === undefined,
    };
    repository.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await deleteMemoryDatabase(owner);
    return output;
  });

  criticalPath = false;
  await context.setOffline(false);

  const syncEngineResult = await page.evaluate(async () => {
    const { deleteMemoryDatabase, migrateMemoryDatabaseOwner } = await import('/src/features/memory/infrastructure/indexedDb.ts');
    const { MemoryRepository } = await import('/src/features/memory/infrastructure/repositories.ts');
    const { flushMemorySync, syncMemory } = await import('/src/features/memory/infrastructure/syncEngine.ts');
    const originalFetch = window.fetch;
    const baseRecord = {
      kind: 'word', tags: [], source: 'user', verificationStatus: 'verified',
      createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z', revision: 1,
    };
    try {
      const paginationOwner = `pagination-${crypto.randomUUID()}`;
      const paginationRepository = new MemoryRepository(paginationOwner);
      let pullCalls = 0;
      window.fetch = async () => {
        pullCalls += 1;
        const first = pullCalls === 1;
        return new Response(JSON.stringify({
          schemaVersion: 1,
          serverTime: '2026-07-12T00:00:01.000Z',
          cursor: first ? '1' : '2',
          acceptedMutationIds: [], acceptedAttemptIds: [], conflicts: [],
          changes: { items: [{ ...baseRecord, id: first ? 'page-1' : 'page-2', label: first ? 'one' : 'two' }] },
          ...(first ? { hasMore: true } : {}),
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      const pullResult = await syncMemory(paginationRepository);
      const pulledContent = await paginationRepository.loadContent();
      const pullCursor = await paginationRepository.syncCursor();
      paginationRepository.close();
      await deleteMemoryDatabase(paginationOwner);

      const chunkOwner = `chunks-${crypto.randomUUID()}`;
      const chunkRepository = new MemoryRepository(chunkOwner);
      await chunkRepository.saveContentBundle({
        items: Array.from({ length: 6 }, (_, index) => ({
          ...baseRecord, id: `chunk-${index}`, label: `chunk ${index}`,
        })),
        senses: [], answers: [], examples: [], exercises: [],
      });
      const requestSizes = [];
      window.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        requestSizes.push({ mutations: body.mutations.length, attempts: body.attempts.length });
        return new Response(JSON.stringify({
          schemaVersion: 1, serverTime: '2026-07-12T00:00:02.000Z', cursor: '0',
          acceptedMutationIds: body.mutations.map((mutation) => mutation.mutationId),
          acceptedAttemptIds: body.attempts.map((attempt) => attempt.attemptId),
          conflicts: [], changes: {},
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      await flushMemorySync(chunkRepository);
      const chunksDrained = (await chunkRepository.pendingMutations(20)).length === 0;
      chunkRepository.close();
      await deleteMemoryDatabase(chunkOwner);

      const legacyOwner = `sync-legacy-${crypto.randomUUID()}`;
      const stableOwner = `sync-stable-${crypto.randomUUID()}`;
      const legacyRepository = new MemoryRepository(legacyOwner);
      const stableRepository = new MemoryRepository(stableOwner);
      await legacyRepository.saveContentBundle({
        items: [{ ...baseRecord, id: 'legacy-client-item', label: 'legacy client' }],
        senses: [], answers: [], examples: [], exercises: [],
      });
      await stableRepository.saveContentBundle({
        items: [{ ...baseRecord, id: 'stable-client-item', label: 'stable client' }],
        senses: [], answers: [], examples: [], exercises: [],
      });
      await migrateMemoryDatabaseOwner(legacyOwner, stableOwner);
      const mixedRepository = new MemoryRepository(stableOwner);
      const mixedClientRequests = [];
      window.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        mixedClientRequests.push({
          clientId: body.clientId,
          mutationClientIds: body.mutations.map((mutation) => mutation.clientId),
        });
        return new Response(JSON.stringify({
          schemaVersion: 1, serverTime: '2026-07-12T00:00:03.000Z', cursor: '0',
          acceptedMutationIds: body.mutations.map((mutation) => mutation.mutationId),
          acceptedAttemptIds: body.attempts.map((attempt) => attempt.attemptId),
          conflicts: [], changes: {},
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      await flushMemorySync(mixedRepository);
      const mixedClientDrained = (await mixedRepository.pendingMutations(20)).length === 0;
      legacyRepository.close();
      stableRepository.close();
      mixedRepository.close();
      await deleteMemoryDatabase(stableOwner);

      const attemptOwner = `attempt-drain-${crypto.randomUUID()}`;
      const attemptRepository = new MemoryRepository(attemptOwner);
      const attemptClientId = await attemptRepository.clientId();
      const attemptSession = {
        id: 'drain-session', status: 'active', selectedSetIds: [], initialTargetIds: ['drain-target'],
        config: { questionCount: { type: 'count', count: 20 }, direction: 'output', includeUnverifiedAi: false },
        seed: 'drain-seed', currentTargetId: 'drain-target', queueState: {}, completedTargetIds: [],
        needsReviewTargetIds: [], answerCount: 20, createdAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:20.000Z',
      };
      const drainStat = {
        id: 'sense:drain-sense:output', targetType: 'sense', targetId: 'drain-sense', mode: 'output',
        attempts: 20, correctCount: 20, partialCount: 0, incorrectCount: 0, skippedCount: 0,
        consecutiveCorrect: 20, consecutiveIncorrect: 0, averageResponseMs: 100, hintCount: 0,
        manualWeak: false, weaknessScore: 0, updatedAt: attemptSession.updatedAt,
      };
      const drainAttempts = Array.from({ length: 20 }, (_, index) => ({
        attemptId: `drain-attempt-${index}`, sessionId: attemptSession.id, clientId: attemptClientId,
        itemId: 'drain-item', senseId: 'drain-sense', targetId: 'drain-target', mode: 'output',
        exerciseType: 'flashcard', assessment: 'correct', errorTypes: [], hintUsed: false,
        responseMs: 100, createdAt: new Date(Date.parse('2026-07-12T00:00:00.000Z') + index).toISOString(),
      }));
      for (const drainAttempt of drainAttempts) {
        await attemptRepository.saveAttempt(drainAttempt, [drainStat], attemptSession);
      }
      const pendingSessionsBeforeDrain = (await attemptRepository.pendingMutations(100)).filter((mutation) =>
        mutation.entityType === 'session' && mutation.entityId === attemptSession.id
      ).length;
      const attemptDrainRequests = [];
      window.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        attemptDrainRequests.push({ mutations: body.mutations, attempts: body.attempts });
        return new Response(JSON.stringify({
          schemaVersion: 1, serverTime: '2026-07-12T00:01:00.000Z', cursor: '0',
          acceptedMutationIds: body.mutations.map((mutation) => mutation.mutationId),
          acceptedAttemptIds: body.attempts.map((attempt) => attempt.attemptId),
          conflicts: [], changes: {},
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      await flushMemorySync(attemptRepository);
      const allTwentyAttemptsDrained = (await attemptRepository.unsyncedAttempts(30)).length === 0;
      const emptyDrainStat = { ...drainStat, attempts: 0, correctCount: 0, consecutiveCorrect: 0 };
      const restoredDrainSession = { ...attemptSession, answerCount: 17 };
      for (const drainAttempt of drainAttempts.slice(0, 3)) {
        await attemptRepository.undoAttempt(drainAttempt.attemptId, [emptyDrainStat], restoredDrainSession);
      }
      const voidRequests = [];
      window.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        voidRequests.push({ mutations: body.mutations, attempts: body.attempts });
        return new Response(JSON.stringify({
          schemaVersion: 1, serverTime: '2026-07-12T00:02:00.000Z', cursor: '0',
          acceptedMutationIds: body.mutations.map((mutation) => mutation.mutationId),
          acceptedAttemptIds: body.attempts.map((attempt) => attempt.attemptId),
          conflicts: [], changes: {},
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      await flushMemorySync(attemptRepository);
      const voidsDrained = (await attemptRepository.pendingMutations(20)).length === 0;
      attemptRepository.close();
      await deleteMemoryDatabase(attemptOwner);
      return {
        pullCalls,
        pullStatus: pullResult.status,
        pulledItems: pulledContent.items.length,
        pullCursor,
        requestSizes,
        chunksDrained,
        mixedClientRequests,
        mixedClientDrained,
        pendingSessionsBeforeDrain,
        attemptDrainRequests,
        allTwentyAttemptsDrained,
        voidRequests,
        voidsDrained,
      };
    } finally {
      window.fetch = originalFetch;
    }
  });

  console.log('--- Memory browser: IndexedDB schema and offline repository ---');
  const requiredStores = [
    'memoryItems', 'memorySenses', 'memoryAnswers', 'memoryExamples', 'memoryExercises',
    'memorySets', 'memorySetMembers', 'memoryStats', 'memoryAttempts', 'memorySessions',
    'memoryPendingMutations', 'memoryConflicts', 'memoryMeta',
  ];
  check('必要なIndexedDB object storeを作成', requiredStores.every((name) => result.storeNames.includes(name)), result.storeNames);
  check(
    'IndexedDB v1→v3で既存データを保ち履歴cursor用複合indexを追加',
    result.upgradePreserved && Object.values(result.upgradeIndexes).every(Boolean),
    result.upgradeIndexes,
  );
  check('clientIdを端末内で安定保持', result.stableClientId, result);
  check(
    '同一Itemを複数セットから参照しcontentを重複しない',
    result.selected.sets === 2
      && result.selected.members === 2
      && result.selected.items === 1
      && result.selected.senses === 2
      && result.selected.answers === 2,
    result.selected,
  );
  check('オフライン編集をpending mutationへ保存', result.pendingAfterEdit >= 9, result.pendingAfterEdit);
  check('pending mutationへ単調なローカル順序を付与', result.stableMutationSequence, result);
  check('親→子のトポロジカル順で同期候補を返す', result.parentBeforeChildren, result);
  check('username ownerからserver userId ownerへデータと保留同期を移行', result.ownerMigrationPreserved, result);
  check('完全バックアップを単一Txで置換しAttempt/contentを再同期可能化', result.backupRestoreReadyToSync, result);
  check('完全バックアップ出力にcontent tombstoneと取消済みAttemptを保持', result.fullBackupKeepsTombstonesAndVoids, result);
  check('復元pending中のcontent・manualWeakをremote pullで上書きしない', result.backupProtectedFromPull, result);
  check('完全バックアップ置換失敗時にclearを含む全処理をロールバック', result.failedBackupRolledBack, result);
  check('選択セットJSONをID維持・revision再基準化して往復取込', result.selectedRoundTripDefault, result);
  check('選択セットJSONの同一ID内容競合を表示・拒否して既存を保護', result.selectedConflictProtectsLocal, result);
  check('選択セットJSONのStatは明示確認時だけlocalへ保存', result.selectedStatsRequireConfirmation, result);
  check(
    '初回pullのhasMoreを同一syncで最後まで取得',
    syncEngineResult.pullCalls === 2
      && syncEngineResult.pullStatus === 'synced'
      && syncEngineResult.pulledItems === 2
      && syncEngineResult.pullCursor === '2',
    syncEngineResult,
  );
  check(
    'D1 query予算向け5件chunkでflushし全mutationを送信',
    syncEngineResult.chunksDrained
      && syncEngineResult.requestSizes.length === 2
      && syncEngineResult.requestSizes.every((entry) => entry.mutations <= 5 && entry.attempts <= 2),
    syncEngineResult,
  );
  check(
    'owner移行で混在したclientIdをAPI要件どおり別requestで欠損なく送信',
    syncEngineResult.mixedClientDrained
      && syncEngineResult.mixedClientRequests.length === 2
      && syncEngineResult.mixedClientRequests.every((request) =>
        request.mutationClientIds.length > 0
        && request.mutationClientIds.every((clientId) => clientId === request.clientId)
      ),
    syncEngineResult,
  );
  check(
    '同一session mutationを最新1件に集約し20 Attemptを2件chunkでdefault flush完送',
    syncEngineResult.pendingSessionsBeforeDrain === 1
      && syncEngineResult.allTwentyAttemptsDrained
      && syncEngineResult.attemptDrainRequests.reduce((sum, request) => sum + request.attempts.length, 0) === 20
      && syncEngineResult.attemptDrainRequests.every((request) => request.attempts.length <= 2),
    syncEngineResult,
  );
  check(
    'attempt_voidはattemptと混在させず1request 1件で全件送信',
    syncEngineResult.voidsDrained
      && syncEngineResult.voidRequests.filter((request) =>
        request.mutations.some((mutation) => mutation.entityType === 'attempt_void')
      ).every((request) =>
        request.mutations.length === 1
        && request.mutations[0].entityType === 'attempt_void'
        && request.attempts.length === 0
      ),
    syncEngineResult,
  );

  console.log('--- Memory browser: attempts, restore, undo and transactionality ---');
  check('同じattemptIdの再保存でAttemptを二重化しない', result.attemptCountAfterDuplicate === 1, result);
  check('同じattemptIdの内容上書きを拒否して元回答を保持', result.attemptOverwriteRejected, result);
  check('同一回答の同時取消はappend-only voidを1件だけ生成', result.concurrentUndoSingle, result);
  check('回答ごとにactive session状態を保存・復元', result.activeSessionAnswerCount === 1, result);
  check(
    '未同期回答の取消もappend-only voidとしてStat・Sessionを復元',
    result.unsyncedAttemptKeptAsVoid && result.restoredStatAttempts === 0 && result.restoredSessionAnswerCount === 0,
    result,
  );
  check(
    '送信中に取消しても応答でAttempt/Statを復活させない',
    result.racedUndoPreserved && result.racedUndoStatAttempts === 0,
    result,
  );
  check(
    '同期済み回答の取消は削除せずvoid mutation',
    result.syncedUndoKeptVoid && result.visibleAttemptsAfterSyncedUndo === 0 && result.queuedAttemptVoid,
    result,
  );
  check('Sense/Answer/Exercise実ID用indexから統計履歴を取得', result.senseHistoryCount > 0, result);
  check('統計履歴をInput/Outputモード別に混在なく取得', result.statHistoryModeFiltered, result);
  check('新規session開始時に既存activeを一括abandonしてactiveを1件に限定', result.startSessionAbandonsPrevious, result);
  check('古いremote revisionで新しいローカル版を上書きしない', result.protectedRemoteRevision === 3, result);
  check('manualWeakとpending preferenceを同一Txで保存しpullから保護', result.manualWeakAtomicAndProtected, result);
  check('対象指定Stat取得はtargetId indexを使い全件scanしない', result.targetedStatsUseIndex, result);
  check(
    '親競合で子孫mutationを止め、解決後は親→子順で再開',
    result.dependencyChildrenBlocked && result.dependencyResumesParentFirst,
    result,
  );
  check('content競合に依存するAttemptも解決まで送信しない', result.dependencyAttemptBlockedAndResumed, result);
  check('子delete競合中は親deleteも送信しない', result.deleteDependencyBlocked, result);
  check('remote・accepted・conflict・cursor確定失敗を全体ロールバック', result.failedCommitRolledBack, result);
  check(
    '競合を保存して同一entity後続を止め、local選択時にserver revisionへrebase',
    result.conflictStored && result.conflictLocalPreserved && result.conflictEntityBlocked && result.localConflictRebased,
    result,
  );
  check(
    'セット削除で共有Item本体を削除しない',
    JSON.stringify(result.remainingSetIds) === JSON.stringify(['set-b']) && result.itemSurvivedSetDelete,
    result,
  );
  check('複数store書込失敗を一括ロールバック', result.transactionRejected && result.transactionRolledBack, result);

  console.log('--- Memory browser: learning critical path ---');
  check('オフライン中も編集・回答・取消が完了', true);
  check('ローカル学習クリティカルパスで通信しない', criticalRequests.length === 0, criticalRequests);
  check('回答保存の40回計測P95が250ms以内', result.answerP95Ms <= 250, result.answerP95Ms);

  await context.close();
} catch (error) {
  failures += 1;
  console.error('  ❌ memory browser integration crashed', error);
  if (serverOutput) console.error(serverOutput);
} finally {
  await browser?.close();
  await stopServer();
}

console.log(failures === 0 ? '\n🎉 ALL PASS (memory browser)' : `\n💥 ${failures} FAILURES (memory browser)`);
process.exit(failures === 0 ? 0 : 1);
