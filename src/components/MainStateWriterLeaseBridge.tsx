import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../state/AuthContext';
import { useApp } from '../state/AppContext';
import {
  ensureMainStateWriterLease,
  hasMainStateWriterLease,
  MAIN_STATE_WRITER_HEARTBEAT_MS,
  releaseMainStateWriterLease,
} from '../lib/mainStateWriterLease';
import { useToast } from './ui/Toast';

export function MainStateWriterLeaseBridge() {
  const { user } = useAuth();
  const { retrySync } = useApp();
  const toast = useToast();
  const owner = user?.username ?? null;
  const wasWriter = useRef(false);
  const [isWriter, setIsWriter] = useState(true);

  useEffect(() => {
    if (!owner) return;
    let disposed = false;
    const channel = typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(`studycommander-main-writer:${owner.normalize('NFKC')}`);

    const check = (announce = false) => {
      const active = ensureMainStateWriterLease(owner);
      if (disposed) return;
      setIsWriter(active);
      if (active && !wasWriter.current) {
        if (announce) toast('この画面がクラウド保存を引き継ぎました');
        retrySync();
        channel?.postMessage({ type: 'writer-claimed' });
      }
      wasWriter.current = active;
    };

    check(false);
    const heartbeat = window.setInterval(() => check(true), MAIN_STATE_WRITER_HEARTBEAT_MS);
    const onFocus = () => check(true);
    const onStorage = () => {
      const active = hasMainStateWriterLease(owner);
      setIsWriter(active);
      wasWriter.current = active;
      if (!active) window.setTimeout(() => check(true), 120);
    };
    const onMessage = () => onStorage();
    const release = () => {
      releaseMainStateWriterLease(owner);
      channel?.postMessage({ type: 'writer-released' });
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', release);
    channel?.addEventListener('message', onMessage);
    return () => {
      disposed = true;
      window.clearInterval(heartbeat);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', release);
      channel?.removeEventListener('message', onMessage);
      release();
      channel?.close();
    };
  }, [owner, retrySync, toast]);

  if (!owner || isWriter) return null;
  return (
    <div className="toast undo-notice" role="status">
      別の画面がクラウド保存中です。この画面の変更は端末へ保持し、担当交代後に同期します
    </div>
  );
}
