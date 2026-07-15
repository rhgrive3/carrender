export type ShellTab = 'today' | 'plan' | 'materials' | 'records' | 'analytics';
export type ShellMaterialsPane = 'materials' | 'memory';

export interface ShellRoute {
  tab: ShellTab;
  materialsPane: ShellMaterialsPane;
}

export const SHELL_TAB_STORAGE_KEY = 'studycommander:last-shell-tab';

const SHELL_TABS = new Set<ShellTab>(['today', 'plan', 'materials', 'records', 'analytics']);

export function isShellTab(value: unknown): value is ShellTab {
  return typeof value === 'string' && SHELL_TABS.has(value as ShellTab);
}

export function readShellRoute(hash: string | null | undefined, fallbackTab: ShellTab = 'today'): ShellRoute {
  const path = (hash ?? '').replace(/^#\/?/, '').split('?')[0];
  const [tabPart, panePart] = path.split('/');
  const tab = isShellTab(tabPart) ? tabPart : fallbackTab;
  return {
    tab,
    materialsPane: tab === 'materials' && panePart === 'memory' ? 'memory' : 'materials',
  };
}

export function shellRouteHref(tab: ShellTab, materialsPane: ShellMaterialsPane = 'materials'): string {
  return `#/${tab}${tab === 'materials' && materialsPane === 'memory' ? '/memory' : ''}`;
}

export function readStoredShellTab(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  online = typeof navigator === 'undefined' || navigator.onLine !== false,
): ShellTab {
  // When the PWA is relaunched offline, Today is the safest recovery surface:
  // it exposes resumable study sessions and pending work without requiring a
  // previously selected feature to finish any network-dependent bootstrap.
  if (!online || !storage) return 'today';
  try {
    const value = storage.getItem(SHELL_TAB_STORAGE_KEY);
    return isShellTab(value) ? value : 'today';
  } catch {
    return 'today';
  }
}

export function storeShellTab(storage: Pick<Storage, 'setItem'> | null | undefined, tab: ShellTab): void {
  if (!storage) return;
  try {
    storage.setItem(SHELL_TAB_STORAGE_KEY, tab);
  } catch {
    // Storage can be unavailable in private browsing or restricted webviews.
  }
}
