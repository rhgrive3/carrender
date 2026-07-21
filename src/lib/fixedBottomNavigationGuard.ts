const FIXED_NAV_SELECTOR = "body > .bottom-nav[data-layout-contract='fixed-bottom-navigation']";
const INSTALL_KEY = '__studyCommanderFixedBottomNavigationGuard';
const TOLERANCE_PX = 0.75;
const MAX_CORRECTION_PASSES = 3;

interface GuardWindow extends Window {
  [INSTALL_KEY]?: () => void;
}

function visibleViewportBottom(): number {
  const visualHeight = window.visualViewport?.height;
  const visualOffsetTop = window.visualViewport?.offsetTop;
  if (typeof visualHeight === 'number'
    && Number.isFinite(visualHeight)
    && visualHeight > 0
    && typeof visualOffsetTop === 'number'
    && Number.isFinite(visualOffsetTop)) {
    // getBoundingClientRect() is measured in layout-viewport client
    // coordinates. iPadOS may both shrink and move the visual viewport, so the
    // visible lower edge is offsetTop + height rather than height alone.
    return visualOffsetTop + visualHeight;
  }
  return document.documentElement.clientHeight || window.innerHeight;
}

function numericOffset(nav: HTMLElement): number {
  const value = Number(nav.dataset.runtimeBottomOffset ?? '0');
  return Number.isFinite(value) ? value : 0;
}

function applyFixedInvariants(nav: HTMLElement, offset: number): void {
  nav.style.setProperty('position', 'fixed', 'important');
  nav.style.setProperty('inset-block-start', 'auto', 'important');
  nav.style.setProperty('inset-block-end', '0px', 'important');
  nav.style.setProperty('top', 'auto', 'important');
  nav.style.setProperty('bottom', '0px', 'important');
  nav.style.setProperty('left', '0px', 'important');
  nav.style.setProperty('right', '0px', 'important');
  nav.style.setProperty('margin-inline', 'auto', 'important');
  nav.style.setProperty('transform', offset === 0 ? 'none' : `translate3d(0, ${offset}px, 0)`, 'important');
  nav.dataset.runtimeBottomOffset = String(offset);
  nav.dataset.runtimePinned = 'true';
}

/**
 * CSS and a body portal are the primary contract. This guard handles the iPadOS
 * visual-viewport bug where a fixed element can remain above the visible bottom
 * after browser chrome, keyboard, rotation or standalone-PWA viewport changes.
 */
export function installFixedBottomNavigationGuard(): () => void {
  const guardWindow = window as GuardWindow;
  if (guardWindow[INSTALL_KEY]) return guardWindow[INSTALL_KEY]!;

  let frame = 0;
  let correctionPass = 0;
  let observedNav: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | undefined;

  const observeNav = (nav: HTMLElement | null) => {
    if (nav === observedNav) return;
    resizeObserver?.disconnect();
    observedNav = nav;
    if (nav && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => schedule());
      resizeObserver.observe(nav);
    }
  };

  const pin = () => {
    frame = 0;
    const nav = document.querySelector<HTMLElement>(FIXED_NAV_SELECTOR);
    observeNav(nav);
    if (!nav) return;

    const currentOffset = numericOffset(nav);
    applyFixedInvariants(nav, currentOffset);
    const rect = nav.getBoundingClientRect();
    const delta = visibleViewportBottom() - rect.bottom;
    if (Math.abs(delta) <= TOLERANCE_PX) {
      correctionPass = 0;
      return;
    }

    const viewportLimit = Math.max(window.innerHeight, document.documentElement.clientHeight, 1);
    const nextOffset = Math.max(-viewportLimit, Math.min(viewportLimit, currentOffset + delta));
    applyFixedInvariants(nav, Math.abs(nextOffset) <= TOLERANCE_PX ? 0 : nextOffset);
    correctionPass += 1;
    if (correctionPass < MAX_CORRECTION_PASSES) frame = requestAnimationFrame(pin);
    else correctionPass = 0;
  };

  const schedule = () => {
    correctionPass = 0;
    if (!frame) frame = requestAnimationFrame(pin);
  };

  const bodyObserver = new MutationObserver(schedule);
  bodyObserver.observe(document.body, { childList: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
  window.addEventListener('pageshow', schedule);
  document.addEventListener('visibilitychange', schedule);
  window.visualViewport?.addEventListener('resize', schedule, { passive: true });
  window.visualViewport?.addEventListener('scroll', schedule, { passive: true });
  schedule();

  const cleanup = () => {
    if (frame) cancelAnimationFrame(frame);
    bodyObserver.disconnect();
    resizeObserver?.disconnect();
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('orientationchange', schedule);
    window.removeEventListener('pageshow', schedule);
    document.removeEventListener('visibilitychange', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
    delete guardWindow[INSTALL_KEY];
  };
  guardWindow[INSTALL_KEY] = cleanup;
  return cleanup;
}
