import type { HistoricalMonthSummary } from '../lib/historyRetention';
import type { PlanRevision } from '../lib/planHistory';

declare module './index' {
  interface AppSettings {
    /** Synced audit history. Kept optional for backward-compatible imports. */
    historyData?: {
      planRevisions: PlanRevision[];
      monthlySummaries: HistoricalMonthSummary[];
    };
  }
}

export {};
