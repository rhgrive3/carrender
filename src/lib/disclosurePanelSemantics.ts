const GENERATED_ATTRIBUTE = 'data-generated-disclosure-panel';
const INSTALL_KEY = '__studyCommanderDisclosurePanelSemantics';

type GuardWindow = Window & { [INSTALL_KEY]?: () => void };

function matchingPanels(container: Element, panelId: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[id]')]
    .filter((element) => element.id === panelId);
}

export function normalizeDisclosurePanels(root: ParentNode = document): void {
  root.querySelectorAll<HTMLButtonElement>('.disclosure-head[aria-controls]').forEach((button) => {
    const panelId = button.getAttribute('aria-controls')?.trim();
    const container = button.closest<HTMLElement>('.disclosure');
    if (!panelId || !container) return;

    const panels = matchingPanels(container, panelId);
    const actual = panels.find((panel) => !panel.hasAttribute(GENERATED_ATTRIBUTE));
    const generated = panels.filter((panel) => panel.hasAttribute(GENERATED_ATTRIBUTE));

    if (actual) {
      generated.forEach((panel) => panel.remove());
      actual.setAttribute('role', 'region');
      actual.setAttribute('aria-labelledby', button.id);
      return;
    }

    const placeholder = generated[0];
    generated.slice(1).forEach((panel) => panel.remove());
    if (placeholder) {
      placeholder.hidden = true;
      placeholder.setAttribute('role', 'region');
      placeholder.setAttribute('aria-labelledby', button.id);
      return;
    }

    const panel = document.createElement('div');
    panel.id = panelId;
    panel.hidden = true;
    panel.setAttribute(GENERATED_ATTRIBUTE, 'true');
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-labelledby', button.id);
    container.append(panel);
  });
}

export function installDisclosurePanelSemantics(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  const guardWindow = window as GuardWindow;
  if (guardWindow[INSTALL_KEY]) return guardWindow[INSTALL_KEY]!;

  let frame = 0;
  const normalize = () => {
    frame = 0;
    normalizeDisclosurePanels(document);
  };
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(normalize);
  };

  normalize();
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-controls'],
  });

  const cleanup = () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    delete guardWindow[INSTALL_KEY];
  };
  guardWindow[INSTALL_KEY] = cleanup;
  return cleanup;
}
