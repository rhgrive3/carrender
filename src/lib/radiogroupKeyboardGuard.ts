const RADIOGROUP_SELECTOR = '[role="radiogroup"]';
const RADIO_SELECTOR = '[role="radio"]';
const TABLIST_SELECTOR = '[role="tablist"]';
const TAB_SELECTOR = '[role="tab"]';
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
 * keyboard interaction contract. Fully implemented React components remain
 * unchanged because their handlers call preventDefault before this guard runs.
 */
export function installRadiogroupKeyboardGuard(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  const guardWindow = window as GuardWindow;
  if (guardWindow[INSTALL_KEY]) return guardWindow[INSTALL_KEY]!;

  let frame = 0;
  const normalizeAll = () => {
    frame = 0;
    document.querySelectorAll(RADIOGROUP_SELECTOR).forEach((group) => normalizeGroup(group, 'radio'));
    document.querySelectorAll(TABLIST_SELECTOR).forEach((group) => normalizeGroup(group, 'tab'));
  };
  const scheduleNormalize = () => {
    if (frame) return;
    frame = requestAnimationFrame(normalizeAll);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    // React components such as Segmented and Rating already implement the
    // complete interaction contract and call preventDefault themselves.
    if (event.defaultPrevented) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
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
    attributeFilter: ['aria-checked', 'aria-selected', 'aria-disabled', 'aria-orientation', 'disabled', 'role'],
  });

  const cleanup = () => {
    document.removeEventListener('keydown', onKeyDown);
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    delete guardWindow[INSTALL_KEY];
  };
  guardWindow[INSTALL_KEY] = cleanup;
  return cleanup;
}
