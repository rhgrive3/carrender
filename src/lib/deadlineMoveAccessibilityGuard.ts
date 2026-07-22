const BLOCKED_TITLE = '期限を過ぎるため移動できません';
const GUARDED_ATTR = 'data-deadline-move-accessibility';
const ORIGINAL_LABEL_ATTR = 'data-deadline-move-original-label';

function repairButton(button: HTMLButtonElement) {
  const blocked = button.getAttribute('title') === BLOCKED_TITLE;
  const guarded = button.hasAttribute(GUARDED_ATTR);

  if (blocked) {
    const originalLabel = button.getAttribute(ORIGINAL_LABEL_ATTR)
      ?? button.getAttribute('aria-label')
      ?? '翌日へ移動';
    button.setAttribute(ORIGINAL_LABEL_ATTR, originalLabel);
    button.setAttribute(GUARDED_ATTR, 'true');
    button.disabled = false;
    button.setAttribute('aria-label', `${originalLabel}。${BLOCKED_TITLE}`);
    return;
  }

  if (!guarded) return;
  const originalLabel = button.getAttribute(ORIGINAL_LABEL_ATTR);
  if (originalLabel) button.setAttribute('aria-label', originalLabel);
  button.removeAttribute(GUARDED_ATTR);
  button.removeAttribute(ORIGINAL_LABEL_ATTR);
}

function repairDeadlineMoveButtons(root: ParentNode = document) {
  root.querySelectorAll<HTMLButtonElement>('.task-line-actions .line-icon-btn').forEach(repairButton);
}

export function installDeadlineMoveAccessibilityGuard() {
  if (typeof document === 'undefined') return () => undefined;

  let frame = 0;
  const scheduleRepair = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      repairDeadlineMoveButtons();
    });
  };

  repairDeadlineMoveButtons();
  const observer = new MutationObserver(scheduleRepair);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['disabled', 'title', 'aria-label'],
  });

  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };
}
