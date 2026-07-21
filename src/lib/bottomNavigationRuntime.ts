const BOTTOM_NAV_SELECTOR = 'body > .bottom-nav[data-layout-contract="fixed-bottom-navigation"]';

function setImportantStyle(element: HTMLElement, property: string, value: string) {
  if (element.style.getPropertyValue(property) === value
    && element.style.getPropertyPriority(property) === 'important') return;
  element.style.setProperty(property, value, 'important');
}

export function enforceBottomNavigationRuntimeContract(element: HTMLElement) {
  setImportantStyle(element, 'position', 'fixed');
  setImportantStyle(element, 'top', 'auto');
  setImportantStyle(element, 'right', '0px');
  setImportantStyle(element, 'bottom', '0px');
  setImportantStyle(element, 'left', '0px');
  setImportantStyle(element, 'display', 'flex');
  setImportantStyle(element, 'visibility', 'visible');
  setImportantStyle(element, 'opacity', '1');
  setImportantStyle(element, 'transform', 'none');
  setImportantStyle(element, 'z-index', '50');
}

function findAndEnforceBottomNavigation() {
  const navigation = document.querySelector<HTMLElement>(BOTTOM_NAV_SELECTOR);
  if (navigation) enforceBottomNavigationRuntimeContract(navigation);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  let scheduledFrame = 0;
  const schedule = () => {
    if (scheduledFrame) return;
    scheduledFrame = window.requestAnimationFrame(() => {
      scheduledFrame = 0;
      findAndEnforceBottomNavigation();
    });
  };

  schedule();
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'data-layout-contract'],
  });
  window.addEventListener('pageshow', schedule);
  window.addEventListener('resize', schedule, { passive: true });
  window.visualViewport?.addEventListener('resize', schedule, { passive: true });
  window.visualViewport?.addEventListener('scroll', schedule, { passive: true });
}
