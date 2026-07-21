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

function choicesOf(group: Element, role: ChoiceRole): HTMLElement[] {
  const groupSelector = groupSelectorFor(role);
  return [...group.querySelectorAll<HTMLElement>(choiceSelectorFor(role))]
    .filter((choice) => choice.closest(groupSelector) === group && !choice.hasAttribute('disabled'));
}

function normalizeGroup(group: Element, role: ChoiceRole): void {
  const choices = choicesOf(group, role);
  if (choices.length === 0) return;
  const selectedAttribute = selectedAttributeFor(role);
  const selected = choices.find((choice) => choice.getAttribute(selectedAttribute) === 'true') ?? choices[0];
  for (const choice of choices) choice.tabIndex = choice === selected ? 0 : -1;
}

function moveSelection(event: KeyboardEvent, choice: HTMLElement, role: ChoiceRole): void {
  const group = choice.closest(groupSelectorFor(role));
  if (!group) return;
  const choices = choicesOf(group, role);
  const currentIndex = choices.indexOf(choice);
  if (currentIndex < 0 || choices.length === 0) return;

  let nextIndex: number | null = null;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % choices.length;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + choices.length) % choices.length;
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = choices.length - 1;
  if (nextIndex === null) return;

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
    attributeFilter: ['aria-checked', 'aria-selected', 'disabled', 'role'],
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
