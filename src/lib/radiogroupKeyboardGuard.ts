const RADIOGROUP_SELECTOR = '[role="radiogroup"]';
const RADIO_SELECTOR = '[role="radio"]';
const TABLIST_SELECTOR = '[role="tablist"]';
const TAB_SELECTOR = '[role="tab"]';
const PLAN_VIEW_GROUP_SELECTOR = '[aria-label="計画の表示形式"]';
const MEMORY_CARD_FACE_SELECTOR = '.memory-study-card-face';
const INSTALL_KEY = '__studyCommanderRadiogroupKeyboardGuard';

type GuardWindow = Window & { [INSTALL_KEY]?: () => void };
type ChoiceRole = 'radio' | 'tab';

function groupSelectorFor(role: ChoiceRole): string {
  return role === 'radio' ? RADIOGROUP_SELECTOR : TABLIST_SELECTOR;
}

function choiceSelectorFor(role: ChoiceRole): string {
  return role === 'radio' ? RADIO_SELECTOR : TAB_SELECTOR;
}

function selectedAttributeFor(role: ChoiceRole): string {
  return role === 'radio' ? 'aria-checked' : 'aria-selected';
}

function isDisabledChoice(choice: HTMLElement): boolean {
  return choice.hasAttribute('disabled') || choice.getAttribute('aria-disabled') === 'true';
}

