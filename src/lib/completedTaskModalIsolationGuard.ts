import { acquireModalIsolation, trapModalTabKey } from '../components/ui/Sheet';

const DIALOG_ID = 'completed-task-readonly-dialog';
const INSTALL_KEY = '__studyCommanderCompletedTaskModalIsolation';

type GuardWindow = Window & { [INSTALL_KEY]?: () => void };

type ActiveModal = {
  backdrop: HTMLElement;
  dialog: HTMLElement;
  restoreIsolation: () => void;
};

function visibleReturnTarget(element: HTMLElement | null): element is HTMLElement {
  return Boolean(
    element?.isConnected
    && !element.closest('[hidden], [inert], [aria-hidden="true"]'),
  );
}

export function installCompletedTaskModalIsolationGuard(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  const guardWindow = window as GuardWindow;
  if (guardWindow[INSTALL_KEY]) return guardWindow[INSTALL_KEY]!;

  let active: ActiveModal | null = null;
  let scheduledFrame = 0;

  const releaseActive = () => {
    if (!active) return;
    const current = active;
    active = null;
    current.restoreIsolation();
  };

  const connectDialog = () => {
    scheduledFrame = 0;
    const backdrop = document.getElementById(DIALOG_ID);
    if (!(backdrop instanceof HTMLElement)) {
      releaseActive();
      return;
    }
    const dialog = backdrop.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
    if (!dialog || active?.backdrop === backdrop) return;

    releaseActive();
    dialog.tabIndex = -1;
    active = {
      backdrop,
      dialog,
      restoreIsolation: acquireModalIsolation(backdrop),
    };
  };

  const scheduleConnect = () => {
    if (scheduledFrame) return;
    scheduledFrame = requestAnimationFrame(connectDialog);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const current = active;
    if (!current || !current.backdrop.isConnected) return;
    if (current.backdrop.hasAttribute('inert')) return;
    trapModalTabKey(event, current.dialog);
  };

  const observer = new MutationObserver(scheduleConnect);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('keydown', onKeyDown, true);
  connectDialog();

  const cleanup = () => {
    document.removeEventListener('keydown', onKeyDown, true);
    observer.disconnect();
    if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
    releaseActive();
    delete guardWindow[INSTALL_KEY];
  };

  guardWindow[INSTALL_KEY] = cleanup;
  return cleanup;
}

export function restoreCompletedTaskDialogFocus(target: HTMLElement | null): void {
  if (!visibleReturnTarget(target)) return;
  requestAnimationFrame(() => {
    if (visibleReturnTarget(target)) target.focus({ preventScroll: true });
  });
}
