import type { StudySession, Subject } from '../types';

export interface RecordSubjectDisplay {
  id: string;
  name: string;
  color: string;
  deleted: boolean;
}

const DELETED_SUBJECT_NAME = '削除済みの科目';
const DELETED_SUBJECT_COLOR = 'var(--text-muted)';

function stableSubjectFingerprint(subjectId: string): string {
  let hash = 0x811c9dc5;
  for (const char of subjectId) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, '0');
}

function deletedSubjectLabel(subjectId: string): string {
  if (!subjectId) return DELETED_SUBJECT_NAME;
  return `${DELETED_SUBJECT_NAME} · ${stableSubjectFingerprint(subjectId)}`;
}

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
    name: deletedSubjectLabel(subjectId),
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
