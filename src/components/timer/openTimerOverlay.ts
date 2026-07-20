export function openTimerOverlay(): boolean {
  const minimized = document.querySelector<HTMLButtonElement>('.timer-mini');
  if (minimized) {
    minimized.click();
    return true;
  }

  const overlay = document.querySelector<HTMLElement>('.timer-overlay');
  if (overlay) {
    overlay.focus();
    return true;
  }

  return false;
}
