import { useState } from 'react';
import { ListRestart } from 'lucide-react';
import { Sheet } from './ui/Sheet';
import { PlanHistoryScreen } from '../screens/PlanHistoryScreen';

export function PlanHistoryLauncher() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="icon-btn"
        aria-label="計画履歴を開く"
        title="計画履歴"
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed',
          right: 14,
          bottom: 'calc(76px + var(--safe-bottom))',
          zIndex: 18,
          background: 'var(--bg-elev1)',
          border: '1px solid var(--border-strong)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <ListRestart size={19} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="計画履歴">
        <PlanHistoryScreen />
      </Sheet>
    </>
  );
}
