const INSTALL_FLAG = Symbol.for('studycommander.safeObjectUrlCleanup');

interface SafeUrlConstructor extends typeof URL {
  [INSTALL_FLAG]?: true;
}

/**
 * WebKit may continue resolving a Blob URL after an anchor click returns.
 * Delay global cleanup slightly so existing export paths cannot invalidate a
 * download before Safari/PWA has consumed the URL.
 */
export function installSafeObjectUrlCleanup(delayMs = 1_000): void {
  if (typeof URL === 'undefined' || typeof window === 'undefined') return;

  const target = URL as SafeUrlConstructor;
  if (target[INSTALL_FLAG]) return;

  const nativeRevoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = (url: string) => {
    window.setTimeout(() => nativeRevoke(url), delayMs);
  };
  target[INSTALL_FLAG] = true;
}
