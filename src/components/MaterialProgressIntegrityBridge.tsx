import { useEffect, useRef } from 'react';
import { generatePlan } from '../lib/scheduler';
import { today } from '../lib/date';
import { reconcileCompletedMaterialProgress } from '../lib/materialProgressIntegrity';
import { useApp } from '../state/AppContext';
import { useToast } from './ui/Toast';

/** 完了済み教材タスクと教材進捗の旧データ不整合を、一度だけ修復して再計画する。 */
export function MaterialProgressIntegrityBridge() {
  const { state, dispatch } = useApp();
  const showToast = useToast();
  const handledRepairKey = useRef<string | null>(null);

  useEffect(() => {
    const result = reconcileCompletedMaterialProgress(state);
    if (result.repairs.length === 0) {
      handledRepairKey.current = null;
      return;
    }
    const repairKey = result.repairs
      .map((repair) => `${repair.materialId}:${repair.previousDoneAmount}->${repair.repairedDoneAmount}`)
      .join('|');
    if (handledRepairKey.current === repairKey) return;
    handledRepairKey.current = repairKey;

    const replanned = generatePlan(result.state, today(), '教材進捗の整合性修復').state;
    dispatch({ type: 'REPLACE_STATE', state: { ...replanned, lastReschedule: null } });
    showToast({
      title: '教材進捗を修復しました',
      detail: result.repairs
        .map((repair) => `${repair.materialName}: ${repair.previousDoneAmount}→${repair.repairedDoneAmount}`)
        .join('、'),
      tone: 'info',
      durationMs: 8_000,
      dedupeKey: `material-progress-repair:${repairKey}`,
    });
  }, [dispatch, showToast, state]);

  return null;
}
