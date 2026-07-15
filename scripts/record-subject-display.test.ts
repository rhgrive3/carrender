import assert from 'node:assert/strict';
import { resolveRecordSubject, summarizeRecordSubjects } from '../src/lib/recordSubjects';
import type { Subject } from '../src/types';

const subjects: Subject[] = [{
  id: 'subject-active',
  name: '数学',
  color: '#3366ff',
  importance: 5,
  weakness: 3,
}];

const active = resolveRecordSubject(subjects, 'subject-active');
assert.equal(active.name, '数学');
assert.equal(active.color, '#3366ff');
assert.equal(active.deleted, false);

const deleted = resolveRecordSubject(subjects, 'subject-deleted');
assert.equal(deleted.id, 'subject-deleted');
assert.equal(deleted.name, '削除済みの科目');
assert.equal(deleted.deleted, true);
assert.ok(deleted.color, '削除済み科目にも表示色がある');

const summary = summarizeRecordSubjects([
  { subjectId: 'subject-active', minutes: 30 },
  { subjectId: 'subject-deleted', minutes: 20 },
  { subjectId: 'subject-deleted', minutes: 15 },
  { subjectId: 'subject-deleted-2', minutes: 10 },
], subjects);

assert.deepEqual(
  summary.map((item) => [item.subject.id, item.minutes]),
  [
    ['subject-deleted', 35],
    ['subject-active', 30],
    ['subject-deleted-2', 10],
  ],
);
assert.equal(summary.filter((item) => item.subject.deleted).length, 2);
assert.equal(new Set(summary.map((item) => item.subject.id)).size, summary.length, '削除済み科目ごとに一意なキーを保つ');

console.log('✅ deleted subject record display regressions passed');
