const SESSION_LOG_SELECTOR = '.session-log-button';

function textOf(element: Element | null): string {
  return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

export function sessionLogAccessibleLabel(button: HTMLElement): string {
  const title = textOf(button.querySelector('.task-title')) || '学習';
  const subject = textOf(button.querySelector('.subject-chip')) || '科目不明';
  const source = textOf(button.querySelector('.task-type-chip')) || '入力方法不明';
  const summary = textOf(button.querySelector('.task-range')) || '学習内容不明';
  const hasMemo = Boolean(button.querySelector('.task-main > .faint.mt-8'));

  return [title, subject, summary, source, hasMemo ? 'メモあり' : '', '記録を編集']
    .filter(Boolean)
    .join('、');
}

function updateSessionLogButton(button: HTMLElement) {
  const label = sessionLogAccessibleLabel(button);
  if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
}

export function installSessionLogAccessibilityGuard(): () => void {
  let scheduledFrame = 0;

  const updateAll = () => {
    scheduledFrame = 0;
    document.querySelectorAll<HTMLElement>(SESSION_LOG_SELECTOR).forEach(updateSessionLogButton);
  };

  const scheduleUpdate = () => {
    if (scheduledFrame) return;
    scheduledFrame = requestAnimationFrame(updateAll);
  };

  updateAll();
  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-label'],
  });

  return () => {
    observer.disconnect();
    if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
  };
}
