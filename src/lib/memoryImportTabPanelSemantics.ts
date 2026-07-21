const INSTALL_KEY = '__studyCommanderMemoryImportTabPanelSemantics';
const GENERATED_PANEL_ATTRIBUTE = 'data-generated-memory-tab-panel';

type GuardWindow = Window & { [INSTALL_KEY]?: () => void };

interface Mapping {
  tabId: string;
  panelId: string;
  panelSelector: string;
}

const MAPPINGS: Mapping[] = [
  { tabId: 'memory-import-tab-import', panelId: 'memory-import-panel-import', panelSelector: '.memory-import-layout' },
  { tabId: 'memory-import-tab-export', panelId: 'memory-import-panel-export', panelSelector: '.memory-export-grid' },
  { tabId: 'memory-import-tab-ai', panelId: 'memory-import-panel-ai', panelSelector: '.memory-ai-import' },
];

function directTabs(tablist: Element): HTMLElement[] {
  return [...tablist.children].filter((child): child is HTMLElement => (
    child instanceof HTMLElement && child.getAttribute('role') === 'tab'
  ));
}

function ensurePlaceholder(container: HTMLElement, mapping: Mapping): void {
  if (container.querySelector(`#${mapping.panelId}`)) return;
  const placeholder = document.createElement('div');
  placeholder.id = mapping.panelId;
  placeholder.hidden = true;
  placeholder.setAttribute(GENERATED_PANEL_ATTRIBUTE, 'true');
  placeholder.setAttribute('role', 'tabpanel');
  placeholder.setAttribute('aria-labelledby', mapping.tabId);
  container.append(placeholder);
}

export function normalizeMemoryImportTabPanels(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('.memory-import').forEach((container) => {
    const tablist = container.querySelector<HTMLElement>('.memory-import-tabs[role="tablist"]');
    if (!tablist) return;
    const tabs = directTabs(tablist);

    MAPPINGS.forEach((mapping, index) => {
      const tab = tabs[index];
      if (!tab) return;
      tab.id = mapping.tabId;
      tab.setAttribute('aria-controls', mapping.panelId);

      const actualPanel = container.querySelector<HTMLElement>(mapping.panelSelector);
      const stalePlaceholder = container.querySelector<HTMLElement>(`#${mapping.panelId}[${GENERATED_PANEL_ATTRIBUTE}]`);
      if (!actualPanel) {
        ensurePlaceholder(container, mapping);
        return;
      }

      if (stalePlaceholder && stalePlaceholder !== actualPanel) stalePlaceholder.remove();
      actualPanel.id = mapping.panelId;
      actualPanel.setAttribute('role', 'tabpanel');
      actualPanel.setAttribute('aria-labelledby', mapping.tabId);
      actualPanel.tabIndex = 0;
      actualPanel.removeAttribute(GENERATED_PANEL_ATTRIBUTE);
    });
  });
}

export function installMemoryImportTabPanelSemantics(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  const guardWindow = window as GuardWindow;
  if (guardWindow[INSTALL_KEY]) return guardWindow[INSTALL_KEY]!;

  let frame = 0;
  const normalize = () => {
    frame = 0;
    normalizeMemoryImportTabPanels(document);
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
    attributeFilter: ['aria-selected'],
  });

  const cleanup = () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    delete guardWindow[INSTALL_KEY];
  };
  guardWindow[INSTALL_KEY] = cleanup;
  return cleanup;
}
