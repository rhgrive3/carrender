import assert from 'node:assert/strict';
import { computeAnalytics } from '../src/lib/analytics';
import { addDays } from '../src/lib/date';
import { emptyState } from '../src/state/AppContext';
import type { AppState, StudySession } from '../src/types';

const ref = '2026-07-18';
const yesterday = addDays(ref, -1);
const dayBefore = addDays(ref, -2);

function session(id: string, date: string, minutes: number): StudySession {
  return {
    id,
    taskId: null,
    subjectId: 'subject',
    materialId: null,
    date,
    startedAt: `${date}T09:00:00.000Z`,
    minutes,
    amountDone: 0,
    rangeLabel: '',
    focus: null,
    memo: '',
    source: 'manual',
    taskSnapshotBefore: null,
    updatedAt: `${date}T09:00:00.000Z`,
  } as StudySession;
}

const base = emptyState();
const state = {
  ...base,
  sessions: [
    session('day-before', dayBefore, 30),
    session('yesterday', yesterday, 45),
    session('today-zero', ref, 0),
  ],
} as AppState;

const analytics = computeAnalytics(state, ref);
assert.equal(analytics.todayMinutes, 0, '0分記録を今日の学習時間へ加算しない');
assert.equal(analytics.streakDays, 2, '今日に0分記録だけがあっても昨日までの連続学習を維持する');
assert.equal(analytics.bestStreakDays, 2, '最長連続日数でも0分記録を学習日として数えない');

console.log('✅ zero-minute sessions do not break or extend study streaks');
