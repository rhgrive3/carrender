import type { SchedulerDiagnostics, UnscheduledReasonCode, UnscheduledWorkItem, ValidationIssue } from '../types';

export function createSchedulerDiagnostics(errors: ValidationIssue[] = []): SchedulerDiagnostics {
  return {
    capRelaxations: [],
    inputGuards: errors.map((error) => ({ targetId: error.targetId, field: error.field, reason: error.reason })),
    unscheduledReasons: [],
  };
}

export function classifyUnscheduledReason(item: UnscheduledWorkItem): UnscheduledReasonCode {
  const detail = item.reason;
  if (/ソルバー|探索上限|判定でき/.test(detail)) return 'solverLimit';
  if (/指定日|固定|時刻|空き区間/.test(detail)) return 'fixedSlot';
  if (/頻度|cadence/.test(detail)) return 'cadence';
  if (/期限|期日|deadline/.test(detail)) return 'deadline';
  if (/容量|予算|空き時間|余剰/.test(detail)) return 'capacity';
  return 'unknown';
}

export function requirePositiveSchedulerValue(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`SCHEDULER_INVARIANT:${field}:${String(value)}`);
  }
  return value;
}
