import assert from 'node:assert/strict';
import { recordChartSharePercent } from '../src/lib/recordChartShares';
import { memoryReviewCardLabel, summarizeMemoryCardOutcomes } from '../src/features/memory/ui/MemoryResult';
import { appReducer, emptyState } from '../src/state/AppContext';
import { addDays, today } from '../src/lib/date';

const shares = (values: number[]) => {
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => recordChartSharePercent(value, total));
};
for (const values of [[95, 5], [98, 1, 1], [1, 1, 1], [100]]) {
  const result = shares(values);
  assert.ok(Math.abs(result.reduce((sum, value) => sum + value, 0) - 100) < 1e-9);
  result.forEach((value) => assert.ok(value >= 0 && value <= 100));
}
assert.deepEqual(shares([95, 5]), [95, 5]);
assert.equal(recordChartSharePercent(Number.NaN, 100), 0);
assert.equal(recordChartSharePercent(10, 0), 0);

const outcomes = summarizeMemoryCardOutcomes({
  initialTargetIds: ['a', 'a', 'b', 'c'], completedTargetIds: ['a'], needsReviewTargetIds: ['b'],
} as any, [
  { targetId: 'a', assessment: 'incorrect' }, { targetId: 'a', assessment: 'correct' },
  { targetId: 'b', assessment: 'partial' }, { targetId: 'c', assessment: 'incorrect' },
] as any);
assert.deepEqual(outcomes, { remembered: 1, unsure: 1, missed: 1 });
assert.equal(outcomes.remembered + outcomes.unsure + outcomes.missed, 3, 'one unique target must belong to exactly one card outcome');

const memoryBundle: any = {
  sets: [], setMembers: [], exercises: [],
  items: [{ id: 'item', label: '壊れた親ラベル' }],
  senses: [
    { id: 'sense-1', itemId: 'item', promptJa: '〜を考慮する', meaningJa: '〜を考慮する' },
    { id: 'sense-2', itemId: 'item', promptJa: '説明する', meaningJa: '説明する' },
  ],
  answers: [
    { id: 'answer-1', senseId: 'sense-1', displayForm: 'take into account', verificationStatus: 'verified' },
    { id: 'answer-2', senseId: 'sense-2', displayForm: 'account for', verificationStatus: 'verified' },
  ],
  examples: [],
};
assert.equal(
  memoryReviewCardLabel(memoryBundle, { senseId: 'sense-1' } as any),
  '〜を考慮する — take into account',
  'result labels must identify the answered sense rather than the shared item label',
);
assert.equal(
  memoryReviewCardLabel(memoryBundle, { senseId: 'sense-2' } as any),
  '説明する — account for',
);
assert.equal(memoryReviewCardLabel(memoryBundle, { senseId: 'deleted-sense' } as any), '削除済みカード');
assert.equal(
  memoryReviewCardLabel({ ...memoryBundle, answers: [] }, { senseId: 'sense-1' } as any),
  '〜を考慮する — 英語表現が未設定です',
);

const t = today();
const now = new Date().toISOString();
const base = emptyState();
const material: any = {
  id: 'material', subjectId: 'subject', name: '教材', unit: '問題', totalAmount: 300,
  totalUnits: 300, doneAmount: 0, completedRanges: [], startDate: t, targetDate: addDays(t, 30),
  priority: 3, difficulty: 3, minutesPerUnit: 10, estimatedMinutesPerUnit: 20, unitStep: 1,
  splittable: true, minimumChunkUnits: 1, preferredCadence: { type: 'auto' }, estimateMode: 'auto',
  dailyTarget: null, weeklyTarget: null, deadlinePolicy: 'normal', examRelevance: 3,
  reviewEnabled: false, reviewIntervals: [1, 3, 7], paused: false, round: 1, archived: false, createdAt: now,
};
const makeSession = (id: string): any => ({
  id, taskId: null, subjectId: 'subject', materialId: 'material', date: t,
  startedAt: `${t}T00:00:00.000Z`, minutes: 20, amountDone: 1, rangeLabel: '1',
  focus: 3, memo: '', source: 'manual', completedTask: false, progressRangesAdded: [], updatedAt: now,
});
const state: any = {
  ...base, onboarded: true,
  subjects: [{ id: 'subject', name: '数学', color: '#4f7cff', importance: 3, weakness: 3 }],
  materials: [material], sessions: [makeSession('s1'), makeSession('s2'), makeSession('s3')],
  settings: { ...base.settings, estimateAlpha: 0.2 },
};
const edited = appReducer(state, {
  type: 'UPDATE_SESSION', sessionId: 's1', input: {
    taskId: null, subjectId: 'subject', materialId: 'material', minutes: 20, amountDone: 1,
    focus: 3, memo: 'memo only', source: 'manual', rangeLabel: '1', completedTask: false,
    date: t, startTime: '09:00',
  },
});
assert.equal(edited.materials[0].minutesPerUnit, 10);
assert.equal(edited.materials[0].estimatedMinutesPerUnit, 20);

const metadataState: any = {
  ...state,
  sessions: [
    { ...makeSession('s1'), pausedMinutes: 8, excludedFromEstimate: true },
    makeSession('s2'),
    makeSession('s3'),
  ],
};
const metadataEdited = appReducer(metadataState, {
  type: 'UPDATE_SESSION', sessionId: 's1', input: {
    taskId: null, subjectId: 'subject', materialId: 'material', minutes: 20, amountDone: 1,
    focus: 4, memo: 'metadata-safe edit', source: 'manual', rangeLabel: '1', completedTask: false,
    date: t, startTime: '10:00',
  },
});
const preservedSession = metadataEdited.sessions.find((session: any) => session.id === 's1');
assert.equal(preservedSession.pausedMinutes, 8, 'editing must not erase timer pause metadata');
assert.equal(preservedSession.excludedFromEstimate, true, 'editing must not erase estimate exclusion');
assert.equal(metadataEdited.materials[0].minutesPerUnit, 10, 'same observation must not reapply estimate smoothing');
assert.equal(metadataEdited.materials[0].estimatedMinutesPerUnit, 20);

const changedObservation = appReducer(metadataState, {
  type: 'UPDATE_SESSION', sessionId: 's1', input: {
    taskId: null, subjectId: 'subject', materialId: 'material', minutes: 25, amountDone: 1,
    focus: 4, memo: 'changed duration', source: 'manual', rangeLabel: '1', completedTask: false,
    date: t, startTime: '10:00',
  },
});
const changedSession = changedObservation.sessions.find((session: any) => session.id === 's1');
assert.equal(changedSession.pausedMinutes, 8, 'metadata must survive even when the measured observation changes');
assert.equal(changedSession.excludedFromEstimate, true);

const rangedState: any = {
  ...state, sessions: [],
  materials: [{ ...material, doneAmount: 100, completedRanges: [{ start: 1, end: 50 }, { start: 251, end: 300 }] }],
};
const shrunk = appReducer(rangedState, {
  type: 'UPDATE_MATERIAL',
  material: { ...rangedState.materials[0], totalAmount: 200, totalUnits: 200, doneAmount: 50, completedRanges: [{ start: 1, end: 50 }] },
});
assert.deepEqual(shrunk.materials[0].completedRanges, [{ start: 1, end: 50 }]);
assert.equal(shrunk.materials[0].doneAmount, 50);

const invalid = appReducer(state, {
  type: 'UPDATE_MATERIAL', material: { ...material, preferredCadence: { type: 'timesPerWeek', count: 8 } },
});
assert.equal(invalid, state);
console.log('audit issues #344-#352 and post-audit regressions passed');