function setAttributeIfChanged(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function removeAttributeIfPresent(element: Element, name: string): void {
  if (element.hasAttribute(name)) element.removeAttribute(name);
}

function normalizedText(value: string | null | undefined): string {
  return value?.replace(/\s+/gu, ' ').trim() ?? '';
}

function allChoicesOf(group: Element, role: ChoiceRole): HTMLElement[] {
  const groupSelector = groupSelectorFor(role);
  return [...group.querySelectorAll<HTMLElement>(choiceSelectorFor(role))]
    .filter((choice) => choice.closest(groupSelector) === group);
}

function enabledChoicesOf(group: Element, role: ChoiceRole): HTMLElement[] {
  return allChoicesOf(group, role).filter((choice) => !isDisabledChoice(choice));
}

function normalizeGroup(group: Element, role: ChoiceRole): void {
  const allChoices = allChoicesOf(group, role);
  const choices = allChoices.filter((choice) => !isDisabledChoice(choice));
  for (const choice of allChoices) {
    if (isDisabledChoice(choice)) choice.tabIndex = -1;
  }
  if (choices.length === 0) return;
  const selectedAttribute = selectedAttributeFor(role);
  const selected = choices.find((choice) => choice.getAttribute(selectedAttribute) === 'true') ?? choices[0];
  for (const choice of choices) choice.tabIndex = choice === selected ? 0 : -1;
}

function repairPlanViewGroup(): void {
  const group = document.querySelector<HTMLElement>(PLAN_VIEW_GROUP_SELECTOR);
  if (!group) return;
  setAttributeIfChanged(group, 'role', 'radiogroup');
  setAttributeIfChanged(group, 'aria-orientation', 'horizontal');
  const buttons = [...group.querySelectorAll<HTMLButtonElement>('button')]
    .filter((button) => button.parentElement === group);
  for (const button of buttons) {
    setAttributeIfChanged(button, 'role', 'radio');
    setAttributeIfChanged(button, 'aria-checked', String(button.classList.contains('active')));
    removeAttributeIfPresent(button, 'aria-selected');
  }
}

function textOf(root: Element, selector: string): string {
  return normalizedText(root.querySelector<HTMLElement>(selector)?.innerText);
}

function repairRecordLogButtons(): void {
  for (const list of document.querySelectorAll<HTMLElement>('.record-log-list')) {
    let dateContext = '';
    for (const child of Array.from(list.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (!child.matches('button.session-log-button')) {
        const nextDateContext = normalizedText(child.innerText);
        if (nextDateContext) dateContext = nextDateContext;
        continue;
      }
      const details = [
        dateContext,
        textOf(child, '.task-title'),
        textOf(child, '.subject-chip'),
        textOf(child, '.task-type-chip'),
        textOf(child, '.task-range'),
        textOf(child, '.faint.mt-8'),
      ].filter(Boolean);
      if (details.length > 0) setAttributeIfChanged(child, 'aria-label', `${details.join('、')}。記録を編集`);
    }
  }
}

function repairAchievementBadges(): void {
  for (const grid of document.querySelectorAll<HTMLElement>('.record-achievements .badge-grid')) {
    setAttributeIfChanged(grid, 'role', 'list');
    for (const cell of grid.querySelectorAll<HTMLElement>('.badge-cell')) {
      setAttributeIfChanged(cell, 'role', 'listitem');
      const visible = normalizedText(cell.innerText);
      const description = normalizedText(cell.getAttribute('title'));
      const label = [visible, description].filter(Boolean).join('。');
      if (label) setAttributeIfChanged(cell, 'aria-label', label);

      const progress = cell.querySelector<HTMLElement>('.badge-progress');
      if (!progress) continue;
      removeAttributeIfPresent(progress, 'aria-hidden');
      setAttributeIfChanged(progress, 'role', 'progressbar');
      setAttributeIfChanged(progress, 'aria-valuemin', '0');
      setAttributeIfChanged(progress, 'aria-valuemax', '100');
      const rawWidth = progress.firstElementChild instanceof HTMLElement
        ? Number.parseFloat(progress.firstElementChild.style.width)
        : Number.NaN;
      const value = Number.isFinite(rawWidth) ? Math.max(0, Math.min(100, Math.round(rawWidth))) : 0;
      setAttributeIfChanged(progress, 'aria-valuenow', String(value));
      setAttributeIfChanged(progress, 'aria-valuetext', `${value}%`);
      const badgeTitle = textOf(cell, '.badge-title') || '実績バッジ';
      setAttributeIfChanged(progress, 'aria-label', `${badgeTitle}の進捗`);
    }
  }
}

function movementFor(event: KeyboardEvent, group: Element, role: ChoiceRole): -1 | 0 | 1 | null {
  if (event.key === 'Home') return 0;
  if (event.key === 'End') return 1;
  if (role === 'radio') {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') return 1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') return -1;
    return null;
  }
  const vertical = group.getAttribute('aria-orientation') === 'vertical';
  if (event.key === (vertical ? 'ArrowDown' : 'ArrowRight')) return 1;
  if (event.key === (vertical ? 'ArrowUp' : 'ArrowLeft')) return -1;
  return null;
}

function moveSelection(event: KeyboardEvent, choice: HTMLElement, role: ChoiceRole): void {
  if (isDisabledChoice(choice)) return;
  const group = choice.closest(groupSelectorFor(role));
  if (!group) return;
  const choices = enabledChoicesOf(group, role);
  const currentIndex = choices.indexOf(choice);
  if (currentIndex < 0 || choices.length === 0) return;

  const movement = movementFor(event, group, role);
  if (movement === null) return;
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? choices.length - 1
      : (currentIndex + movement + choices.length) % choices.length;

  event.preventDefault();
  const next = choices[nextIndex];
  next.click();
  requestAnimationFrame(() => {
    normalizeGroup(group, role);
    next.focus();
  });
}

/**
 * Repairs custom radiogroups and tablists that expose ARIA roles but omit the
 * keyboard interaction contract. It also repairs a few server-rendered/runtime
 * accessibility relationships that must survive React conditional rendering.
 */
export function installRadiogroupKeyboardGuard(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  const guardWindow = window as GuardWindow;
  if (guardWindow[INSTALL_KEY]) return guardWindow[INSTALL_KEY]!;

  let frame = 0;
  let memoryFocusFrame = 0;
  const normalizeAll = () => {
    frame = 0;
    repairPlanViewGroup();
    repairRecordLogButtons();
    repairAchievementBadges();
    document.querySelectorAll(RADIOGROUP_SELECTOR).forEach((group) => normalizeGroup(group, 'radio'));
    document.querySelectorAll(TABLIST_SELECTOR).forEach((group) => normalizeGroup(group, 'tab'));
  };
  const scheduleNormalize = () => {
    if (frame) return;
    frame = requestAnimationFrame(normalizeAll);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if ((event.key === 'Enter' || event.key === ' ')
      && target.matches(MEMORY_CARD_FACE_SELECTOR)
      && document.activeElement === target) {
      if (memoryFocusFrame) cancelAnimationFrame(memoryFocusFrame);
      const source = target;
      memoryFocusFrame = requestAnimationFrame(() => {
        memoryFocusFrame = 0;
        if (!source.isConnected || source.getAttribute('aria-hidden') !== 'true') return;
        source.closest('.memory-study-card')
          ?.querySelector<HTMLElement>(`${MEMORY_CARD_FACE_SELECTOR}[aria-hidden="false"]`)
          ?.focus({ preventScroll: true });
      });
    }

    // React components such as Segmented and Rating already implement the
    // complete interaction contract and call preventDefault themselves.
    if (event.defaultPrevented) return;
    const role = target.getAttribute('role');
    if (role !== 'radio' && role !== 'tab') return;
    moveSelection(event, target, role);
  };

  normalizeAll();
  document.addEventListener('keydown', onKeyDown);
  const observer = new MutationObserver(scheduleNormalize);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-checked', 'aria-selected', 'aria-disabled', 'aria-orientation', 'aria-hidden', 'disabled', 'role', 'class'],
  });

  const cleanup = () => {
    document.removeEventListener('keydown', onKeyDown);
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    if (memoryFocusFrame) cancelAnimationFrame(memoryFocusFrame);
    delete guardWindow[INSTALL_KEY];
  };
  guardWindow[INSTALL_KEY] = cleanup;
  return cleanup;
}
