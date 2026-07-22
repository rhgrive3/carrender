const INSTALL_KEY = '__studyCommanderRecordLogAccessibilityGuard';
const GENERATED_SELECTOR = '[data-record-log-a11y-generated]';

type GuardWindow = Window & { [INSTALL_KEY]?: () => void };

let generatedId = 0;

function text(element: Element | null): string {
  return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function semanticRangeText(value: string): string {
  return value
    .replace(/🔥\s*([1-5])/gu, '集中度 $1')
    .replace(/\s*・\s*/gu, '、')
    .trim();
}

function ensureHiddenText(button: HTMLButtonElement, kind: string, id: string, value: string): HTMLElement {
  let node = button.querySelector<HTMLElement>(`[data-record-log-a11y-generated="${kind}"]`);
  if (!node) {
    node = document.createElement('span');
    node.className = 'sr-only';
    node.dataset.recordLogA11yGenerated = kind;
    button.appendChild(node);
  }
  node.id = id;
  if (node.textContent !== value) node.textContent = value;
  return node;
}

function normalizeButton(button: HTMLButtonElement, dateLabel: string): void {
  const title = button.querySelector<HTMLElement>('.task-title');
  if (!title) return;

  const subject = text(button.querySelector('.subject-chip')) || '削除済みの科目';
  const source = text(button.querySelector('.task-type-chip')) || '入力方法不明';
  const range = semanticRangeText(text(button.querySelector('.task-range'))) || '学習内容の詳細なし';
  const hasMemo = Boolean(text(button.querySelector('.task-main > .faint.mt-8')));
  const signature = JSON.stringify([dateLabel, text(title), subject, source, range, hasMemo]);

  const currentOperation = button.querySelector<HTMLElement>('[data-record-log-a11y-generated="operation"]');
  const currentDescription = button.querySelector<HTMLElement>('[data-record-log-a11y-generated="description"]');
  if (
    button.dataset.recordLogA11ySignature === signature
    && currentOperation
    && currentDescription
    && !button.hasAttribute('aria-label')
  ) return;

  const identity = button.dataset.recordLogA11yId ?? `record-log-entry-${++generatedId}`;
  button.dataset.recordLogA11yId = identity;
  button.dataset.recordLogA11ySignature = signature;

  const titleId = title.id || `${identity}-title`;
  title.id = titleId;
  const operation = ensureHiddenText(button, 'operation', `${identity}-operation`, '記録を編集');
  const description = ensureHiddenText(
    button,
    'description',
    `${identity}-description`,
    [dateLabel || '学習日不明', subject, source, range, hasMemo ? 'メモあり' : ''].filter(Boolean).join('、'),
  );

  button.removeAttribute('aria-label');
  button.setAttribute('aria-labelledby', `${titleId} ${operation.id}`);
  button.setAttribute('aria-describedby', description.id);
}

export function normalizeRecordLogAccessibility(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('.record-log-list').forEach((list) => {
    let dateLabel = '';
    for (const child of list.children) {
      if (child.matches('.row.spread')) {
        dateLabel = text(child.querySelector('span'));
        continue;
      }
      if (child instanceof HTMLButtonElement && child.matches('.session-log-button')) {
        normalizeButton(child, dateLabel);
      }
    }
  });
}

export function installRecordLogAccessibilityGuard(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  const guardWindow = window as GuardWindow;
  if (guardWindow[INSTALL_KEY]) return guardWindow[INSTALL_KEY]!;

  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      normalizeRecordLogAccessibility();
    });
  };

  schedule();
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-label'],
  });

  const cleanup = () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    document.querySelectorAll(GENERATED_SELECTOR).forEach((node) => node.remove());
    document.querySelectorAll<HTMLElement>('.session-log-button[data-record-log-a11y-id]').forEach((button) => {
      button.removeAttribute('aria-labelledby');
      button.removeAttribute('aria-describedby');
      delete button.dataset.recordLogA11yId;
      delete button.dataset.recordLogA11ySignature;
    });
    delete guardWindow[INSTALL_KEY];
  };

  guardWindow[INSTALL_KEY] = cleanup;
  return cleanup;
}
