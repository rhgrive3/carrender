import { useEffect, useLayoutEffect } from 'react';
import type { AppState } from '../types';
import { MAIN_STATE_AUTO_MERGED_EVENT } from '../lib/api';
import { repairOrphanedSessionTaskReferences } from '../lib/sessionTaskReferences';
import { saveStateNow } from '../lib/storage';
import { useApp } from '../state/AppContext';
import { useToast } from './ui/Toast';

interface AutoMergeDetail {
  state: AppState;
}

export function MainStateMergeBridge() {
  const { state, dispatch } = useApp();
  const toast = useToast();

  useLayoutEffect(() => {
    const repaired = repairOrphanedSessionTaskReferences(state);
    if (repaired === state) return;

    // APIの厳密検証より先に旧端末データを自己修復する。学習実績や
    // taskSnapshotBeforeは残し、解決不能なtaskIdだけを切り離す。
    dispatch({ type: 'REPLACE_STATE', state: repaired });
    saveStateNow(repaired);
    toast('古い学習記録の参照を修復し、同期を再開しました');
  }, [dispatch, state, toast]);

  useEffect(() => {
    const apply = (event: Event) => {
      const detail = (event as CustomEvent<AutoMergeDetail>).detail;
      if (!detail?.state) return;
      dispatch({ type: 'REPLACE_STATE', state: detail.state });
      saveStateNow(detail.state);
      toast('別端末の非競合変更を自動統合しました');
    };
    window.addEventListener(MAIN_STATE_AUTO_MERGED_EVENT, apply);
    return () => window.removeEventListener(MAIN_STATE_AUTO_MERGED_EVENT, apply);
  }, [dispatch, toast]);

  return null;
}
