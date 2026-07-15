import type { StudySession, Subject } from '../types';

export interface RecordSubjectDisplay {
  id: string;
  name: string;
  color: string;
  deleted: boolean;
}

const DELETED_SUBJECT_NAME = '削除済みの科目';
const DELETED_SUBJECT_COLOR = 'var(--text-muted)';

/** 過去の学習記録が参照する科目を、削除済みの場合も表示可能な形へ正規化する。 */
export function resolveRecordSubject(subjects: Subject[], subjectId: string): RecordSubjectDisplay {
  const subject = subjects.find((item) => item.id === subjectId);
  if (subject) {
    return {
      id: subject.id,
      name: subject.name,
      color: subject.color,
      deleted: false,
    };
  }
  return {
    id: subjectId,
    name: DELETED_SUBJECT_NAME,
    color: DELETED_SUBJECT_COLOR,
    deleted: true,
  };
}

/** セッションを科目別に集計し、削除済み科目も失わず返す。 */
export function summarizeRecordSubjects(
  sessions: Pick<StudySession, 'subjectId' | 'minutes'>[],
  subjects: Subject[],
): { subject: RecordSubjectDisplay; minutes: number }[] {
  const minutesBySubject = new Map<string, number>();
  for (const session of sessions) {
    minutesBySubject.set(
      session.subjectId,
      (minutesBySubject.get(session.subjectId) ?? 0) + session.minutes,
    );
  }
  return [...minutesBySubject.entries()]
    .map(([subjectId, minutes]) => ({
      subject: resolveRecordSubject(subjects, subjectId),
      minutes,
    }))
    .sort((a, b) => b.minutes - a.minutes || a.subject.id.localeCompare(b.subject.id));
}

/**
 * 積み上げ棒の各区分を視認可能にしつつ、合計が必ず100%になるよう配分する。
 * 小区分へ一律の最小値を足す方式は、科目数が多い日に棒が枠外へ溢れるため使わない。
 */
export function normalizeRecordStackPercentages(minutes: number[], minimumPercent = 4): number[] {
  const positive = minutes.map((value) => Math.max(0, value));
  const total = positive.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || positive.length === 0) return positive.map(() => 0);

  const minimum = Math.min(Math.max(0, minimumPercent), 100 / positive.length);
  const raw = positive.map((value) => (value / total) * 100);
  const smallIndexes = raw.map((value, index) => (value < minimum ? index : -1)).filter((index) => index >= 0);
  if (smallIndexes.length === 0) return raw;

  const smallSet = new Set(smallIndexes);
  const reserved = minimum * smallIndexes.length;
  const largeTotal = raw.reduce((sum, value, index) => sum + (smallSet.has(index) ? 0 : value), 0);

  return raw.map((value, index) => {
    if (smallSet.has(index)) return minimum;
    return largeTotal > 0 ? (value / largeTotal) * (100 - reserved) : 0;
  });
}
