const WEEK_TASK_SELECTOR = '.week-grid .day-column > button.mini-block';
const DETAIL_TASK_SELECTOR = '.day-detail-panel .task-detail-line';
const INSTALL_KEY = '__studyCommanderCompletedTaskAccessibility';

type GuardWindow = Window & { [INSTALL_KEY]?: () => void };

type CompletedTaskSummary = {
  title: string;
  detail: string;
  dateLabel: string;
};

function normalizedText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function isCompletedWeekTask(button: HTMLButtonElement): boolean {
  return button.disabled && (button.getAttribute('aria-label')?.includes('完了済み') ?? false);
}

function isCompletedDetailTask(line: HTMLElement): boolean {
  const actions = [...line.querySelectorAll<HTMLButtonElement>('.task-line-actions button')];
  return actions.length >= 3 && actions.slice(0, 3).every((button) => button.disabled);
}

function weekTaskSummary(button: HTMLButtonElement): CompletedTaskSummary {
  const dayHeader = button.closest('.day-column')?.querySelector<HTMLElement>('.day-column-header');
  const label = normalizedText(button.getAttribute('aria-label'))
    .replace(/\s*\(完了済み\)\s*$/, '')
    .replace(/\s*完了済み\s*$/, '');
  const visible = normalizedText(button.textContent);
  return {
    title: label || visible || '完了済みタスク',
    detail: visible || label || '詳細なし',
    dateLabel: normalizedText(dayHeader?.getAttribute('aria-label') ?? dayHeader?.textContent)
      .replace(/の日別詳細を開く$/, ''),
  };
}

function detailTaskSummary(line: HTMLElement): CompletedTaskSummary {
  const main = line.querySelector<HTMLButtonElement>('.task-line-main');
  const title = normalizedText(main?.querySelector('b')?.textContent) || '完了済みタスク';
  const detail = normalizedText(main?.querySelector('span')?.textContent) || '詳細なし';
  const panel = line.closest('.day-detail-panel');
  const dateLabel = normalizedText(panel?.firstElementChild?.textContent);
  return { title, detail, dateLabel };
}

function openRecordsScreen(): void {
  const candidates = [...document.querySelectorAll<HTMLButtonElement>('.bottom-nav button')];
  const recordButton = candidates.find((button) => {
    const label = normalizedText(button.getAttribute('aria-label') ?? button.textContent);
    return label.includes('記録');
  });
  recordButton?.click();
}

function openCompletedTaskDialog(summary: CompletedTaskSummary, returnFocus: HTMLElement): void {
  document.getElementById('completed-task-readonly-dialog')?.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'completed-task-readonly-dialog';
  backdrop.className = 'sheet-backdrop';
  backdrop.setAttribute('role', 'presentation');

  const dialog = document.createElement('section');
  dialog.className = 'sheet completed-task-readonly-sheet';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'completed-task-readonly-title');
  dialog.setAttribute('aria-describedby', 'completed-task-readonly-detail');

  const header = document.createElement('div');
  header.className = 'sheet-header';

  const heading = document.createElement('h2');
  heading.id = 'completed-task-readonly-title';
  heading.textContent = '完了済みタスク';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'icon-btn';
  closeButton.setAttribute('aria-label', '完了済みタスクの詳細を閉じる');
  closeButton.textContent = '×';

  header.append(heading, closeButton);

  const body = document.createElement('div');
  body.className = 'sheet-body';

  const status = document.createElement('p');
  status.className = 'status-banner';
  status.textContent = 'このタスクは完了済みのため、計画からは変更できません。';

  const content = document.createElement('div');
  content.id = 'completed-task-readonly-detail';
  content.className = 'card';
  content.style.padding = '13px';

  const taskTitle = document.createElement('div');
  taskTitle.style.fontWeight = '800';
  taskTitle.textContent = summary.title;

  const taskDetail = document.createElement('div');
  taskDetail.className = 'muted';
  taskDetail.textContent = summary.detail;

  content.append(taskTitle, taskDetail);
  if (summary.dateLabel) {
    const date = document.createElement('div');
    date.className = 'muted';
    date.textContent = `日付: ${summary.dateLabel}`;
    content.append(date);
  }

  const actions = document.createElement('div');
  actions.className = 'row mt-16';
  actions.setAttribute('role', 'group');
  actions.setAttribute('aria-label', '完了済みタスクの操作');

  const recordsButton = document.createElement('button');
  recordsButton.type = 'button';
  recordsButton.className = 'btn btn-secondary';
  recordsButton.textContent = '学習ログを開く';

  const doneButton = document.createElement('button');
  doneButton.type = 'button';
  doneButton.className = 'btn btn-primary';
  doneButton.textContent = '閉じる';

  actions.append(recordsButton, doneButton);
  body.append(status, content, actions);
  dialog.append(header, body);
  backdrop.append(dialog);
  document.body.append(backdrop);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    backdrop.remove();
    requestAnimationFrame(() => returnFocus.focus());
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close();
  };

  closeButton.addEventListener('click', close);
  doneButton.addEventListener('click', close);
  recordsButton.addEventListener('click', () => {
    close();
    requestAnimationFrame(openRecordsScreen);
  });
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKeyDown, true);
  requestAnimationFrame(() => doneButton.focus());
}

