const INSTALL_KEY = '__studyCommanderTabPanelSemanticsGuard';
const GENERATED_PANEL_ATTRIBUTE = 'data-generated-tab-panel';

type GuardWindow = Window & { [INSTALL_KEY]?: () => void };

interface TabPanelMapping {
  tabId: string;
  panelId: string;
  panelSelector: string;
}

const RECORD_VIEW_MAPPINGS: TabPanelMapping[] = [
  { tabId: 'records-tab-overview', panelId: 'records-panel-overview', panelSelector: '.record-overview' },
  { tabId: 'records-tab-log', panelId: 'records-panel-log', panelSelector: '.record-log-view' },
];

const MEMORY_IMPORT_MAPPINGS: TabPanelMapping[] = [
  { tabId: 'memory-import-tab-import', panelId: 'memory-import-panel-import', panelSelector: '.memory-import-layout' },
  { tabId: 'memory-import-tab-export', panelId: 'memory-import-panel-export', panelSelector: '.memory-export-grid' },
  { tabId: 'memory-import-tab-ai', panelId: 'memory-import-panel-ai', panelSelector: '.memory-ai-import' },
];

function directTabs(tablist: Element): HTMLElement[] {
  return [...tablist.children].filter((child): child is HTMLElement => (
    child instanceof HTMLElement && child.getAttribute('role') === 'tab'
  ));
}

function setAttributeIfChanged(element: HTMLElement, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function generatedPanel(container: HTMLElement, mapping: TabPanelMapping): HTMLElement {
  const existing = container.querySelector<HTMLElement>(`#${mapping.panelId}[${GENERATED_PANEL_ATTRIBUTE}]`);
  if (existing) return existing;
  const placeholder = document.createElement('div');
  placeholder.id = mapping.panelId;
  placeholder.hidden = true;
  placeholder.setAttribute(GENERATED_PANEL_ATTRIBUTE, 'true');
  placeholder.setAttribute('role', 'tabpanel');
  placeholder.setAttribute('aria-labelledby', mapping.tabId);
  container.append(placeholder);
  return placeholder;
}

function connectTablist(
  container: HTMLElement,
  tablistSelector: string,
  mappings: readonly TabPanelMapping[],
): void {
  const tablist = container.querySelector<HTMLElement>(tablistSelector);
  if (!tablist) return;
  const tabs = directTabs(tablist);
  mappings.forEach((mapping, index) => {
    const tab = tabs[index];
    if (!tab) return;
    if (tab.id !== mapping.tabId) tab.id = mapping.tabId;
    setAttributeIfChanged(tab, 'aria-controls', mapping.panelId);

    const actualPanel = container.querySelector<HTMLElement>(mapping.panelSelector);
    const stalePlaceholder = container.querySelector<HTMLElement>(`#${mapping.panelId}[${GENERATED_PANEL_ATTRIBUTE}]`);
    if (actualPanel) {
      if (stalePlaceholder && stalePlaceholder !== actualPanel) stalePlaceholder.remove();
      if (actualPanel.id !== mapping.panelId) actualPanel.id = mapping.panelId;
      setAttributeIfChanged(actualPanel, 'role', 'tabpanel');
      setAttributeIfChanged(actualPanel, 'aria-labelledby', mapping.tabId);
      if (actualPanel.tabIndex !== 0) actualPanel.tabIndex = 0;
      actualPanel.removeAttribute(GENERATED_PANEL_ATTRIBUTE);
    } else {
      generatedPanel(container, mapping);
    }
  });
}

function normalizeRecordPeriodChoice(container: HTMLElement): void {
  const group = container.querySelector<HTMLElement>('.record-overview > .segmented[role="tablist"][aria-label="集計期間"], .record-overview > .segmented[role="radiogroup"][aria-label="集計期間"]');
  if (!group) return;
  setAttributeIfChanged(group, 'role', 'radiogroup');
  [...group.children].forEach((child) => {
    if (!(child instanceof HTMLElement)) return;
    const selected = child.getAttribute('aria-selected') === 'true'
      || child.getAttribute('aria-checked') === 'true';
    setAttributeIfChanged(child, 'role', 'radio');
    setAttributeIfChanged(child, 'aria-checked', selected ? 'true' : 'false');
    child.removeAttribute('aria-selected');
    child.removeAttribute('aria-controls');
  });
}

export function normalizeTabPanelSemantics(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('.records-v2').forEach((container) => {
    connectTablist(container, '.record-view-switch[role="tablist"]', RECORD_VIEW_MAPPINGS);
    normalizeRecordPeriodChoice(container);
  });
  root.querySelectorAll<HTMLElement>('.memory-import').forEach((container) => {
    connectTablist(container, '.memory-import-tabs[role="tablist"]', MEMORY_IMPORT_MAPPINGS);
  });
}

/**
 * Reactで条件描画されるタブ領域へ、tab/tabpanelの相互参照を継続的に付与する。
 * 週/月は独立ページではなく同じ集計の表示モードなのでradiogroupとして公開する。
 */
export function installTabPanelSemanticsGuard(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  const guardWindow = window as GuardWindow;
  if (guardWindow[INSTALL_KEY]) return guardWindow[INSTALL_KEY]!;

  let frame = 0;
  const normalize = () => {
    frame = 0;
    normalizeTabPanelSemantics(document);
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
    attributeFilter: ['aria-selected', 'class'],
  });

  const cleanup = () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    delete guardWindow[INSTALL_KEY];
  };
  guardWindow[INSTALL_KEY] = cleanup;
  return cleanup;
}
