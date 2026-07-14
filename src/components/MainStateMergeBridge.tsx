import { useEffect, useRef } from 'react';
import type { AppState } from '../types';
import { MAIN_STATE_AUTO_MERGED_EVENT } from '../lib/api';
import { mergeMainStates } from '../lib/mainStateMerge';
import { getCurrentMainSyncMetadata, saveMainSyncConflictBackup } from '../lib/mainSync';
import { saveStateNow } from '../lib/storage';
import { useApp } from '../state/AppContext';
import { useToast } from './ui/Toast';

interface AutoMergeDetail {
  state: AppState;
}

export function MainStateMergeBridge() {
  const { state, dispatch, syncConflict, resolveSyncConflict } = useApp();
  const toast = useToast();
  const attemptedStartupConflict = useRef<string | null>(null);

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

  // 起動時に競合が見つかった場合も、前回同期時のentity hashを基準に
  // 異なるIDの変更だけを自動統合する。同一IDの両側編集は既存UIへ残す。
  useEffect(() => {
    if (!syncConflict) {
      attemptedStartupConflict.current = null;
      return;
    }
    const key = `${syncConflict.localBaseUpdatedAt ?? 'null'}:${syncConflict.remoteUpdatedAt}`;
    if (attemptedStartupConflict.current === key) return;
    attemptedStartupConflict.current = key;

    const metadata = getCurrentMainSyncMetadata();
    const merge = mergeMainStates(metadata?.baseEntityHashes, state, syncConflict.remoteState);
    if (!merge.merged || !metadata) return;

    saveMainSyncConflictBackup({
      owner: metadata.owner,
      createdAt: new Date().toISOString(),
      localBaseUpdatedAt: syncConflict.localBaseUpdatedAt,
      remoteUpdatedAt: syncConflict.remoteUpdatedAt,
      localState: state,
      remoteState: syncConflict.remoteState,
    });
    dispatch({ type: 'REPLACE_STATE', state: merge.merged });
    saveStateNow(merge.merged);
    toast('起動時の非競合変更を自動統合しました');
    void resolveSyncConflict('local').catch(() => {
      attemptedStartupConflict.current = null;
    });
  }, [dispatch, resolveSyncConflict, state, syncConflict, toast]);

  return null;
}
