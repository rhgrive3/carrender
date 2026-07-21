function tabByLabel(group: Element | null, label: string): HTMLElement | undefined {
  if (!group) return undefined;
  return [...group.querySelectorAll<HTMLElement>('[role="tab"]')]
    .find((tab) => tab.textContent?.trim() === label);
}

function connectRecordTabsToPanels(): void {
  const viewTabs = document.querySelector('[role="tablist"][aria-label="記録画面の切替"]');
  const overviewTab = tabByLabel(viewTabs, '集計');
  const logTab = tabByLabel(viewTabs, '学習ログ');
  const overviewPanel = document.querySelector<HTMLElement>('.record-overview');
  const logPanel = document.querySelector<HTMLElement>('.record-log-view');

  if (overviewTab) {
    overviewTab.id = 'records-overview-tab';
    overviewTab.setAttribute('aria-controls', 'records-overview-panel');
  }
  if (logTab) {
    logTab.id = 'records-log-tab';
    logTab.setAttribute('aria-controls', 'records-log-panel');
  }
  if (overviewPanel && overviewTab) {
    overviewPanel.id = 'records-overview-panel';
    overviewPanel.setAttribute('role', 'tabpanel');
    overviewPanel.setAttribute('aria-labelledby', overviewTab.id);
  }
  if (logPanel && logTab) {
    logPanel.id = 'records-log-panel';
    logPanel.setAttribute('role', 'tabpanel');
    logPanel.setAttribute('aria-labelledby', logTab.id);
  }

  const periodTabs = overviewPanel?.querySelector('[role="tablist"][aria-label="集計期間"]') ?? null;
  const weekTab = tabByLabel(periodTabs, '週');
  const monthTab = tabByLabel(periodTabs, '月');
  const selectedPeriodTab = [weekTab, monthTab].find((tab) => tab?.getAttribute('aria-selected') === 'true');
  const weekPanel = overviewPanel?.querySelector<HTMLElement>('.studyplus-chart-card');
  const monthPanel = overviewPanel?.querySelector<HTMLElement>('[data-month-calendar]')?.closest<HTMLElement>('.card');
  const periodPanel = weekPanel ?? monthPanel;
  const selectedPeriod = selectedPeriodTab === monthTab ? 'month' : 'week';
  const periodPanelId = `records-${selectedPeriod}-panel`;

  if (weekTab) {
    weekTab.id = 'records-week-tab';
    weekTab.setAttribute('aria-controls', 'records-week-panel');
  }
  if (monthTab) {
    monthTab.id = 'records-month-tab';
    monthTab.setAttribute('aria-controls', 'records-month-panel');
  }
  if (periodPanel && selectedPeriodTab) {
    periodPanel.id = periodPanelId;
    periodPanel.setAttribute('role', 'tabpanel');
    periodPanel.setAttribute('aria-labelledby', selectedPeriodTab.id);
  }
}

export function installRecordTabPanelSemanticsGuard(): () => void {
  let scheduledFrame = 0;
  const scheduleConnection = () => {
    if (scheduledFrame) return;
    scheduledFrame = requestAnimationFrame(() => {
      scheduledFrame = 0;
      connectRecordTabsToPanels();
    });
  };

  connectRecordTabsToPanels();
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
