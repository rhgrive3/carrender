export type ShellTab = 'today' | 'plan' | 'materials' | 'records' | 'analytics';

export const SHELL_TAB_STORAGE_KEY = 'studycommander:last-shell-tab';

const SHELL_TABS = new Set<ShellTab>(['today', 'plan', 'materials', 'records', 'analytics']);

export function isShellTab(value: unknown): value is ShellTab {
  return typeof value === 'string' && SHELL_TABS.has(value as ShellTab);
}

export function readStoredShellTab(storage: Pick<Storage, 'getItem'> | null | undefined): ShellTab {
  if (!storage) return 'today';
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
