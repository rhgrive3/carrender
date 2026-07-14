import type { ISODate, StudyTask } from './index';

export interface StoredPlanRevisionTaskPlacement {
  key: string;
  taskId: string;
  title: string;
  materialId: string | null;
  estimatedMinutes: number;
  scheduledDate: ISODate;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  placementStatus?: StudyTask['placementStatus'];
  placementLock?: StudyTask['placementLock'];
  manualOrder?: number;
}

export interface StoredPlanRevisionChange {
  key: string;
  taskId: string;
  title: string;
  materialId: string | null;
  kind: 'added' | 'removed' | 'moved' | 'updated';
  before?: StoredPlanRevisionTaskPlacement;
  after?: StoredPlanRevisionTaskPlacement;
}

export interface StoredPlanRevisionMaterialChange {
  materialId: string;
  changedTasks: number;
  movedTasks: number;
  beforeMinutes: number;
  afterMinutes: number;
}

export interface StoredPlanRevision {
  id: string;
  generationId: string;
  createdAt: string;
  reason: string;
  fromDate: ISODate;
  placements: StoredPlanRevisionTaskPlacement[];
  changes: StoredPlanRevisionChange[];
  materialChanges: StoredPlanRevisionMaterialChange[];
}

export interface StoredHistoricalMonthSummary {
  month: string;
  studyMinutes: number;
  sessionCount: number;
  completedTaskCount: number;
  plannedMinutes: number;
  missedMinutes: number;
  subjectMinutes: { subjectId: string; minutes: number }[];
}

declare module './index' {
  interface AppSettings {
    /** 計画世代と1年超履歴の圧縮集計。既存設定との後方互換のため任意。 */
    historyData?: {
      planRevisions: StoredPlanRevision[];
      monthlySummaries: StoredHistoricalMonthSummary[];
    };
  }
}
