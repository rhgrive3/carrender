import { useEffect, useRef } from 'react';
import { generatePlan } from '../lib/scheduler';
import { today } from '../lib/date';
import {
  reconcileCompletedMaterialProgress,
  reconcileCompletedTaskHistory,
} from '../lib/materialProgressIntegrity';
import { useApp } from '../state/AppContext';
import { useToast } from './ui/Toast';

/** 完了記録・完了タスク・教材進捗の旧データ不整合を、一度だけ修復して再計画する。 */
export function MaterialProgressIntegrityBridge() {
  const { state, dispatch } = useApp();
  const showToast = useToast();
  const handledRepairKey = useRef<string | null>(null);

  useEffect(() => {
    // 先に消えた完了タスクを記録snapshotから戻す。戻したタスク範囲も続く教材進捗修復へ含める。
    const taskHistoryResult = reconcileCompletedTaskHistory(state);
    const materialResult = reconcileCompletedMaterialProgress(taskHistoryResult.state);
    if (taskHistoryResult.repairs.length === 0 && materialResult.repairs.length === 0) {
      handledRepairKey.current = null;
      return;
    }

    const taskRepairKey = taskHistoryResult.repairs
      .map((repair) => `task:${repair.sessionId}:${repair.taskId}:${repair.previousStatus}`)
      .join('|');
    const materialRepairKey = materialResult.repairs
      .map((repair) => `material:${repair.materialId}:${repair.previousDoneAmount}->${repair.repairedDoneAmount}`)
      .join('|');
    const repairKey = [taskRepairKey, materialRepairKey].filter(Boolean).join('|');
    if (handledRepairKey.current === repairKey) return;
    handledRepairKey.current = repairKey;

    const replanned = generatePlan(materialResult.state, today(), '学習履歴の整合性修復').state;
    dispatch({ type: 'REPLACE_STATE', state: { ...replanned, lastReschedule: null } });

    const details = [
      ...taskHistoryResult.repairs.map((repair) => `${repair.taskTitle}の完了表示を復元`),
      ...materialResult.repairs.map((repair) => `${repair.materialName}: ${repair.previousDoneAmount}→${repair.repairedDoneAmount}`),
    ];
    const visibleDetails = details.slice(0, 5);
    if (details.length > visibleDetails.length) visibleDetails.push(`ほか${details.length - visibleDetails.length}件`);
    showToast({
      title: '学習履歴を修復しました',
      detail: visibleDetails.join('、'),
      tone: 'info',
      durationMs: 8_000,
      dedupeKey: `learning-history-repair:${repairKey}`,
    });
  }, [dispatch, showToast, state]);

  return null;
}
