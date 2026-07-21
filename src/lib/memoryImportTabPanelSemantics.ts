const INSTALL_KEY = '__studyCommanderMemoryImportTabPanelGuard';
const GENERATED_PANEL_ATTRIBUTE = 'data-generated-memory-import-panel';

type GuardWindow = Window & { [INSTALL_KEY]?: () => void };

interface MemoryImportTabMapping {
  label: string;
  tabId: string;
  panelId: string;
  panelSelector: string;
}

const MAPPINGS: readonly MemoryImportTabMapping[] = [
  { label: '取込', tabId: 'memory-import-tab-import', panelId: 'memory-import-panel-import', panelSelector: '.memory-import-layout' },
  { label: '出力', tabId: 'memory-import-tab-export', panelId: 'memory-import-panel-export', panelSelector: '.memory-export-grid' },
  { label: 'AI差分', tabId: 'memory-import-tab-ai', panelId: 'memory-import-panel-ai', panelSelector: '.memory-ai-import' },
];

function tabByLabel(tablist: Element, label: string): HTMLElement | undefined {
  return [...tablist.querySelectorAll<HTMLElement>(':scope > [role="tab"]')]
    .find((tab) => tab.textContent?.trim() === label);
}

function ensurePlaceholder(root: HTMLElement, mapping: MemoryImportTabMapping): HTMLElement {
  const existing = root.querySelector<HTMLElement>(`#${mapping.panelId}[${GENERATED_PANEL_ATTRIBUTE}]`);
  if (existing) return existing;
  const placeholder = document.createElement('div');
  placeholder.id = mapping.panelId;
  placeholder.hidden = true;
  placeholder.setAttribute(GENERATED_PANEL_ATTRIBUTE, 'true');
  placeholder.setAttribute('role', 'tabpanel');
  placeholder.setAttribute('aria-labelledby', mapping.tabId);
  root.append(placeholder);
  return placeholder;
}

export function connectMemoryImportTabsToPanels(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('.memory-import').forEach((screen) => {
    const tablist = screen.querySelector<HTMLElement>('.memory-import-tabs[role="tablist"]');
    if (!tablist) return;

    for (const mapping of MAPPINGS) {
      const tab = tabByLabel(tablist, mapping.label);
      if (!tab) continue;
      tab.id = mapping.tabId;
      tab.setAttribute('aria-controls', mapping.panelId);

      const actualPanel = screen.querySelector<HTMLElement>(mapping.panelSelector);
      const placeholder = screen.querySelector<HTMLElement>(`#${mapping.panelId}[${GENERATED_PANEL_ATTRIBUTE}]`);
      if (!actualPanel) {
        ensurePlaceholder(screen, mapping);
        continue;
      }
      if (placeholder && placeholder !== actualPanel) placeholder.remove();
      actualPanel.id = mapping.panelId;
      actualPanel.setAttribute('role', 'tabpanel');
      actualPanel.setAttribute('aria-labelledby', mapping.tabId);
      actualPanel.tabIndex = 0;
      actualPanel.removeAttribute(GENERATED_PANEL_ATTRIBUTE);
    }
  });
}

/** Reactの条件描画後も暗記取込tabとtabpanelの相互参照を維持する。 */
export function installMemoryImportTabPanelSemanticsGuard(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  const guardWindow = window as GuardWindow;
  if (guardWindow[INSTALL_KEY]) return guardWindow[INSTALL_KEY]!;

  let frame = 0;
  const normalize = () => {
    frame = 0;
    connectMemoryImportTabsToPanels(document);
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
