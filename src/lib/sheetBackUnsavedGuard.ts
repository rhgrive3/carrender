const SHEET_BACK_SELECTOR = '.sheet-back';

function isSheetBackButton(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && Boolean(target.closest(SHEET_BACK_SELECTOR));
}

/**
 * 共通Sheetの左上「戻る」だけが未保存保護を迂回しないよう、capture段階で
 * Sheetが公開しているbeforeunload dirty契約を再利用する。
 * 閉じる・背景タップ・Escapeと同じく、破棄を承認した場合だけ元のonBackへ進める。
 */
export function installSheetBackUnsavedGuard() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => undefined;

  const onClick = (event: MouseEvent) => {
    if (!isSheetBackButton(event.target)) return;
    const button = event.target.closest<HTMLButtonElement>(SHEET_BACK_SELECTOR);
    if (!button || button.disabled || !button.closest('.sheet')) return;

    const beforeUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnload);
    if (!beforeUnload.defaultPrevented) return;
    if (window.confirm('保存されていない入力を破棄して前の画面へ戻りますか？')) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}

if (typeof document !== 'undefined') installSheetBackUnsavedGuard();
