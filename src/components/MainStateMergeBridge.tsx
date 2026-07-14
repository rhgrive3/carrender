import { useEffect } from 'react';
import type { AppState } from '../types';
import { MAIN_STATE_AUTO_MERGED_EVENT } from '../lib/api';
import { saveStateNow } from '../lib/storage';
import { useApp } from '../state/AppContext';
import { useToast } from './ui/Toast';

interface AutoMergeDetail {
  state: AppState;
}

export function MainStateMergeBridge() {
  const { dispatch } = useApp();
  const toast = useToast();

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
