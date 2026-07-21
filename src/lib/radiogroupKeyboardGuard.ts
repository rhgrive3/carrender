const RADIOGROUP_SELECTOR = '[role="radiogroup"]';
const RADIO_SELECTOR = '[role="radio"]';
const INSTALL_KEY = '__studyCommanderRadiogroupKeyboardGuard';

type GuardWindow = Window & { [INSTALL_KEY]?: () => void };

function radiosOf(group: Element): HTMLElement[] {
  return [...group.querySelectorAll<HTMLElement>(RADIO_SELECTOR)]
    .filter((radio) => radio.closest(RADIOGROUP_SELECTOR) === group && !radio.hasAttribute('disabled'));
}

function normalizeGroup(group: Element): void {
  const radios = radiosOf(group);
  if (radios.length === 0) return;
  const selected = radios.find((radio) => radio.getAttribute('aria-checked') === 'true') ?? radios[0];
  for (const radio of radios) radio.tabIndex = radio === selected ? 0 : -1;
}

function moveSelection(event: KeyboardEvent, radio: HTMLElement): void {
  const group = radio.closest(RADIOGROUP_SELECTOR);
  if (!group) return;
  const radios = radiosOf(group);
  const currentIndex = radios.indexOf(radio);
  if (currentIndex < 0 || radios.length === 0) return;

  let nextIndex: number | null = null;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % radios.length;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + radios.length) % radios.length;
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = radios.length - 1;
  if (nextIndex === null) return;

  event.preventDefault();
  const next = radios[nextIndex];
  next.click();
  requestAnimationFrame(() => {
    normalizeGroup(group);
    next.focus();
  });
}

/**
 * Repairs custom radiogroups that expose ARIA roles but omit the keyboard
 * interaction contract. Fully implemented components remain unchanged except
 * for receiving the same roving-tabindex normalization after rerenders.
 */
export function installRadiogroupKeyboardGuard(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  const guardWindow = window as GuardWindow;
  if (guardWindow[INSTALL_KEY]) return guardWindow[INSTALL_KEY]!;

  let frame = 0;
  const normalizeAll = () => {
    frame = 0;
    document.querySelectorAll(RADIOGROUP_SELECTOR).forEach(normalizeGroup);
  };
  const scheduleNormalize = () => {
    if (frame) return;
    frame = requestAnimationFrame(normalizeAll);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'radio') return;
    moveSelection(event, target);
  };

  normalizeAll();
  document.addEventListener('keydown', onKeyDown);
  const observer = new MutationObserver(scheduleNormalize);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-checked', 'disabled', 'role'],
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
