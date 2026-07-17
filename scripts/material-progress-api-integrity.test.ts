/// <reference types="node" />
import { validateAppStatePayload } from '../functions/_shared/appState';

function stateWithMaterial(material: Record<string, unknown>) {
  return {
    version: 6,
    schemaVersion: 6,
    isDemo: false,
    onboarded: true,
    goal: { id: 'goal', name: '試験', examDate: '2026-08-31', createdAt: '2026-07-17T00:00:00.000Z' },
    subjects: [{ id: 'subject', name: '数学', color: '#4f7cff', importance: 3, weakness: 3 }],
    materials: [{
      id: 'material',
      subjectId: 'subject',
      name: '問題集',
      totalAmount: 10,
      minutesPerUnit: 10,
      startDate: '2026-07-17',
      targetDate: '2026-08-20',
      archived: false,
      ...material,
    }],
    tasks: [],
    sessions: [],
    availability: [],
    dayPlans: [],
    fixedEvents: [],
    settings: { theme: 'auto' },
    lastReschedule: null,
    lastPlannedDate: null,
  };
}

function assertValidation(name: string, value: unknown, expected: boolean) {
  const result = validateAppStatePayload(value);
  if (result.ok !== expected) {
    throw new Error(`${name}: expected ${expected ? 'valid' : 'invalid'}, got ${JSON.stringify(result)}`);
  }
  console.log(`  PASS ${name}`);
}

console.log('--- 教材進捗API整合性 ---');
assertValidation('正規の完了範囲と完了量を受理', stateWithMaterial({
  doneAmount: 5,
  completedRanges: [{ start: 1, end: 2 }, { start: 5, end: 7 }],
}), true);
assertValidation('順序違い・重複範囲でも集合として一致すれば受理', stateWithMaterial({
  doneAmount: 5,
  completedRanges: [{ start: 3, end: 5 }, { start: 1, end: 3 }],
}), true);
assertValidation('重複範囲の単純加算で水増しした完了量を拒否', stateWithMaterial({
  doneAmount: 6,
  completedRanges: [{ start: 1, end: 3 }, { start: 3, end: 5 }],
}), false);
assertValidation('空の完了範囲と非ゼロ完了量の不一致を拒否', stateWithMaterial({
  doneAmount: 2,
  completedRanges: [],
}), false);
assertValidation('completedRanges導入前の旧形式は互換維持', stateWithMaterial({ doneAmount: 2 }), true);

console.log('教材進捗API整合性テスト: OK');
