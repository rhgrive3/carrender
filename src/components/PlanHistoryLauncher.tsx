import { useState } from 'react';
import { ListRestart } from 'lucide-react';
import { Sheet } from './ui/Sheet';
import { PlanHistoryScreen } from '../screens/PlanHistoryScreen';

export function PlanHistoryLauncher({ inline = false }: { inline?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`icon-btn plan-history-launcher ${inline ? 'inline' : 'floating'}`}
        aria-label="計画履歴を開く"
        title="計画履歴"
        onClick={() => setOpen(true)}
      >
        <ListRestart size={19} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="計画履歴">
        <PlanHistoryScreen />
      </Sheet>
    </>
  );
}
