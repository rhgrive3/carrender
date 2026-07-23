import { registerSW } from 'virtual:pwa-register';

const TIMER_KEY = 'studycommander_timer_v1';
const NOTICE_ID = 'service-worker-update-notice';
const EDITOR_SELECTOR = '.memory-editor, .memory-bulk-editor';
const STUDY_SELECTOR = '.memory-study-stage, .memory-study-shell, .memory-study[aria-busy]';

type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

let updateServiceWorker: UpdateServiceWorker | null = null;
let updateAvailable = false;
let updateApplying = false;
let updateError: string | null = null;
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

function updateFailureMessage(caught: unknown): string {
  if (caught instanceof Error && caught.message.trim()) return caught.message.trim();
  return '更新処理に失敗しました';
}

async function applyWaitingUpdate(): Promise<void> {
  const blockers = serviceWorkerUpdateBlockers();
  if (blockers.length > 0 || !updateServiceWorker || updateApplying) {
    renderNotice();
    return;
  }
  updateApplying = true;
  updateError = null;
  renderNotice();
  try {
    await updateServiceWorker(true);
  } catch (caught) {
    updateApplying = false;
    updateError = updateFailureMessage(caught);
    renderNotice();
  }
}

function renderNotice(): void {
  if (!updateAvailable || typeof document === 'undefined') {
    removeNotice();
    return;
  }

  const blockers = serviceWorkerUpdateBlockers();
  const blocked = blockers.length > 0;
  const message = updateError
    ? `更新を適用できませんでした。${updateError}`
    : updateApplying
      ? '新しいバージョンへ更新しています…'
      : blocked
        ? `更新を待機しています（${blockers.join('・')}）`
        : '新しいバージョンを利用できます';
  const buttonLabel = updateApplying
    ? '更新中…'
    : blocked
      ? '操作終了後に更新'
      : updateError
        ? '更新を再試行'
        : '今すぐ更新';
  const disabled = updateApplying || blocked;
  const ariaLabel = blocked
    ? `${message}。操作終了後に更新できます`
    : updateApplying
      ? '新しいバージョンへ更新しています'
      : updateError
        ? '新しいバージョンへの更新を再試行'
        : '新しいバージョンへ更新';
  const role = updateError ? 'alert' : 'status';
  const signature = JSON.stringify({ message, buttonLabel, disabled, ariaLabel, role });

  let notice = document.getElementById(NOTICE_ID) as HTMLDivElement | null;
  if (notice?.dataset.renderSignature === signature) return;
  if (!notice) {
    notice = document.createElement('div');
    notice.id = NOTICE_ID;
    notice.className = 'toast undo-notice service-worker-update-notice';
    notice.setAttribute('aria-live', 'polite');
    document.body.appendChild(notice);
  }
  notice.setAttribute('role', role);
  notice.dataset.renderSignature = signature;

  const text = document.createElement('span');
  text.textContent = message;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-secondary';
  button.textContent = buttonLabel;
  button.disabled = disabled;
  button.setAttribute('aria-label', ariaLabel);
  button.addEventListener('click', () => { void applyWaitingUpdate(); });
  notice.replaceChildren(text, button);
}

function mutationTouchesOnlyNotice(mutation: MutationRecord, notice: HTMLElement | null): boolean {
  if (!notice) return false;
  if (mutation.target === notice || notice.contains(mutation.target)) return true;
  if (mutation.type !== 'childList') return false;
  const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return changedNodes.length > 0 && changedNodes.every((node) => node === notice || notice.contains(node));
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
  observer = new MutationObserver((mutations) => {
    const notice = document.getElementById(NOTICE_ID);
    if (mutations.every((mutation) => mutationTouchesOnlyNotice(mutation, notice))) return;
    schedule();
  });
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
      updateApplying = false;
      updateError = null;
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
