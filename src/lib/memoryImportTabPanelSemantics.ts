const TAB_CONFIG = [
  { label: '取込', tabId: 'memory-import-tab', panelId: 'memory-import-panel', panelSelector: '.memory-import-layout' },
  { label: '出力', tabId: 'memory-export-tab', panelId: 'memory-export-panel', panelSelector: '.memory-export-grid' },
  { label: 'AI差分', tabId: 'memory-ai-tab', panelId: 'memory-ai-panel', panelSelector: '.memory-ai-import' },
] as const;

function connectMemoryImportTabsToPanels(): void {
  const group = document.querySelector('[role="tablist"][aria-label="取込と出力"]');
  if (!group) return;
  const tabs = [...group.querySelectorAll<HTMLElement>('[role="tab"]')];

  for (const config of TAB_CONFIG) {
    const tab = tabs.find((candidate) => candidate.textContent?.trim() === config.label);
    if (!tab) continue;
    tab.id = config.tabId;
    tab.setAttribute('aria-controls', config.panelId);

    const panel = document.querySelector<HTMLElement>(config.panelSelector);
    if (!panel) continue;
    panel.id = config.panelId;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', config.tabId);
  }
}

export function installMemoryImportTabPanelSemanticsGuard(): () => void {
  let scheduledFrame = 0;
  const scheduleConnection = () => {
    if (scheduledFrame) return;
    scheduledFrame = requestAnimationFrame(() => {
      scheduledFrame = 0;
      connectMemoryImportTabsToPanels();
    });
  };

  connectMemoryImportTabsToPanels();
  const observer = new MutationObserver(scheduleConnection);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-selected'],
  });

  return () => {
    observer.disconnect();
    if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
  };
}
