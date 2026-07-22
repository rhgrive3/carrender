import { registerSW } from 'virtual:pwa-register';

const TIMER_KEY = 'studycommander_timer_v1';
const NOTICE_ID = 'service-worker-update-notice';
const EDITOR_SELECTOR = '.memory-editor, .memory-bulk-editor';
const STUDY_SELECTOR = '.memory-study-stage, .memory-study-shell, .memory-study[aria-busy]';

type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

let updateServiceWorker: UpdateServiceWorker | null = null;
let updateAvailable = false;
let observer: MutationObserver | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function hasUnsavedInput(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

function timerIsActive(): boolean {
  try {
    return Boolean(localStorage.getItem(TIMER_KEY));
  } catch {
    return false;
  }
}

export function serviceWorkerUpdateBlockers(): string[] {
  if (typeof window === 'undefined' || typeof document === 'undefined') return [];
  const blockers: string[] = [];
  if (hasUnsavedInput() || document.querySelector(EDITOR_SELECTOR)) blockers.push('編集中');
  if (timerIsActive()) blockers.push('タイマー計測中');
  if (document.querySelector(STUDY_SELECTOR)) blockers.push('暗記学習中');
  return [...new Set(blockers)];
}

function removeNotice(): void {
  document.getElementById(NOTICE_ID)?.remove();
}

function renderNotice(): void {
  if (!updateAvailable || typeof document === 'undefined') {
    removeNotice();
    return;
  }

  const blockers = serviceWorkerUpdateBlockers();
  let notice = document.getElementById(NOTICE_ID) as HTMLDivElement | null;
  if (!notice) {
    notice = document.createElement('div');
    notice.id = NOTICE_ID;
    notice.className = 'toast undo-notice service-worker-update-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    document.body.appendChild(notice);
  }

  const message = blockers.length > 0
    ? `更新を待機しています（${blockers.join('・')}）`
    : '新しいバージョンを利用できます';
  notice.replaceChildren();
  const text = document.createElement('span');
  text.textContent = message;
  notice.appendChild(text);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-secondary';
  button.textContent = blockers.length > 0 ? '操作終了後に更新' : '今すぐ更新';
  button.disabled = blockers.length > 0;
  button.setAttribute('aria-label', blockers.length > 0 ? `${message}。操作終了後に更新できます` : '新しいバージョンへ更新');
  button.addEventListener('click', () => {
    if (serviceWorkerUpdateBlockers().length > 0 || !updateServiceWorker) {
      renderNotice();
      return;
    }
    button.disabled = true;
    button.textContent = '更新中…';
    void updateServiceWorker(true);
  });
  notice.appendChild(button);
}

function watchSafeUpdateTiming(): void {
  if (observer || typeof document === 'undefined') return;
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderNotice();
    });
  };
  observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy', 'class'] });
  window.addEventListener('storage', schedule);
  document.addEventListener('visibilitychange', schedule);
  if (refreshTimer === null) refreshTimer = setInterval(schedule, 2_000);
}

/**
 * Registers the worker immediately, but never applies a waiting version by
 * itself. Updates are exposed to the user and applied only when no editor,
 * active timer, or memory-study session can be interrupted.
 */
export function registerSafeServiceWorkerUpdate(): void {
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateAvailable = true;
      watchSafeUpdateTiming();
      renderNotice();
    },
  });
}

/**
 * Reserved for an explicitly identified incompatible release. Normal updates
 * must use the safe user-controlled path above; no automatic critical rule is
 * currently enabled.
 */
export function applyCriticalServiceWorkerUpdate(): Promise<void> {
  if (!updateServiceWorker) return Promise.resolve();
  return updateServiceWorker(true);
}