function normalizeWeekTask(button: HTMLButtonElement): void {
  if (!isCompletedWeekTask(button) && button.dataset.completedTaskReadable !== 'true') return;
  button.disabled = false;
  button.type = 'button';
  button.dataset.completedTaskReadable = 'true';
  button.setAttribute('aria-haspopup', 'dialog');
  const label = normalizedText(button.getAttribute('aria-label'))
    .replace(/\s*\(完了済み\)\s*$/, '')
    .replace(/\s*完了済み\s*$/, '');
  button.setAttribute('aria-label', `${label || normalizedText(button.textContent) || 'タスク'}。完了済み、詳細を開く`);
}

function normalizeDetailTask(line: HTMLElement): void {
  if (!isCompletedDetailTask(line)) return;
  const main = line.querySelector<HTMLButtonElement>('.task-line-main');
  if (!main) return;
  main.type = 'button';
  main.dataset.completedTaskReadable = 'true';
  main.setAttribute('aria-haspopup', 'dialog');
  const title = normalizedText(main.querySelector('b')?.textContent) || 'タスク';
  const detail = normalizedText(main.querySelector('span')?.textContent);
  main.setAttribute('aria-label', `${title}。${detail}。完了済み、詳細を開く`);
}

function normalizeAll(): void {
  document.querySelectorAll<HTMLButtonElement>(WEEK_TASK_SELECTOR).forEach(normalizeWeekTask);
  document.querySelectorAll<HTMLElement>(DETAIL_TASK_SELECTOR).forEach(normalizeDetailTask);
}

export function installCompletedTaskAccessibility(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  const guardWindow = window as GuardWindow;
  if (guardWindow[INSTALL_KEY]) return guardWindow[INSTALL_KEY]!;

  let frame = 0;
  const scheduleNormalize = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      normalizeAll();
    });
  };

  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const weekButton = target.closest<HTMLButtonElement>(`${WEEK_TASK_SELECTOR}[data-completed-task-readable="true"]`);
    if (weekButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openCompletedTaskDialog(weekTaskSummary(weekButton), weekButton);
      return;
    }

    const detailButton = target.closest<HTMLButtonElement>('.task-detail-line .task-line-main[data-completed-task-readable="true"]');
    if (!detailButton) return;
    const line = detailButton.closest<HTMLElement>(DETAIL_TASK_SELECTOR);
    if (!line) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openCompletedTaskDialog(detailTaskSummary(line), detailButton);
  };

  normalizeAll();
  document.addEventListener('click', onClick, true);
  const observer = new MutationObserver(scheduleNormalize);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['disabled', 'aria-label'],
  });

  const cleanup = () => {
    document.removeEventListener('click', onClick, true);
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    document.getElementById('completed-task-readonly-dialog')?.remove();
    delete guardWindow[INSTALL_KEY];
  };
  guardWindow[INSTALL_KEY] = cleanup;
  return cleanup;
}
