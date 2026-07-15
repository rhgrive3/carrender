import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Info, X, XCircle } from 'lucide-react';
import {
  EMPTY_TOAST_QUEUE,
  advanceToast,
  createToastItem,
  enqueueToast,
  type ToastInput,
  type ToastTone,
} from './toastModel';
import './Toast.css';

export type { ToastInput, ToastRequest, ToastTone } from './toastModel';
export type ToastShow = (message: ToastInput, tone?: ToastTone) => void;

const ToastContext = createContext<ToastShow>(() => {});

function ToneIcon({ tone }: { tone: ToastTone }) {
  if (tone === 'success') return <CheckCircle2 size={17} strokeWidth={2.4} aria-hidden="true" />;
  if (tone === 'warning') return <AlertTriangle size={17} strokeWidth={2.4} aria-hidden="true" />;
  if (tone === 'error') return <XCircle size={17} strokeWidth={2.4} aria-hidden="true" />;
  return <Info size={17} strokeWidth={2.4} aria-hidden="true" />;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useReducer(
    (state: typeof EMPTY_TOAST_QUEUE, event: { type: 'enqueue'; item: ReturnType<typeof createToastItem> } | { type: 'advance' }) => (
      event.type === 'enqueue' ? enqueueToast(state, event.item) : advanceToast(state)
    ),
    EMPTY_TOAST_QUEUE,
  );
  const [expanded, setExpanded] = useState(false);
  const [paused, setPaused] = useState(false);
  const idSequence = useRef(0);

  const show = useCallback<ToastShow>((input, requestedTone) => {
    idSequence.current += 1;
    setQueue({ type: 'enqueue', item: createToastItem(input, requestedTone, `toast-${idSequence.current}`) });
  }, []);

  const dismiss = useCallback(() => setQueue({ type: 'advance' }), []);
  const active = queue.active;

  useEffect(() => {
    setExpanded(false);
    setPaused(false);
  }, [active?.id]);

  useEffect(() => {
    if (!active || expanded || paused) return;
    const timer = window.setTimeout(dismiss, active.durationMs);
    return () => window.clearTimeout(timer);
  }, [active, dismiss, expanded, paused]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {active && (
        <div className="app-toast-region" aria-label="通知">
          <section
            className={`app-toast app-toast-${active.tone} ${expanded ? 'app-toast-expanded' : ''}`}
            role={active.tone === 'error' ? 'alert' : 'status'}
            aria-live={active.tone === 'error' ? 'assertive' : 'polite'}
            aria-atomic="true"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocusCapture={() => setPaused(true)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
            }}
          >
            <span className="app-toast-icon">
              <ToneIcon tone={active.tone} />
            </span>
            <div className="app-toast-body">
              <div className="app-toast-title">{active.title}</div>
              {expanded && active.detail && <div className="app-toast-detail">{active.detail}</div>}
              <div className="app-toast-controls">
                {active.detail && (
                  <button type="button" className="app-toast-link" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
                    {expanded ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
                    {expanded ? '詳細を閉じる' : '詳細'}
                  </button>
                )}
                {active.action && (
                  <button
                    type="button"
                    className="app-toast-action"
                    onClick={() => {
                      try {
                        active.action?.onClick();
                      } finally {
                        dismiss();
                      }
                    }}
                  >
                    {active.action.label}
                  </button>
                )}
                {queue.queued.length > 0 && <span className="app-toast-queue-count">あと{queue.queued.length}件</span>}
              </div>
            </div>
            <button type="button" className="app-toast-close" aria-label="通知を閉じる" onClick={dismiss}>
              <X size={16} strokeWidth={2.3} aria-hidden="true" />
            </button>
          </section>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
