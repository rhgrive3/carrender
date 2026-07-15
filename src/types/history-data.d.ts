import './index';
import type { HistoricalMonthSummary } from '../lib/historyRetention';
import type { PlanRevision } from '../lib/planHistory';

declare module './index' {
  interface AppSettings {
    /** 再計画の詳細履歴と、保持期限を超えた学習データの月次集計。 */
    historyData?: {
      planRevisions: PlanRevision[];
      monthlySummaries: HistoricalMonthSummary[];
    };
  }
}

export {};
