const CARD_FACE_SELECTOR = '.memory-study-card-face';
const QUESTION_FACE_SELECTOR = '.memory-study-card-front';
const ANSWER_FACE_SELECTOR = '.memory-study-card-back';

/**
 * Keeps keyboard focus on the face that becomes visible after a flashcard flip.
 * Pointer and touch flips are intentionally ignored so they do not gain an
 * unexpected focus ring or move a screen-reader cursor.
 */
export function installMemoryCardKeyboardFocusGuard(): () => void {
  let scheduledFrame = 0;
  let requestGeneration = 0;

  const cancelPending = () => {
    requestGeneration += 1;
    if (scheduledFrame) {
      window.cancelAnimationFrame(scheduledFrame);
      scheduledFrame = 0;
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.repeat || event.isComposing || event.keyCode === 229) return;

    const source = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>(CARD_FACE_SELECTOR)
      : null;
    if (!source || source.getAttribute('aria-hidden') === 'true' || source.getAttribute('aria-disabled') === 'true') return;

    const card = source.closest<HTMLElement>('.memory-study-card');
    if (!card) return;

    cancelPending();
    const generation = requestGeneration;
    const destinationSelector = source.matches(QUESTION_FACE_SELECTOR)
      ? ANSWER_FACE_SELECTOR
      : QUESTION_FACE_SELECTOR;

    scheduledFrame = window.requestAnimationFrame(() => {
      scheduledFrame = 0;
      if (generation !== requestGeneration || !card.isConnected) return;
      if (document.activeElement !== source) return;

      const destination = card.querySelector<HTMLElement>(destinationSelector);
      if (!destination
        || destination.getAttribute('aria-hidden') === 'true'
        || destination.getAttribute('aria-disabled') === 'true'
        || destination.tabIndex < 0) return;

      destination.focus({ preventScroll: true });
    });
  };

  document.addEventListener('keydown', onKeyDown);
  return () => {
    document.removeEventListener('keydown', onKeyDown);
    cancelPending();
  };
}
