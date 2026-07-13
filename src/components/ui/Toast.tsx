import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export type ToastTone = 'success' | 'warning' | 'error' | 'info';
const ToastContext = createContext<(msg: string, tone?: ToastTone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [tone, setTone] = useState<ToastTone>('info');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((m: string, requested?: ToastTone) => {
    setMsg(m);
    setTone(requested ?? (
      /保存しましたが|一部|競合|未配置|判定未完了|確定でき/.test(m) ? 'warning'
        : /失敗|できません|不正|入力内容|以前にしてください|以降にしてください|未来日/.test(m) ? 'error'
          : /保存|更新|追加|削除|完了|戻/.test(m) ? 'success'
            : 'info'
    ));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2400);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {msg && (
        <div className={`toast toast-${tone}`} role={tone === 'error' ? 'alert' : 'status'} aria-live="polite">
          {msg}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
