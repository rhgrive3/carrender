const STACK_SELECTOR = '.studyplus-actual-bar .studyplus-stack';

function minutesFromTitle(title: string | null): number {
  const match = title?.match(/(?:(\d+)時間)?(?:(\d+)分)?$/);
  if (!match || (!match[1] && !match[2])) return 0;
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

export function normalizeRecordChartStacks(root: ParentNode = document): void {
  const bars = new Set(
    [...root.querySelectorAll<HTMLElement>(STACK_SELECTOR)]
      .map((stack) => stack.parentElement)
      .filter((bar): bar is HTMLElement => Boolean(bar)),
  );
  for (const bar of bars) {
    const stacks = [...bar.querySelectorAll<HTMLElement>('.studyplus-stack')];
    const values = stacks.map((stack) => minutesFromTitle(stack.getAttribute('title')));
    const total = values.reduce((sum, value) => sum + value, 0);
    stacks.forEach((stack, index) => {
      const value = values[index];
      const height = total > 0 ? `${(value / total) * 100}%` : '0%';
      if (stack.style.height !== height) stack.style.height = height;
      const minHeight = value > 0 ? '1px' : '0px';
      if (stack.style.minHeight !== minHeight) stack.style.minHeight = minHeight;
      stack.dataset.normalizedShare = total > 0 ? String(value / total) : '0';
    });
  }
}

export function installRecordChartNormalization(): () => void {
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      normalizeRecordChartStacks();
    });
  };
  schedule();
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['title'],
  });
  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };
}
